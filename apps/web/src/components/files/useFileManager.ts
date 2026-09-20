import { createFileUpload } from './createFileUpload.js';
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { FileCommand } from '@mygitnotes/core';
import { fetchFiles, type FileEntry, type FileListing, type FileRead, mutateFile, rawFileUrl, readFile } from '../../lib/files-api.js';
import { buildFileTree, expandedPathsFor, type FileTreeNode, isMarkdownFile } from '../../lib/file-tree.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { fetchR2, type R2Listing } from '../../lib/r2-api.js';
import { useWorkspaceSidebarDrawer } from '../WorkspaceChrome.js';
import type { ForwardedRef } from 'react';
import type { FileManagerHandle, FileManagerProps } from './types.js';
type Operation = 'create' | 'mkdir' | 'move' | 'delete' | 'remove-directory' | 'metadata';
const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'));
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export function useFileManager({ notebookId, writable, initialPath, movePath, mode = 'manage', layout = 'page', beforeChange, onChanged, onOpenIndex, onInsert, onBusyChange, onSelectionChange, metadataContainer, notebooks, onNotebookChange, onShowMetadata }: FileManagerProps, ref: ForwardedRef<FileManagerHandle>) {
  const { t } = useTranslation();
  const sidebar = useWorkspaceSidebarDrawer();
  const [listing, setListing] = useState<FileListing>();
  const [directory, setDirectory] = useState(''), [selected, setSelected] = useState('');
  const [showHidden, setShowHidden] = useState(false), [treeOpen, setTreeOpen] = useState(false);
  const [showMarkdown, setShowMarkdown] = useState(false), [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<FileRead>(), [content, setContent] = useState('');
  const [sourceView, setSourceView] = useState(false), [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [error, setError] = useState('');
  const [operation, setOperation] = useState<Operation>(), [name, setName] = useState(''), [destination, setDestination] = useState('');
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [order, setOrder] = useState(0);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [r2, setR2] = useState<R2Listing>(), [r2Directory, setR2Directory] = useState<string>();
  const [rootExpanded, setRootExpanded] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false), [infoContainer, setInfoContainer] = useState<HTMLDivElement | null>(null);
  const operationForm = useRef<HTMLFormElement>(null);
  const leaveResolver = useRef<(value: boolean) => void>();
  const readSequence = useRef(0), running = useRef(false);
  const mutable = mode === 'manage' && writable && listing?.writable;
  const dirty = typeof detail?.content === 'string' && content !== detail.content;
  const selectedEntry = listing?.entries.find(entry => entry.path === selected);
  const currentEntry = useMemo<FileEntry | undefined>(() => r2Directory !== undefined ? undefined : selectedEntry || (listing && directory ? listing.entries.find(entry => entry.path === directory) || { path: directory, name: basename(directory), directory: true, size: 0, hidden: false, presentation: 'file' } : undefined), [selectedEntry, listing, directory, r2Directory]);
  useEffect(() => {
    onSelectionChange?.(currentEntry);
    return () => onSelectionChange?.(undefined);
  }, [currentEntry, onSelectionChange]);
  const infoHost = onShowMetadata ? metadataContainer : infoContainer;
  const showInfo = () => {
    if (onShowMetadata) onShowMetadata();
    else setInfoOpen(true);
  };
  const entries = listing?.entries.filter(entry => showHidden || !entry.hidden) || [];
  const dirs = entries.filter(entry => entry.directory);
  const { roots: tree, rootHasNonDocument } = listing ? buildFileTree(entries, listing.root) : { roots: [] as FileTreeNode[], rootHasNonDocument: false };
  const current = entries.filter(entry => parentOf(entry.path) === directory && (showMarkdown || entry.directory || !isMarkdownFile(entry.name))).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  const toggleExpand = (path: string) =>
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  /* eslint-disable react-hooks/exhaustive-deps -- Notebook, requested path and listing keys drive initialization; current read helpers use sequence refs. */
  useEffect(() => {
    if (!listing) return;
    /* eslint-disable react/set-state-in-effect -- Notebook and path transitions initialize the file browser and expand the loaded directory tree. */
    setExpanded(previous => {
      const next = new Set(previous);
      for (const path of expandedPathsFor(directory, listing.root)) next.add(path);
      return next;
    });
    /* eslint-enable react/set-state-in-effect */
  }, [directory, listing?.root]);
  /* eslint-enable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (operation) operationForm.current?.scrollIntoView({ block: 'nearest' });
  }, [operation]);
  const refresh = async () => {
    const next = await fetchFiles(notebookId);
    setListing(next);
    return next;
  };
  const refreshR2 = async () => {
    const next = movePath ? undefined : await fetchR2(notebookId).catch(() => undefined);
    setR2(next);
    if (!next) setR2Directory(undefined);
    return next;
  };
  const loadDetail = async (file: string) => {
    const sequence = ++readSequence.current;
    setSelected(file);
    setDetail(undefined);
    setReading(true);
    setSourceView(false);
    setOperation(undefined);
    try {
      const next = await readFile(notebookId, file);
      if (sequence !== readSequence.current) return;
      setDetail(next);
      setContent(next.content || '');
    } catch (error) {
      if (sequence === readSequence.current) setError((error as Error).message);
    } finally {
      if (sequence === readSequence.current) setReading(false);
    }
  };
  /* eslint-disable react-hooks/exhaustive-deps -- Cleanup intentionally reads the latest cancellation or resource ref, including work started after mounting. */
  useEffect(() => {
    let active = true;
    /* eslint-disable react/set-state-in-effect -- Notebook and path transitions initialize the file browser and expand the loaded directory tree. */
    setListing(undefined);
    /* eslint-enable react/set-state-in-effect */
    setError('');
    setR2(undefined);
    setR2Directory(undefined);
    if (!movePath) {
      void fetchR2(notebookId).then(next => {
        if (active) setR2(next);
      }).catch(() => undefined);
    }
    void fetchFiles(notebookId).then(next => {
      if (!active) return;
      setListing(next);
      const requested = movePath || initialPath;
      const entry = next.entries.find(entry => entry.path === requested);
      setDirectory(entry?.directory && !movePath ? entry.path : entry ? parentOf(entry.path) : next.root);
      if (entry) {
        if (entry.hidden) setShowHidden(true);
        if (!entry.directory && isMarkdownFile(entry.name)) setShowMarkdown(true);
        if (movePath) {
          setSelected(entry.path);
          setOperation('move');
          setName(entry.name);
          setDestination(parentOf(entry.path));
        } else void loadDetail(entry.path);
      }
    }).catch(error => {
      if (active) setError(error.message);
    });
    return () => {
      active = false;
      readSequence.current++;
      leaveResolver.current?.(false);
    };
  }, [notebookId, initialPath, movePath]);
  /* eslint-enable react-hooks/exhaustive-deps */
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const apply = async (command: FileCommand, expected = listing?.revision) => {
    if (!mutable || !expected) throw new Error(t('files.readOnly'));
    await beforeChange?.();
    const result = await mutateFile(command, expected);
    // The write succeeded. Clear dirty state before refreshing derived views.
    if (command.kind === 'write') setDetail(previous => previous ? { ...previous, content: command.content, revision: result.revision } : previous);
    setOperation(undefined);
    const next = await refresh();
    const entry = next.entries.find(entry => entry.path === result.selectedPath);
    if (entry?.hidden) setShowHidden(true);
    if (entry && !entry.directory && isMarkdownFile(entry.name)) setShowMarkdown(true);
    if (entry && !entry.directory) {
      setDirectory(parentOf(entry.path));
      await loadDetail(entry.path);
    } else {
      setDirectory(entry?.path || next.root);
      setSelected('');
      setDetail(undefined);
      readSequence.current++;
    }
    await onChanged?.(result);
  };
  const save = () => detail && typeof detail.content === 'string' ? run(() => apply({ kind: 'write', notebookId, path: detail.path, content }, detail.revision)) : Promise.resolve(false);
  const prepareLeave = async () => {
    if (running.current) return false;
    if (!dirty) return true;
    if (leaveResolver.current) return false;
    setConfirmLeave(true);
    return new Promise<boolean>(resolve => {
      leaveResolver.current = resolve;
    });
  };
  /* eslint-disable react/immutability -- The deferred effect or imperative callback runs after local initialization has completed. */
  useImperativeHandle(ref, () => ({ prepareLeave, editMetadata: () => openOperation('metadata') }));
  /* eslint-enable react/immutability */
  const finishLeave = (value: boolean) => {
    const resolve = leaveResolver.current;
    leaveResolver.current = undefined;
    setConfirmLeave(false);
    resolve?.(value);
  };
  const navigate = async (path: string, select = false) => {
    if (!await prepareLeave()) return;
    setError('');
    setR2Directory(undefined);
    if (select) await loadDetail(path);
    else {
      setDirectory(path);
      setSelected('');
      setDetail(undefined);
      setOperation(undefined);
      setReading(false);
      readSequence.current++;
    }
    setTreeOpen(false);
  };
  const navigateR2 = async (path: string) => {
    if (!await prepareLeave()) return;
    setError('');
    setSelected('');
    setDetail(undefined);
    setOperation(undefined);
    setReading(false);
    readSequence.current++;
    setR2Directory(path);
    setTreeOpen(false);
  };
  const loadMetadata = async (path: string) => {
    const next = await readFile(notebookId, path);
    setTitle(next.metadata?.title || basename(path));
    setDescription(next.metadata?.description || '');
    setOrder(next.metadata?.order || 0);
    setListing(previous => previous ? { ...previous, revision: next.revision } : previous);
  };
  const openOperation = async (kind: Operation) => {
    if (!await prepareLeave()) return;
    setOperation(kind);
    setError('');
    setName(kind === 'move' ? basename(selected) : '');
    setDestination(kind === 'remove-directory' ? listing!.root : selected ? parentOf(selected) : directory);
    if (kind === 'metadata') {
      showInfo();
      await run(() => loadMetadata(selected || directory));
    }
  };
  // Folder information always describes the open folder, so a selected file is closed first.
  const openFolderInfo = async () => {
    if (!await prepareLeave()) return;
    setSelected('');
    setDetail(undefined);
    setReading(false);
    readSequence.current++;
    setOperation('metadata');
    setError('');
    showInfo();
    await run(() => loadMetadata(directory));
  };
  const switchNotebook = async (id: string) => {
    if (!await prepareLeave()) return;
    if (layout === 'page') sidebar.setOpen(false);
    onNotebookChange?.(id);
  };
  const submit = async () => {
    if (!operation || !listing) return;
    const base = { notebookId, path: selected || directory };
    let command: FileCommand;
    if (operation === 'create' || operation === 'mkdir') command = { kind: operation, notebookId, path: directory + '/' + name.trim() };
    else if (operation === 'move') command = { ...base, kind: 'move', destination: destination + '/' + name.trim() };
    else if (operation === 'remove-directory') command = { ...base, kind: operation, destination };
    else if (operation === 'metadata') command = { ...base, kind: operation, title, description, order };
    else command = { ...base, kind: 'delete' };
    await run(() => apply(command));
  };
  const upload = createFileUpload({ prepareLeave, run, apply, t, notebookId, directory });
  const operationLabel = operation ? t(`files.${operation}`) : '';
  const destinationDirs = listing ? [{ path: listing.root, name: t('files.root') }, ...dirs.filter(entry => (!movePath || entry.noteDirectory) && entry.path !== selected && !entry.path.startsWith(selected + '/'))] : [];
  const relative = (path: string) => path === listing?.root ? t('files.root') : path.slice((listing?.root.length || 0) + 1);
  const rawUrl = selected ? rawFileUrl(notebookId, selected) : '';
  const markerLabel = (name: string, hasNonDocument: boolean) => hasNonDocument ? `${name} (${t('folder.hasNonDocument')})` : name;
  const notebookTitle = notebooks?.find(nb => nb.id === notebookId)?.title || t('files.root');
  // Moving a note stays inside its notebook, so only a manager that can switch lists the other notebooks.
  const treeNotebooks = onNotebookChange && mode === 'manage' && !movePath && notebooks?.length ? notebooks : [{ id: notebookId, title: notebookTitle }];
  const toggleHidden = () => {
    const next = !showHidden;
    void (async () => {
      if (await prepareLeave()) {
        setShowHidden(next);
        if (!next && (selectedEntry?.hidden || directory.slice((listing?.root.length || 0) + 1).split('/').some(p => p.startsWith('.')))) {
          setDirectory(listing!.root);
          setSelected('');
          setDetail(undefined);
          setOperation(undefined);
          readSequence.current++;
        }
      }
    })();
  };
  const toggleMarkdown = () => {
    const next = !showMarkdown;
    void (async () => {
      if (await prepareLeave()) {
        setShowMarkdown(next);
        if (!next && selectedEntry && !selectedEntry.directory && isMarkdownFile(selectedEntry.name)) {
          setSelected('');
          setDetail(undefined);
          setOperation(undefined);
          readSequence.current++;
        }
      }
    })();
  };
  return { toggleMarkdown, toggleHidden, notebookId, writable, initialPath, movePath, mode, layout, beforeChange, onChanged, onOpenIndex, onInsert, onBusyChange, onSelectionChange, metadataContainer, notebooks, onNotebookChange, onShowMetadata, t, sidebar, listing, setListing, directory, setDirectory, selected, setSelected, showHidden, setShowHidden, treeOpen, setTreeOpen, showMarkdown, setShowMarkdown, expanded, setExpanded, detail, setDetail, content, setContent, sourceView, setSourceView, busy, setBusy, reading, setReading, error, setError, operation, setOperation, name, setName, destination, setDestination, title, setTitle, description, setDescription, order, setOrder, confirmLeave, setConfirmLeave, r2, setR2, r2Directory, setR2Directory, rootExpanded, setRootExpanded, infoOpen, setInfoOpen, infoContainer, setInfoContainer, operationForm, leaveResolver, readSequence, running, mutable, dirty, selectedEntry, currentEntry, infoHost, showInfo, entries, dirs, tree, rootHasNonDocument, current, toggleExpand, refresh, refreshR2, loadDetail, run, apply, save, prepareLeave, finishLeave, navigate, navigateR2, loadMetadata, openOperation, openFolderInfo, switchNotebook, submit, upload, operationLabel, destinationDirs, relative, rawUrl, markerLabel, notebookTitle, treeNotebooks };
}
