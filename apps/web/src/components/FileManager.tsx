import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Button } from './Button.js';
import { forwardRef, lazy, Suspense, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Folder, File, FolderPlus, FilePlus, Upload, CornerLeftUp, FolderInput, Pencil, Trash2, RefreshCw, Eye, Code2, Download, X, EyeOff, Cloud, FileText, FileX, BookOpen, Info, FilePen } from 'lucide-react';
import type { FileCommand } from '@mygitnotes/core';
import type { NotebookConfig } from '../lib/types.js';
import { fetchFiles, readFile, mutateFile, rawFileUrl, type FileEntry, type FileListing, type FileRead, type FileResult } from '../lib/files-api.js';
import { buildFileTree, expandedPathsFor, isMarkdownFile, type FileTreeNode } from '../lib/file-tree.js';
import { useTranslation } from '../lib/i18n/index.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { Preview } from './FilePreview.js';
import { R2Panel, r2Folders } from './R2Panel.js';
import { fetchR2, type R2Listing } from '../lib/r2-api.js';
import { NavTree, NavTreeRow, NavTreeChildren } from './NavTree.js';
import { WorkspaceSidebar, WorkspaceSidebarPortal, WorkspaceSidebarToggle, useWorkspaceSidebarDrawer } from './WorkspaceChrome.js';
import './file-manager.css';
const FileSourceEditor = lazy(() => import('./FileSourceEditor.js').then(module => ({ default: module.FileSourceEditor })));

export interface FileManagerHandle { prepareLeave: () => Promise<boolean>; editMetadata: () => Promise<void> }
export interface FileManagerProps {
  notebookId: string;
  writable: boolean;
  initialPath?: string;
  movePath?: string;
  mode?: 'manage' | 'pick-image';
  layout?: 'page' | 'panel' | 'dialog';
  beforeChange?: () => Promise<void>;
  onChanged?: (result: FileResult) => Promise<void>;
  onOpenIndex?: (path: string, notebookId: string) => Promise<void>;
  onInsert?: (reference: string) => void;
  metadataContainer?: HTMLElement | null;
  onSelectionChange?: (entry: FileEntry | undefined) => void;
  onBusyChange?: (busy: boolean) => void;
  /** Notebooks shown as tree roots; `onNotebookChange` makes the other notebooks switchable. */
  notebooks?: Pick<NotebookConfig, 'id' | 'title'>[];
  onNotebookChange?: (notebookId: string) => void;
  /** Opens the workspace right panel that hosts `metadataContainer`; without it the manager shows its own info panel. */
  onShowMetadata?: () => void;
}
type Operation = 'create' | 'mkdir' | 'move' | 'delete' | 'remove-directory' | 'metadata';
const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'));
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export const FileManager = forwardRef<FileManagerHandle, FileManagerProps>(function FileManager({ notebookId, writable, initialPath, movePath, mode = 'manage', layout = 'page', beforeChange, onChanged, onOpenIndex, onInsert, onBusyChange, onSelectionChange, metadataContainer, notebooks, onNotebookChange, onShowMetadata }, ref) {
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
  const showInfo = () => { if (onShowMetadata) onShowMetadata(); else setInfoOpen(true); };
  const entries = listing?.entries.filter(entry => showHidden || !entry.hidden) || [];
  const dirs = entries.filter(entry => entry.directory);
  const { roots: tree, rootHasNonDocument } = listing ? buildFileTree(entries, listing.root) : { roots: [] as FileTreeNode[], rootHasNonDocument: false };
  const current = entries.filter(entry => parentOf(entry.path) === directory && (showMarkdown || entry.directory || !isMarkdownFile(entry.name))).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  const toggleExpand = (path: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  useEffect(() => {
    if (!listing) return;
    setExpanded(previous => { const next = new Set(previous); for (const path of expandedPathsFor(directory, listing.root)) next.add(path); return next; });
  }, [directory, listing?.root]);
  useEffect(() => { if (operation) operationForm.current?.scrollIntoView({ block: 'nearest' }); }, [operation]);
  const refresh = async () => { const next = await fetchFiles(notebookId); setListing(next); return next; };
  const refreshR2 = async () => { const next = movePath ? undefined : await fetchR2(notebookId).catch(() => undefined); setR2(next); if (!next) setR2Directory(undefined); return next; };
  const loadDetail = async (file: string) => {
    const sequence = ++readSequence.current;
    setSelected(file); setDetail(undefined); setReading(true); setSourceView(false); setOperation(undefined);
    try {
      const next = await readFile(notebookId, file);
      if (sequence !== readSequence.current) return;
      setDetail(next); setContent(next.content || '');
    } catch (error) { if (sequence === readSequence.current) setError((error as Error).message); }
    finally { if (sequence === readSequence.current) setReading(false); }
  };
  useEffect(() => {
    let active = true;
    setListing(undefined); setError(''); setR2(undefined); setR2Directory(undefined);
    if (!movePath) void fetchR2(notebookId).then(next => { if (active) setR2(next); }).catch(() => undefined);
    void fetchFiles(notebookId).then(next => {
      if (!active) return;
      setListing(next);
      const requested = movePath || initialPath;
      const entry = next.entries.find(entry => entry.path === requested);
      setDirectory(entry?.directory && !movePath ? entry.path : entry ? parentOf(entry.path) : next.root);
      if (entry) {
        if (entry.hidden) setShowHidden(true);
        if (!entry.directory && isMarkdownFile(entry.name)) setShowMarkdown(true);
        if (movePath) { setSelected(entry.path); setOperation('move'); setName(entry.name); setDestination(parentOf(entry.path)); }
        else void loadDetail(entry.path);
      }
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; readSequence.current++; leaveResolver.current?.(false); };
  }, [notebookId, initialPath, movePath]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return false;
    running.current = true; setBusy(true); setError('');
    try { await action(); return true; }
    catch (error) { setError((error as Error).message); return false; }
    finally { running.current = false; setBusy(false); }
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
    if (entry && !entry.directory) { setDirectory(parentOf(entry.path)); await loadDetail(entry.path); }
    else { setDirectory(entry?.path || next.root); setSelected(''); setDetail(undefined); readSequence.current++; }
    await onChanged?.(result);
  };
  const save = () => detail && typeof detail.content === 'string' ? run(() => apply({ kind: 'write', notebookId, path: detail.path, content }, detail.revision)) : Promise.resolve(false);
  const prepareLeave = async () => {
    if (running.current) return false;
    if (!dirty) return true;
    if (leaveResolver.current) return false;
    setConfirmLeave(true);
    return new Promise<boolean>(resolve => { leaveResolver.current = resolve; });
  };
  useImperativeHandle(ref, () => ({ prepareLeave, editMetadata: () => openOperation('metadata') }));
  const finishLeave = (value: boolean) => { const resolve = leaveResolver.current; leaveResolver.current = undefined; setConfirmLeave(false); resolve?.(value); };
  const navigate = async (path: string, select = false) => {
    if (!await prepareLeave()) return;
    setError(''); setR2Directory(undefined);
    if (select) await loadDetail(path);
    else { setDirectory(path); setSelected(''); setDetail(undefined); setOperation(undefined); setReading(false); readSequence.current++; }
    setTreeOpen(false);
  };
  const navigateR2 = async (path: string) => {
    if (!await prepareLeave()) return;
    setError(''); setSelected(''); setDetail(undefined); setOperation(undefined); setReading(false); readSequence.current++;
    setR2Directory(path); setTreeOpen(false);
  };
  const loadMetadata = async (path: string) => {
    const next = await readFile(notebookId, path);
    setTitle(next.metadata?.title || basename(path)); setDescription(next.metadata?.description || ''); setOrder(next.metadata?.order || 0);
    setListing(previous => previous ? { ...previous, revision: next.revision } : previous);
  };
  const openOperation = async (kind: Operation) => {
    if (!await prepareLeave()) return;
    setOperation(kind); setError(''); setName(kind === 'move' ? basename(selected) : '');
    setDestination(kind === 'remove-directory' ? listing!.root : selected ? parentOf(selected) : directory);
    if (kind === 'metadata') { showInfo(); await run(() => loadMetadata(selected || directory)); }
  };
  // Folder information always describes the open folder, so a selected file is closed first.
  const openFolderInfo = async () => {
    if (!await prepareLeave()) return;
    setSelected(''); setDetail(undefined); setReading(false); readSequence.current++;
    setOperation('metadata'); setError(''); showInfo();
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
  const upload = async (file?: globalThis.File) => {
    if (!file || !await prepareLeave()) return;
    await run(async () => {
      if (file.size > 3 * 1024 * 1024) throw new Error(t('files.uploadLimit'));
      const encoded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
      await apply({ kind: 'upload', notebookId, path: directory + '/' + file.name, base64: encoded });
    });
  };
  const operationLabel = operation ? t(`files.${operation}`) : '';
  const destinationDirs = listing ? [{ path: listing.root, name: t('files.root') }, ...dirs.filter(entry => (!movePath || entry.noteDirectory) && entry.path !== selected && !entry.path.startsWith(selected + '/'))] : [];
  const relative = (path: string) => path === listing?.root ? t('files.root') : path.slice((listing?.root.length || 0) + 1);
  const renderOperation = (form: ReactNode) => operation !== 'metadata' ? form : infoHost ? createPortal(form, infoHost) : null;
  const rawUrl = selected ? rawFileUrl(notebookId, selected) : '';
  const markerLabel = (name: string, hasNonDocument: boolean) => hasNonDocument ? `${name} (${t('folder.hasNonDocument')})` : name;
  const notebookTitle = notebooks?.find(nb => nb.id === notebookId)?.title || t('files.root');
  // Moving a note stays inside its notebook, so only a manager that can switch lists the other notebooks.
  const treeNotebooks = onNotebookChange && mode === 'manage' && !movePath && notebooks?.length ? notebooks : [{ id: notebookId, title: notebookTitle }];
  const renderTreeNode = (node: FileTreeNode): ReactNode => {
    const isExpanded = expanded.has(node.path), hasChildren = node.children.length > 0;
    const label = markerLabel(node.name, node.hasNonDocument);
    return (
      <div key={node.path} className="nav-tree-node">
        <NavTreeRow
          hasChildren={hasChildren}
          isExpanded={isExpanded}
          onToggleExpand={() => toggleExpand(node.path)}
          expandAriaLabel={isExpanded ? t('folder.collapse') : t('folder.expand')}
          title={node.name}
          selected={r2Directory === undefined && directory === node.path}
          onSelect={() => {
            if (layout === 'page') sidebar.setOpen(false);
            void navigate(node.path);
          }}
          suffix={node.hasNonDocument ? <span className="nav-tree-marker" aria-hidden="true" /> : undefined}
          disabled={busy}
          buttonProps={{
            title: label,
            'aria-label': label,
          }}
        />
        {hasChildren && isExpanded && (
          <NavTreeChildren>
            {node.children.map(renderTreeNode)}
          </NavTreeChildren>
        )}
      </div>
    );
  };

  const renderFoldersTree = () => (
    <NavTree className={`file-tree ${layout === 'page' ? 'assets-sidebar-tree' : treeOpen ? 'is-open' : ''}`} aria-label={t('folder.folders')}>
      {listing && treeNotebooks.map(nb => nb.id === notebookId ? (
        <div key={nb.id} className="nav-tree-node">
          <NavTreeRow
            hasChildren={tree.length > 0}
            isExpanded={rootExpanded}
            onToggleExpand={() => setRootExpanded(open => !open)}
            expandAriaLabel={rootExpanded ? t('folder.collapse') : t('folder.expand')}
            icon={<BookOpen size={15} />}
            title={nb.title}
            selected={r2Directory === undefined && directory === listing.root}
            onSelect={() => {
              if (layout === 'page') sidebar.setOpen(false);
              void navigate(listing.root);
            }}
            suffix={rootHasNonDocument ? <span className="nav-tree-marker" aria-hidden="true" /> : undefined}
            disabled={busy}
            buttonProps={{
              title: markerLabel(nb.title, rootHasNonDocument),
              'aria-label': markerLabel(nb.title, rootHasNonDocument),
            }}
          />
          {rootExpanded && tree.length > 0 && <NavTreeChildren>{tree.map(renderTreeNode)}</NavTreeChildren>}
        </div>
      ) : (
        <NavTreeRow key={nb.id} icon={<BookOpen size={15} />} title={nb.title} disabled={busy} onSelect={() => void switchNotebook(nb.id)} />
      ))}
      {r2 && (() => { const { root, folders } = r2Folders(r2, showHidden); return <>
        <NavTreeRow
          hasChildren={false}
          icon={<Cloud size={15} />}
          title="R2"
          selected={r2Directory === root}
          onSelect={() => {
            if (layout === 'page') sidebar.setOpen(false);
            void navigateR2(root);
          }}
          disabled={busy}
        />
        {folders.map(folder => (
          <NavTreeRow
            key={folder}
            hasChildren={false}
            title={folder.slice(folder.lastIndexOf('/') + 1)}
            selected={r2Directory === folder}
            onSelect={() => {
              if (layout === 'page') sidebar.setOpen(false);
              void navigateR2(folder);
            }}
            disabled={busy}
          />
        ))}
      </>; })()}
    </NavTree>
  );

  return <div className="file-manager" data-mode={mode} data-layout={layout} aria-busy={busy || reading || !listing}>
    {layout === 'page' && listing && (
      <>
        <WorkspaceSidebarToggle label={t('folder.folders')} open={sidebar.open} onClick={() => sidebar.setOpen(open => !open)} />
        <WorkspaceSidebarPortal>
          <WorkspaceSidebar label={t('folder.folders')} className="assets-sidebar">
            <div className="sidebar-section-label">{t('folder.folders')}</div>
            {renderFoldersTree()}
          </WorkspaceSidebar>
        </WorkspaceSidebarPortal>
      </>
    )}
    {layout === 'panel' && <div className="file-panel-sources" role="group" aria-label={t('files.location')}>
      <button type="button" aria-pressed={r2Directory === undefined} disabled={busy || !listing} onClick={() => listing && void navigate(listing.root)}><Folder size={14} />{t('files.titleLabel')}</button>
      {r2 && <button type="button" aria-pressed={r2Directory !== undefined} disabled={busy} onClick={() => void navigateR2(r2.prefix.slice(0, -1))}><Cloud size={14} />R2</button>}
    </div>}
    <header className="file-manager-toolbar">
      {layout !== 'page' && <button type="button" className="ui-button file-tree-toggle" aria-label={t('folder.folders')} title={t('folder.folders')} aria-expanded={treeOpen} onClick={() => setTreeOpen(!treeOpen)}><Folder size={16} /></button>}
      {r2Directory === undefined && (layout === 'panel' || directory !== listing?.root) && <nav aria-label={t('files.location')} className="file-breadcrumbs">
        {layout === 'panel' && listing && <button type="button" disabled={busy} onClick={() => void navigate(listing.root)}>{t('files.root')}</button>}
        {listing && <>{directory.slice(listing.root.length + 1).split('/').filter(Boolean).map((part, index, parts) => <span key={index}> / <button type="button" disabled={busy} onClick={() => void navigate(listing.root + '/' + parts.slice(0, index + 1).join('/'))}>{part}</button></span>)}</>}
      </nav>}
      {r2 && r2Directory !== undefined && (layout === 'panel' || r2Directory !== r2.prefix.slice(0, -1)) && <nav aria-label={t('files.location')} className="file-breadcrumbs">
        <button type="button" disabled={busy} onClick={() => setR2Directory(r2.prefix.slice(0, -1))}>R2</button>{r2Directory.slice(r2.prefix.length).split('/').map((part, index, parts) => <span key={index}> / <button type="button" disabled={busy} onClick={() => setR2Directory(r2.prefix + parts.slice(0, index + 1).join('/'))}>{part}</button></span>)}
      </nav>}
      {mutable && r2Directory === undefined && <div className="file-toolbar-actions" role="group" aria-label={t('files.actions')}>
        <button type="button" className="ui-icon-button" aria-label={t('files.mkdir')} title={t('files.mkdir')} disabled={busy} onClick={() => void openOperation('mkdir')}><FolderPlus size={17} /><span className="file-toolbar-label">{t('files.mkdir')}</span></button>
        <button type="button" className="ui-icon-button" aria-label={t('files.create')} title={t('files.create')} disabled={busy} onClick={() => void openOperation('create')}><FilePlus size={17} /><span className="file-toolbar-label">{t('files.create')}</span></button>
        <label className="ui-icon-button" title={t('files.upload')} aria-disabled={busy}><Upload size={17} /><span className="file-toolbar-label" aria-hidden="true">{t('files.upload')}</span><input type="file" aria-label={t('files.upload')} disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} className="sr-only" /></label>
        <button type="button" className="ui-icon-button" aria-label={t('files.metadata')} title={t('files.metadata')} disabled={busy} onClick={() => void openFolderInfo()}><Info size={17} /><span className="file-toolbar-label">{t('files.metadata')}</span></button>
        {onOpenIndex && <button type="button" className="ui-icon-button" aria-label={t('files.index')} title={t('files.index')} disabled={busy} onClick={() => void run(() => onOpenIndex(directory, notebookId))}><FilePen size={17} /><span className="file-toolbar-label">{t('files.index')}</span></button>}
      </div>}
      <div className="file-toolbar-view" role="group" aria-label={t('files.display')}>
        <button type="button" className="ui-icon-button file-hidden-toggle" aria-label={t('files.showHidden')} title={t('files.showHidden')} aria-pressed={showHidden} disabled={busy || !listing} onClick={() => { const next = !showHidden; void (async () => { if (await prepareLeave()) { setShowHidden(next); if (!next && (selectedEntry?.hidden || directory.slice((listing?.root.length || 0) + 1).split('/').some(p => p.startsWith('.')))) { setDirectory(listing!.root); setSelected(''); setDetail(undefined); setOperation(undefined); readSequence.current++; } } })(); }}>{showHidden ? <Eye size={18} /> : <EyeOff size={18} />}<span className="file-toolbar-label">{t('files.showHidden')}</span></button>
        <button type="button" className="ui-icon-button file-markdown-toggle" aria-label={t('files.showMarkdown')} title={t('files.showMarkdown')} aria-pressed={showMarkdown} disabled={busy || !listing} onClick={() => { const next = !showMarkdown; void (async () => { if (await prepareLeave()) { setShowMarkdown(next); if (!next && selectedEntry && !selectedEntry.directory && isMarkdownFile(selectedEntry.name)) { setSelected(''); setDetail(undefined); setOperation(undefined); readSequence.current++; } } })(); }}>{showMarkdown ? <FileText size={18} /> : <FileX size={18} />}<span className="file-toolbar-label">{t('files.showMarkdown')}</span></button>
        <button type="button" className="ui-icon-button" aria-label={t('folder.reload')} title={t('folder.reload')} disabled={busy} onClick={() => void (async () => { if (await prepareLeave()) await run(async () => { await refreshR2(); const next = await refresh(); if (selected && next.entries.some(e => e.path === selected)) await loadDetail(selected); else { setDirectory(next.root); setSelected(''); setDetail(undefined); setOperation(undefined); readSequence.current++; } }); })()}><RefreshCw size={16} /><span className="file-toolbar-label">{t('folder.reload')}</span></button>
      </div>
    </header>
    {error && <p role="alert" className="file-error">{error}</p>}
    {!listing ? <p role="status">{error ? t('files.unavailable') : t('files.loading')}</p> : <>
    <div className="file-manager-body">
      {layout !== 'page' && renderFoldersTree()}
      {r2 && r2Directory !== undefined ? <R2Panel notebookId={notebookId} listing={r2} directory={r2Directory} mutable={mode === 'manage' && writable} showHidden={showHidden} busy={busy}
        run={run} onNavigate={path => setR2Directory(path)} onRefresh={refreshR2} beforeChange={beforeChange}
        onNotesChanged={async () => { const next = await refresh(); await onChanged?.({ revision: next.revision, selectedPath: '', pathMap: {}, deletedPaths: [] }); }} onInsert={mode === 'pick-image' ? onInsert : undefined} /> :
      <section className={`file-content ${selectedEntry ? 'has-selection' : ''}`}>
        <p className="file-storage-hint">{mode === 'pick-image' ? t('files.pickerHint') : !mutable ? t('files.readOnly') : listing.remote ? t('files.remoteHint') : t('files.localHint')}</p>
        <div className="file-list" aria-label={t('files.list')}>
          {directory !== listing.root && <div className="file-row file-navigation-row"><button type="button" className="file-row-name" aria-label={t('files.root')} title={t('files.root')} disabled={busy} onClick={() => void navigate(listing.root)}><BookOpen size={18} /><span>{notebookTitle}</span></button></div>}
          {directory !== listing.root && <div className="file-row file-navigation-row"><button type="button" className="file-row-name" aria-label={t('files.up')} title={t('files.up')} disabled={busy} onClick={() => void navigate(parentOf(directory))}><CornerLeftUp size={18} /><span>..</span></button></div>}
          {current.map(entry => <div key={entry.path} className={`file-row ${selected === entry.path ? 'is-selected' : ''}`}>
            <button type="button" disabled={busy} className="file-row-name" title={entry.path} aria-label={`${entry.directory ? t('files.openFolder') : t('files.select')}: ${entry.name}`} onClick={() => void navigate(entry.path, !entry.directory)}>{entry.directory ? <Folder size={18} /> : <File size={18} />}<span>{entry.name}</span><small>{entry.directory ? t('files.directory') : `${(entry.size / 1024).toFixed(1)} KB`}</small></button>
            {entry.directory && mutable && <button type="button" className="ui-icon-button" disabled={busy} aria-label={`${t('files.metadata')}: ${entry.name}`} title={t('files.metadata')} onClick={() => void navigate(entry.path, true)}><Pencil size={15} /></button>}
          </div>)}
          {!current.length && <p className="file-empty">{t('files.empty')}</p>}
        </div>
        {selectedEntry && <section className="file-detail" aria-label={t('files.details')}>
          <div className="file-detail-heading"><div className="file-detail-title"><strong>{selectedEntry.name}</strong><div className="file-detail-icons">
            {mode === 'pick-image' && onInsert && selectedEntry.presentation === 'image' && <Button type="button" variant="primary" disabled={busy || reading || !detail?.hash} onClick={() => detail?.hash && onInsert?.(`![${selectedEntry.name.replace(/[\\[\]]/g, '\\$&')}](/raw-assets/by-hash/${detail.hash})`)}>{t('files.insert')}</Button>}
            {!selectedEntry.directory && <a className="ui-icon-button" href={rawUrl + '&download=1'} download aria-label={t('files.download')} title={t('files.download')}><Download size={18} /></a>}
            <button type="button" className="ui-icon-button" aria-label={t('files.close')} title={t('files.close')} disabled={busy} onClick={() => void navigate(directory)}><X size={18} /></button>
          </div></div></div>
          {!onSelectionChange && <details className="file-metadata-disclosure" key={selected}><summary>{t('files.metadataLabel')}</summary><FileMetadata entry={selectedEntry} /></details>}
          <div className="file-actions">
            {mutable && <>
              <button type="button" className="ui-button" disabled={busy} onClick={() => void openOperation('move')}><FolderInput size={15} />{t('files.move')}</button>
              {selectedEntry.directory && <button type="button" className="ui-button" disabled={busy || reading} onClick={() => void openOperation('metadata')}><Pencil size={15} />{t('files.metadata')}</button>}
              {selectedEntry.directory && onOpenIndex && <button type="button" className="ui-button" disabled={busy} onClick={() => void run(() => onOpenIndex(selected, notebookId))}>{t('files.index')}</button>}
              <button type="button" className="ui-button ui-button-danger" disabled={busy} onClick={() => void openOperation(selectedEntry.directory ? 'remove-directory' : 'delete')}><Trash2 size={15} />{t('common.delete')}</button>
            </>}
          </div>
          {reading && <p role="status">{t('files.loading')}</p>}
          {!selectedEntry.directory && detail && <>
            {selectedEntry.presentation !== 'file' && typeof detail.content === 'string' && <button type="button" className="ui-button" onClick={() => setSourceView(!sourceView)}>{sourceView ? <Eye size={15} /> : <Code2 size={15} />}{sourceView ? t('files.preview') : t('files.source')}</button>}
            {typeof detail.content === 'string' && (selectedEntry.presentation === 'file' || sourceView) ? <>
              <div className="file-save-bar"><span role="status">{dirty ? t('files.unsaved') : t('files.saved')}</span>{mutable && <Button type="button" variant="primary" disabled={busy || !dirty} onClick={() => void save()}>{t('common.save')}</Button>}</div>
              <Suspense fallback={<p role="status">{t('files.loading')}</p>}><FileSourceEditor key={detail.path} path={detail.path} content={content} readOnly={!mutable || busy} label={t('files.sourceContent')} onChange={setContent} /></Suspense>
            </> : <Preview key={selected + listing.revision} entry={selectedEntry} url={rawUrl} />}
          </>}
        </section>}
        {operation && mutable && renderOperation(<form ref={operationForm} className="file-operation" aria-label={operationLabel} onSubmit={event => { event.preventDefault(); void submit(); }}>
          <h3>{operationLabel}</h3>
          {['move', 'delete', 'remove-directory'].includes(operation) && <p><code>{selected}</code></p>}
          {['create', 'mkdir', 'move'].includes(operation) && <label>{t('files.name')}<input className="ui-control" autoFocus required maxLength={120} pattern="[^/\\\\]+" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>}
          {(operation === 'move' || operation === 'remove-directory') && <label>{t('files.destination')}<select className="ui-control" value={destination} disabled={busy} onChange={event => setDestination(event.target.value)}>{destinationDirs.map(dir => <option key={dir.path} value={dir.path}>{relative(dir.path)}</option>)}</select></label>}
          {operation === 'move' && <p className="file-destination">{t('files.newPath')}: <code>{destination}/{name}</code></p>}
          {operation === 'remove-directory' && <><p>{t('files.removeHint', { count: listing.entries.filter(entry => entry.path.startsWith(selected + '/') && !entry.directory && entry.name !== '_dir.yml').length })}</p><ul className="file-affected">{listing.entries.filter(entry => entry.path.startsWith(selected + '/') && entry.path !== selected + '/_dir.yml').map(entry => <li key={entry.path}><code>{entry.path.slice(selected.length + 1)}{entry.directory ? '/' : ''}</code></li>)}</ul></>}
          {operation === 'delete' && <p>{t('files.deleteHint', { name: basename(selected) })}</p>}
          {operation === 'metadata' && <>
            <label>{t('files.title')}<input className="ui-control" value={title} required disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
            <label>{t('files.description')}<textarea className="ui-control" value={description} disabled={busy} onChange={event => setDescription(event.target.value)} /></label>
            <label>{t('files.order')}<input type="number" className="ui-control" value={order} required disabled={busy} onChange={event => setOrder(Number(event.target.value))} /></label>
          </>}
          <div className="file-actions"><button type="button" className="ui-button" disabled={busy} onClick={() => setOperation(undefined)}>{t('common.cancel')}</button><Button type="submit" variant="primary" disabled={busy || operation === 'move' && destination + '/' + name.trim() === selected}>{operation === 'delete' || operation === 'remove-directory' ? t('files.confirmDelete') : t('common.save')}</Button></div>
        </form>)}
      </section>}
      {infoOpen && !onShowMetadata && <aside className="file-info-panel" aria-label={t('files.metadataLabel')}>
        <div className="file-info-heading"><h2>{t('files.metadataLabel')}</h2>
          <button type="button" className="ui-icon-button" aria-label={t('common.close')} title={t('common.close')} disabled={busy} onClick={() => { setInfoOpen(false); if (operation === 'metadata') setOperation(undefined); }}><X size={16} /></button>
        </div>
        {currentEntry && <FileMetadata entry={currentEntry} onEdit={mutable && currentEntry.directory ? () => void openOperation('metadata') : undefined} />}
        <div ref={setInfoContainer} />
      </aside>}
    </div>
    </>}
    {confirmLeave && <WorkspaceDialog title={t('files.unsaved')} onClose={() => finishLeave(false)}><p>{t('files.leaveHint')}</p><div className="workspace-dialog-actions"><button type="button" className="ui-button" disabled={busy} onClick={() => finishLeave(false)}>{t('files.keepEditing')}</button><button type="button" className="ui-button" disabled={busy} onClick={() => { setContent(detail?.content || ''); finishLeave(true); }}>{t('files.discard')}</button><Button type="button" variant="primary" disabled={busy} onClick={() => void save().then(ok => { if (ok) finishLeave(true); })}>{t('common.save')}</Button></div></WorkspaceDialog>}
  </div>;
});

export function FileManagerDialog({ onClose, notebookId: openedNotebookId, initialPath, ...props }: FileManagerProps & { onClose: () => void }) {
  const { t } = useTranslation(), manager = useRef<FileManagerHandle>(null);
  const [notebookId, setNotebookId] = useState(openedNotebookId);
  return <WorkspaceDialog title={t(props.mode === 'pick-image' ? 'files.chooseImage' : 'files.titleLabel')} className="file-manager-dialog" onClose={() => void manager.current?.prepareLeave().then(ok => { if (ok) onClose(); })}>
    <FileManager key={notebookId} ref={manager} layout={props.layout || 'dialog'} {...props} notebookId={notebookId}
      initialPath={notebookId === openedNotebookId ? initialPath : undefined} onNotebookChange={setNotebookId} />
  </WorkspaceDialog>;
}

export function FileMetadata({ entry, onEdit }: { entry: FileEntry; onEdit?: () => void }) {
  const { t } = useTranslation();
  return <><dl className="file-metadata">
    <dt>{t('files.location')}</dt><dd><code>{entry.path}</code></dd>
    <dt>{t('files.type')}</dt><dd>{entry.directory ? t('files.directory') : entry.name.includes('.') ? entry.name.split('.').pop()?.toUpperCase() : t('files.unknownType')}</dd>
    {!entry.directory && <><dt>{t('files.size')}</dt><dd>{entry.size.toLocaleString()} bytes</dd></>}
  </dl>{entry.directory && onEdit && <button type="button" className="ui-button file-edit-metadata" onClick={onEdit}><Pencil size={15} />{t('files.editDirectoryMetadata')}</button>}</>;
}
