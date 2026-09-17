import { Button } from './components/Button.js';
import type { ChangeRequest } from './lib/types.js';
import { useQueryStates } from 'nuqs';
import { useGraphEditing } from './lib/use-graph-editing.js';
import { filterParsers, writeFilterQuery, type FilterQuery } from './lib/filter-query.js';
import { filterNotes, legacyFolderPaths, type NoteFilters } from '@mygitnotes/core/note-filters';
import type { FilterControls } from './lib/filter-controls.js';
import { listLocalDrafts } from './lib/storage.js';
import { useWorkspaceSync } from './lib/use-workspace-sync.js';
import { SCREEN_PAGE_FILE } from '@mygitnotes/core/screen-page';
import { WorkspaceLinks } from './components/WorkspaceLinks.js';
import { resolveNoteStatuses, isNoteHidden, withNoteStatus } from '@mygitnotes/core/note-status';
import { Select } from './components/Select.js';
import { useLocation, useNavigate } from 'react-router-dom';
import { notebookRoute, noteRoute, noteReturnRoute, parseWorkspaceRoute, WorkspaceTab } from './lib/routes.js';
import { readWorkingNotes, updateWorkingNote, clearCommittedNotes, overlayWorkingNotes, workingDiff, type WorkingNotes } from './lib/working-notes.js';
import { mergeNote, sameValue } from './lib/merge-note.js';
import { buildNewNoteDraft } from './lib/new-note.js';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  fetchWorkspace,
  commitRemoteNotes,
  ApiError,
  readNote,
  readNotes,
  saveNote,
  renderNoteTemplate,
  deleteNote,
  restoreNote,
  fetchAssets,
  uploadAsset,
  deleteAsset,
  moveAsset,
  fetchGitStatus,
} from './lib/api.js';
import type {
  NoteItem,
  AssetItem,
  ViewMode,
} from './lib/types.js';
import { ThemeDefinition, getSavedTheme, applyTheme } from './lib/themes.js';
import { AuthControls, ConnectionState, AgentAccessSettings } from './components/AuthControls.js';
import { Header } from './components/Header.js';
import { KeyboardShortcuts, type ShortcutSurfaceMode } from './components/KeyboardShortcuts.js';
import { NoteToolbar } from './components/NoteToolbar.js';
import { PageToolbar } from './components/WorkspaceChrome.js';
import { useVisualViewport } from './lib/use-visual-viewport.js';
import { useSidebarSwipe } from './lib/use-sidebar-swipe.js';
import { Sidebar } from './components/Sidebar.js';
import { ListView } from './components/ListView.js';
import { CardView } from './components/CardView.js';
import { KanbanView } from './components/KanbanView.js';
import { EditorModal } from './components/EditorModal.js';
import { RightPanel } from './components/RightPanel.js';
import { FileManager, FileManagerDialog, FileMetadata, type FileManagerHandle } from './components/FileManager.js';
import { mutateFile, type FileResult, type FileEntry } from './lib/files-api.js';
import { AgentSystemView, type AgentSystemHandle } from './components/AgentSystemView.js';
import { SettingsModal } from './components/SettingsModal.js';
import { CommitModal } from './components/CommitModal.js';
import { Breadcrumbs } from './components/Breadcrumbs.js';
import { FolderIndex } from './components/FolderIndex.js';
import { FolderLinks } from './components/FolderLinks.js';
import {
  getImmediateSubfolders,
  getImmediateNotes,
  getBreadcrumbs,
} from './lib/folder-tree.js';
import {
  sortNotes,
  getSavedSort,
  saveSort,
  SortField,
  SortOrder,
} from './lib/note-sort.js';
import { I18nProvider, useTranslation } from './lib/i18n/index.js';
import { AlertTriangle, FileText, X } from 'lucide-react';

const ScreenPage = React.lazy(() => import('./components/ScreenPage.js').then(module => ({ default: module.ScreenPage })));
const GraphPage = React.lazy(() => import('./components/GraphPage.js').then(module => ({ default: module.GraphPage })));

const AppContent: React.FC = () => {
  useVisualViewport();
  const { t } = useTranslation();
  const [sortField, setSortField] = useState<SortField>(() => getSavedSort().field);
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => getSavedSort().order);

  const handleSortChange = (field: SortField, order?: SortOrder) => {
    let newOrder: SortOrder;
    if (order) {
      newOrder = order;
    } else if (field === sortField) {
      newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      newOrder = field === 'title' || field === 'status' ? 'asc' : 'desc';
    }
    setSortField(field);
    setSortOrder(newOrder);
    saveSort(field, newOrder);
  };

  const [folderReorder, setFolderReorder] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const location = useLocation();
  const [queryState, setFilterQuery] = useQueryStates(filterParsers, { history: 'push', shallow: false });
  useEffect(() => { setFiltersOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!filtersOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setFiltersOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [filtersOpen]);
  const [createError, setCreateError] = useState('');
  // Theme State
  const [currentTheme, setCurrentTheme] = useState<ThemeDefinition>(() => getSavedTheme());

  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  const handleSelectTheme = (theme: ThemeDefinition) => {
    setCurrentTheme(theme);
    applyTheme(theme);
  };

  const [editingNote, setEditingNote] = useState<NoteItem | null>(null);
  const [fileEditorRevision, setFileEditorRevision] = useState(0);
  const [fileDialog, setFileDialog] = useState<{ notebookId: string; path?: string; movePath?: string }>();
  const [fileMetadataContainer, setFileMetadataContainer] = useState<HTMLDivElement | null>(null);
  const [selectedFileEntry, setSelectedFileEntry] = useState<FileEntry>();
  const fileManagerRef = useRef<FileManagerHandle>(null);

  // The URL owns page, notebook, folder and filter selection.
  const navigate = useNavigate();
  const editorRoute = useMemo(() => parseWorkspaceRoute(location.pathname, location.search), [location.pathname, location.search]);

  const {
    selectedNotebookId,
    folders,
    sourceId,
    remote,
    canWrite,
    revision,
    setRevision,
    loadError,
    loading,
    actionError,
    setActionError,
    repoRoot,
    branch,
    config,
    gitStatus,
    setGitStatus,
    sourceNotes,
    setNotes,
    notes,
    assets,
    setAssets,
    setWorkingNotes,
    workingScope,
    activeWorkingNotes,
    screen,
    screenPending,
    refreshWorkspace,
    stageWorkingNote,
  } = useWorkspaceSync({
    routeNotebook: editorRoute.notebook || undefined,
    onStageNote: note => setEditingNote(current => current?.path === note.path && !sameValue(current, note) ? note : current),
  });

  // Deletion and Undo Buffer State (Requirement 2)
  const [deletedNotes, setDeletedNotes] = useState<NoteItem[]>([]);
  const [undoToast, setUndoToast] = useState<{ note: NoteItem; timerId: any } | null>(null);

  const editorNotebookId = editorRoute.notebook || config?.workspace.default_notebook || config?.notebooks[0]?.id || 'example';
  const returnTo = noteReturnRoute(location.search, editorNotebookId, editorRoute.folder);
  const route = useMemo(() => {
    if (!editorRoute.note) return { ...editorRoute, ...queryState, tag: queryState.tag[0] || null, tags: queryState.tag };
    const origin = new URL(returnTo, window.location.origin);
    return parseWorkspaceRoute(origin.pathname, origin.search);
  }, [editorRoute, returnTo, queryState]);
  const activeTab = route.tab;
  useEffect(() => { setFolderReorder(false); }, [activeTab, route.notebook]);
  const sidebarGestureRef = useSidebarSwipe(activeTab === 'notes' && !loading && !loadError, filtersOpen, setFiltersOpen);
  const notebookStatuses = useMemo(() => resolveNoteStatuses(
    config?.notebooks.find(nb => nb.id === selectedNotebookId),
    notes.filter(note => selectedNotebookId === 'all' || note.notebookId === selectedNotebookId).map(note => note.status),
  ), [config, notes, selectedNotebookId]);
  const selectedFolders = useMemo(() => route.folders.length ? [...new Set(route.folders)] : legacyFolderPaths(config?.notebooks || [], selectedNotebookId, route.folder), [route.folders, route.folder, config, selectedNotebookId]);
  const folderRoot = config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root.replace(/\/$/, '');
  const selectedFolder = selectedFolders.length === 1 && folderRoot && selectedFolders[0].startsWith(folderRoot + '/')
    ? selectedFolders[0].slice(folderRoot.length + 1) : route.folder;
  const selectedStatus = route.status;
  const showHidden = route.showHidden;
  const visibleNotes = useMemo(() => notes.filter(note => showHidden || !isNoteHidden({ ...note.metadata, status: note.status })), [notes, showHidden]);
  const selectedTags = useMemo(() => [...new Set(route.tags)], [route.tags]);
  const searchQuery = route.q;
  const viewMode = route.view;
  const indexInToolbar = viewMode === 'flat' || viewMode === 'kanban';
  const [routeError, setRouteError] = useState('');
  const currentFilterSearch = (patch: Partial<FilterQuery> = {}) => {
    const query = new URLSearchParams(writeFilterQuery(location.search, { ...queryState, folders: selectedFolders, ...patch }));
    query.delete('folder');
    query.delete('returnTo');
    return query;
  };
  const navigateFiltered = async (pathname: string, query: URLSearchParams, replace = false) => {
    await setFilterQuery({});
    navigate({ pathname, search: query.toString() }, { replace });
  };
  const changeFilters: FilterControls['onChange'] = patch => {
    const { tags, notebookId: _notebookId, ...values } = patch;
    const next = { ...values, ...(tags ? { tag: tags } : {}) };
    if (patch.folders && route.folder) {
      const query = currentFilterSearch(next);
      void navigateFiltered(activeTab === 'graph' ? '/graph' : notebookRoute(selectedNotebookId), query);
    } else void setFilterQuery(next, { history: Object.keys(patch).length === 1 && 'q' in patch ? 'replace' : 'push' });
  };
  const clearFilters = () => {
    const query = currentFilterSearch({ q: '', tag: [], folders: [], descendants: true, tagMode: 'any', status: null, showHidden: false, neighbors: false });
    query.delete('lanes');
    void navigateFiltered(activeTab === 'graph' ? '/graph' : notebookRoute(selectedNotebookId), query);
  };
  const setActiveTab = async (tab: WorkspaceTab) => {
    if (resourceNavigationBusy || notebookSwitchBusy || activeTab === tab) return;
    setNotebookSwitchBusy(true);
    try {
      if (activeTab === 'agent' && !await agentSystemRef.current?.prepareLeave()) return;
      if (activeTab === 'assets' && !await fileManagerRef.current?.prepareLeave()) return;
      const scope = selectedNotebookId === 'all' && tab !== 'notes' && tab !== 'graph' ? config?.workspace.default_notebook || 'example' : selectedNotebookId;
      if (tab === 'notes' || tab === 'graph') {
        const query = currentFilterSearch({ view: viewMode === 'graph' ? 'flat' : viewMode });
        query.set('notebook', scope);
        await navigateFiltered(tab === 'notes' ? notebookRoute(scope) : '/graph', query);
      } else navigate(`/${tab === 'assets' ? 'files' : tab}?notebook=${encodeURIComponent(scope)}`);
    } finally { setNotebookSwitchBusy(false); }
  };
  const agentSystemRef = useRef<AgentSystemHandle>(null);
  const [resourceNavigationBusy, setResourceNavigationBusy] = useState(false);
  const [notebookSwitchBusy, setNotebookSwitchBusy] = useState(false);
  const setSelectedNotebookId = async (id: string) => {
    if (id === selectedNotebookId || resourceNavigationBusy || notebookSwitchBusy) return;
    setNotebookSwitchBusy(true);
    try {
      if (activeTab === 'agent' && !await agentSystemRef.current?.prepareNotebookChange(id)) return;
      if (activeTab === 'assets' && !await fileManagerRef.current?.prepareLeave()) return;
      const query = currentFilterSearch({ folders: [] });
      query.set('notebook', id);
      await navigateFiltered(activeTab === 'notes' ? notebookRoute(id) : `/${activeTab}`, query);
    } finally { setNotebookSwitchBusy(false); }
  };
  const setSelectedFolder = (folder: string | null) => {
    const query = currentFilterSearch({ folders: legacyFolderPaths(config?.notebooks || [], selectedNotebookId, folder) });
    void navigateFiltered(notebookRoute(selectedNotebookId), query);
  };
  const setViewMode = (mode: ViewMode) => { void setFilterQuery({ view: mode }); };
  useEffect(() => {
    if (loading || !config || editorRoute.note || route.tab !== 'notes' || route.view !== 'graph') return;
    const query = currentFilterSearch({ view: 'flat' });
    query.set('notebook', selectedNotebookId);
    void navigateFiltered('/graph', query, true);
  }, [loading, config, editorRoute.note, route.tab, route.view]);


  // Modal States
  const [commitRequest, setCommitRequest] = useState<ChangeRequest>();
  const [isCommitOpen, setIsCommitOpen] = useState<boolean>(false);
  const [isNewNoteOpen, setIsNewNoteOpen] = useState<boolean>(false);

  // New Note Form State
  const [newNoteTitle, setNewNoteTitle] = useState<string>('');
  const [newNoteStatus, setNewNoteStatus] = useState<string>('inbox');
  const [newNoteFolder, setNewNoteFolder] = useState<string>('');
  const [shortcutMode, setShortcutMode] = useState<ShortcutSurfaceMode | null>(null);
  const [newNoteTags, setNewNoteTags] = useState<string[]>([]);
  const [newNoteTemplateId, setNewNoteTemplateId] = useState<string>('');
  const newNoteFolders = useMemo(() => folders.filter(folder => folder.notebookId === selectedNotebookId).map(folder => folder.path).sort(), [folders, selectedNotebookId]);
  const newNoteTemplates = useMemo(() => config?.notebooks.find(n => n.id === selectedNotebookId)?.templates || [], [config, selectedNotebookId]);
  const handleTemplateChange = async (templateId: string) => {
    setNewNoteTemplateId(templateId);
    if (!templateId) return;
    const currentNotebook = config?.notebooks.find((n) => n.id === selectedNotebookId) || config?.notebooks[0];
    if (!currentNotebook) return;
    try {
      const rendered = await renderNoteTemplate({ notebookId: currentNotebook.id, templateId, title: newNoteTitle || 'Untitled' });
      if (typeof rendered.metadata.status === 'string' && notebookStatuses.includes(rendered.metadata.status)) {
        setNewNoteStatus(rendered.metadata.status);
      }
      if (Array.isArray(rendered.metadata.tags)) {
        setNewNoteTags(rendered.metadata.tags.map(String));
      }
    } catch {
      // Ignore template preview error
    }
  };
  const openNewNote = (options?: string | { status?: string; folder?: string; tag?: string; tags?: string[]; notebookId?: string }) => {
    const opts = typeof options === 'string' ? { status: options } : { ...options };
    if (selectedNotebookId === 'all' && !opts.notebookId) opts.notebookId = config?.workspace.default_notebook || config?.notebooks[0]?.id;
    if (opts.notebookId && opts.notebookId !== selectedNotebookId && config?.notebooks.some(n => n.id === opts.notebookId)) {
      setSelectedNotebookId(opts.notebookId);
    }
    setNewNoteStatus(opts.status || notebookStatuses[0]);
    setNewNoteFolder(opts.folder || '');
    setNewNoteTags(opts.tags || (opts.tag ? [opts.tag] : []));
    setNewNoteTemplateId('');
    setCreateError('');
    setIsNewNoteOpen(true);
  };

  // Aggregated tags across all notes for autocomplete
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((n) => {
      if (Array.isArray(n.tags)) {
        n.tags.forEach((t) => {
          if (t && typeof t === 'string') set.add(t.trim());
        });
      }
      if (n.metadata && Array.isArray((n.metadata as any).tags)) {
        (n.metadata as any).tags.forEach((t: any) => {
          if (t && typeof t === 'string') set.add(t.trim());
        });
      }
    });
    return Array.from(set).filter(Boolean).sort();
  }, [notes]);

  useEffect(() => {
    setEditingNote(null);  setDeletedNotes([]); setIsNewNoteOpen(false);
  }, [sourceId]);

  useEffect(() => {
    if (loading || !config) return;
    if (!editorRoute.valid) { setRouteError('route.pageNotFound');  return; }
    const notebook = config.notebooks.find(nb => nb.id === editorNotebookId) || (!editorRoute.notebook ? config.notebooks[0] : null);
    if (!notebook && editorNotebookId === 'all' && !editorRoute.note) { setRouteError(''); setEditingNote(null); return; }
    if (!notebook) { setRouteError('route.notebookNotFound');  return; }
    if (!editorRoute.note) { setRouteError(''); setEditingNote(null);  return; }
    const file = `${notebook.root}/${editorRoute.note}`;
    const note = notes.find(n => n.path === file);
    if (note) { setRouteError(''); setEditingNote(previous => previous?.path === file ? previous : note);  }
    else if (editingNote?.path !== file) { setRouteError('route.noteNotFound');  }
  }, [editorRoute, config, notes, folders, loading, editorNotebookId, sourceId]);

  const noteFilters = useMemo<NoteFilters>(() => ({
    notebookId: selectedNotebookId, folders: selectedFolders, tags: selectedTags,
    descendants: route.descendants, tagMode: route.tagMode, q: searchQuery,
    status: selectedStatus, showHidden,
  }), [selectedNotebookId, selectedFolders, selectedTags, route.descendants, route.tagMode, searchQuery, selectedStatus, showHidden]);
  const filteredNotes = useMemo(() => filterNotes(notes, noteFilters), [notes, noteFilters]);
  const hasCollectionFilter = selectedFolders.length > 0 || selectedTags.length > 0 || selectedNotebookId === 'all';
  const filterProps: FilterControls = {
    value: noteFilters, neighbors: route.neighbors, notebooks: config?.notebooks || [], folders,
    tags: [...new Set(visibleNotes.filter(note => selectedNotebookId === 'all' || note.notebookId === selectedNotebookId).flatMap(note => note.tags))],
    statuses: notebookStatuses, count: filteredNotes.length,
    onChange: changeFilters, onNotebookChange: id => void setSelectedNotebookId(id), onClear: clearFilters,
  };

  // Hierarchical Subfolder Discovery for current folder
  const immediateSubfolders = useMemo(() => {
    if (indexInToolbar || searchQuery.trim() || selectedStatus || hasCollectionFilter) return [];
    const root = config?.notebooks.find((nb) => nb.id === selectedNotebookId)?.root || '';
    return getImmediateSubfolders(visibleNotes, folders, selectedNotebookId, root, selectedFolder);
  }, [visibleNotes, folders, selectedNotebookId, config, selectedFolder, searchQuery, selectedStatus, hasCollectionFilter, indexInToolbar]);

  // Choose by filename before applying visibility so a hidden index keeps priority.
  const folderIndex = useMemo(() => {
    if (searchQuery.trim() || selectedStatus || hasCollectionFilter) return undefined;
    const notebook = config?.notebooks.find(nb => nb.id === selectedNotebookId);
    if (!notebook) return undefined;
    const directory = [notebook.root.replace(/\/$/, ''), selectedFolder].filter(Boolean).join('/');
    const candidates = notes.filter(note => note.notebookId === notebook.id);
    const selected = candidates.find(note => note.path === `${directory}/index.md`)
      ?? candidates.find(note => note.path === `${directory}/README.md`);
    return selected && visibleNotes.find(note => note.path === selected.path);
  }, [notes, visibleNotes, config, selectedNotebookId, selectedFolder, searchQuery, selectedStatus, hasCollectionFilter]);

  const notesBelowFolders = useMemo(() => filteredNotes.filter(note => note.path !== folderIndex?.path), [filteredNotes, folderIndex]);

  // Direct notes in current folder (or flat list during search/filter), sorted
  const displayedNotes = useMemo(() => {
    const root = config?.notebooks.find((nb) => nb.id === selectedNotebookId)?.root || '';
    const base = viewMode === 'flat' || searchQuery.trim() || selectedStatus || hasCollectionFilter
      ? notesBelowFolders
      : getImmediateNotes(notesBelowFolders, root, selectedFolder);
    return sortNotes(base, sortField, sortOrder, notebookStatuses);
  }, [notesBelowFolders, config, selectedNotebookId, selectedFolder, searchQuery, selectedStatus, hasCollectionFilter, sortField, sortOrder, notebookStatuses, viewMode]);

  // Breadcrumb Trail from Root to current folder
  const breadcrumbs = useMemo(() => {
    return getBreadcrumbs(selectedFolder, folders, selectedNotebookId, t('folder.allFolders'));
  }, [selectedFolder, folders, selectedNotebookId, t]);

  // Note Handlers
  const handleOpenNote = async (note: NoteItem, anchor = '') => {
    try { await graphEditing.store.flushAll(); note = graphEditing.store.get(note).draft; }
    catch (error) { setActionError((error as Error).message); return; }
    setEditingNote(note);

    const notebook = config?.notebooks.find(nb => nb.id === note.notebookId);
    if (notebook) {
      const query = new URLSearchParams(location.search);
      query.delete('notebook');
      query.set('returnTo', editorRoute.note ? returnTo : location.pathname + location.search + location.hash);
      if (selectedFolder && note.notebookId === selectedNotebookId) query.set('folder',selectedFolder); else query.delete('folder');
      navigate(noteRoute(notebook.id,note.path.slice(notebook.root.length+1))+'?'+query.toString()+(anchor ? '#'+encodeURIComponent(anchor) : ''));
    }
    const targetNotebook = note.notebookId || selectedNotebookId;
    if (targetNotebook) {
      fetchAssets(targetNotebook).then(setAssets).catch(console.error);
    }
  };

  const handleSaveNote = async (params: {
    path: string;
    content: string;
    metadata?: Record<string, unknown>;
    notebookId?: string;
    revision?: string;
    baseNote?: NoteItem;
  }) => {
    if (!canWrite) throw new Error('This workspace is read-only.');
    const original = notes.find(n => n.path === params.path);
    if (remote) {
      if (!original) throw new Error('Note is unavailable in this workspace.');
      const pending = readWorkingNotes(workingScope)[params.path];
      const base = pending?.base === null ? null : params.baseNote || pending?.base || sourceNotes.find(note => note.path === params.path) || null;
      return stageWorkingNote({ ...original, content: params.content, metadata: params.metadata || original.metadata,
        title: typeof params.metadata?.title === 'string' ? params.metadata.title : original.title,
        status: typeof params.metadata?.status === 'string' ? params.metadata.status : undefined,
        tags: Array.isArray(params.metadata?.tags) ? params.metadata.tags.map(String) : [],
        revision: base?.revision || original.revision }, base, pending?.blocked);
    }
    // Local saves update the working tree for the explicit Commit action.
    const res = await saveNote({
      ...params,
      notebookId: params.notebookId || selectedNotebookId,
      noCommit: !remote,
      ...(remote ? { revision: params.revision || (editingNote?.path === params.path ? editingNote.revision : original?.revision) || revision } : {}),
    });
    if (remote) setRevision(res.note.revision || revision);
    // Update local state immediately
    setNotes((prev) =>
      prev.map((n) => (n.path === res.note.path ? res.note : n))
    );
    setEditingNote(prev => prev?.path === res.note.path ? res.note : prev);
    // Refresh git status to update dirty count
    const statusRes = await fetchGitStatus();
    setGitStatus(statusRes.status);
    return res.note;
  };

  const graphEditing = useGraphEditing(`${sourceId}:${branch}`, notes, canWrite, params => {
    const pending = remote ? readWorkingNotes(workingScope)[params.path] : undefined;
    if (pending?.blocked) return Promise.reject(new Error(pending.blocked));
    return handleSaveNote({ ...params, baseNote: pending?.base || params.baseNote });
  });

  // Remote delete: no working tree to trash into, so commit the removal immediately.
  const handleRemoteDeleteNote = async (note: NoteItem) => {
    if (!canWrite) return;
    let result: FileResult;
    try {
      result = await mutateFile({ kind: 'delete', notebookId: note.notebookId, path: note.path }, note.revision || revision);
    } catch (error) { setActionError((error as Error).message); throw error; }
    // Apply everything in one synchronous batch: an async refetch here would leave a gap where
    // routedNote still resolves the stale sourceNotes entry and the still-mounted editor re-stages
    // a phantom draft for the path we just deleted.
    setRevision(result.revision);
    setNotes((prev) => prev.filter((n) => n.path !== note.path));
    setWorkingNotes(updateWorkingNote(workingScope, note.path, null));
    if (editingNote?.path === note.path) { setEditingNote(null); navigate(returnTo, { replace: true }); }
  };

  // Trash action: delete without immediate commit, allowing restore (Requirement 2)
  const handleDeleteNote = async (note: NoteItem) => {
    if (!canWrite) return;
    if (remote) return handleRemoteDeleteNote(note);
    // 1. Remove from active notes immediately
    setNotes((prev) => prev.filter((n) => n.path !== note.path));
    // 2. Push to deletedNotes buffer
    setDeletedNotes((prev) => [note, ...prev.filter((n) => n.path !== note.path)]);

    // 3. Delete from disk without committing to git
    await deleteNote(note.path, { noCommit: true });
    const statusRes = await fetchGitStatus();
    setGitStatus(statusRes.status);

    if (editingNote?.path === note.path) {

      setEditingNote(null);
    }

    // 4. Trigger Undo Toast notification
    if (undoToast?.timerId) clearTimeout(undoToast.timerId);
    const timerId = setTimeout(() => {
      setUndoToast(null);
    }, 8000);
    setUndoToast({ note, timerId });
  };

  // Restore deleted note before commit (Requirement 2)
  const handleRestoreNote = async (note: NoteItem) => {
    const res = await restoreNote({
      path: note.path,
      content: note.content,
      metadata: note.metadata,
      notebookId: note.notebookId,
    });
    if (!res.note) throw new Error('The deleted note could not be restored.');
    const restoredNote = res.note;
    setNotes((prev) => [restoredNote, ...prev.filter((n) => n.path !== note.path)]);
    setDeletedNotes((prev) => prev.filter((n) => n.path !== note.path));

    if (undoToast?.note.path === note.path) {
      clearTimeout(undoToast.timerId);
      setUndoToast(null);
    }

    const statusRes = await fetchGitStatus();
    setGitStatus(statusRes.status);
  };

  // Restore single note file uncommitted changes from Git HEAD (Requirement 1)
  const handleRestoreNoteFile = async (notePath: string): Promise<NoteItem | null> => {
    try {
      if (remote) {
        if (readWorkingNotes(workingScope)[notePath]?.base === null) {
          setWorkingNotes(updateWorkingNote(workingScope, notePath, null));
          setNotes(previous => previous.filter(note => note.path !== notePath));
          setEditingNote(null);
          navigate(returnTo, { replace: true });
          return null;
        }
        const latest = await readNote(notePath);
        setWorkingNotes(updateWorkingNote(workingScope, notePath, null));
        setNotes(previous => previous.map(note => note.path === notePath ? latest : note));
        setEditingNote(latest);
        return latest;
      }
      const res = await restoreNote({ path: notePath });
      const restored = res.note;
      setNotes((prev) => restored ? prev.map((n) => (n.path === notePath ? restored : n)) : prev.filter(n => n.path !== notePath));
      setEditingNote(res.note);
      if (!restored) navigate(returnTo, { replace: true });
      const statusRes = await fetchGitStatus();
      setGitStatus(statusRes.status);
      return res.note;
    } catch (err) {
      console.error('Failed to restore note file:', err);
      throw err;
    }
  };

  // In-table status change without opening note (Requirement 3)
  const handleUpdateNoteStatus = async (note: NoteItem, newStatus: string) => {
    setActionError('');
    try {
    const updatedMetadata = withNoteStatus({ ...note.metadata, status: note.status }, newStatus);
    await handleSaveNote({
      path: note.path,
      content: note.content,
      metadata: updatedMetadata,
      notebookId: note.notebookId,
    });
    } catch (error) { setActionError((error as Error).message); }
  };

  const handleOpenFolderIndex = async (folder: string, folderRevision?: string) => {
    if (!canWrite) throw new Error(t('folder.readOnly'));
    const notebook = config?.notebooks.find(item => item.id === selectedNotebookId);
    if (!notebook) throw new Error(t('route.notebookNotFound'));
    const path = `${notebook.root.replace(/\/$/, '')}/${folder}/index.md`;
    let note = (remote ? readWorkingNotes(workingScope)[path]?.note : undefined) || notes.find(item => item.path === path);
    if (!note) {
      const metadata = { title: t('folder.index'), tags: [] };
      const content = `# ${t('folder.index')}\n\n`;
      note = remote ? stageWorkingNote({
        id: path, path, notebookId: notebook.id, title: metadata.title,
        content, metadata, tags: [], revision: folderRevision || revision,
      }, null) : (await saveNote({ path, notebookId: notebook.id, content, metadata, createOnly: true, noCommit: true })).note;
      if (!remote) setNotes(previous => [...previous.filter(item => item.path !== path), note!]);
    }
    setEditingNote(note);
    const query = new URLSearchParams(location.search);
    query.delete('notebook'); query.set('folder', folder);
    navigate(noteRoute(notebook.id, `${folder}/index.md`) + '?' + query.toString());
    if (!remote) void fetchGitStatus().then(result => setGitStatus(result.status)).catch(error => setActionError(error.message));
  };

  const handleCreateNewNote = async (statusOverride?: string) => {
    try {
      setCreateError('');
      if (!canWrite) throw new Error('This workspace is read-only.');
      const title = newNoteTitle.trim() || 'Untitled Note';
      const slug = title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '') || 'untitled';

      const currentNotebook = config?.notebooks.find((n) => n.id === selectedNotebookId) || config?.notebooks[0];
      const root = currentNotebook?.root || 'notes/example';
      const folder = newNoteFolder.trim().replace(/^\/+|\/+$/g, '');
      if (folder && !newNoteFolders.includes(folder)) throw new Error(t('createNote.invalidFolder'));
      const notePath = [root, folder, `${slug}.md`].filter(Boolean).join('/');
      if (notes.some(n => n.path === notePath)) throw new Error('A note with this filename already exists in this folder. Choose another title.');

      const status = statusOverride || newNoteStatus;
      const template = newNoteTemplateId
        ? await renderNoteTemplate({ notebookId: currentNotebook!.id, templateId: newNoteTemplateId, title })
        : undefined;
      const draft = buildNewNoteDraft({ slug, title, tags: newNoteTags, status, template });
      const initialContent = draft.content;
      const finalStatus = draft.status;
      const initialMetadata = withNoteStatus(draft.metadata, finalStatus);

      const res = remote ? { note: stageWorkingNote({
        id: slug, path: notePath, notebookId: currentNotebook!.id, title,
        content: initialContent, metadata: initialMetadata, status: finalStatus, tags: Array.isArray(initialMetadata.tags) ? initialMetadata.tags.map(String) : [], revision,
      }, null) } : await saveNote({
        path: notePath,
        notebookId: currentNotebook?.id,
        createOnly: true,
        content: initialContent,
        metadata: initialMetadata,
        noCommit: !remote,
        ...(remote ? { revision } : {}),
      });
      if (remote) setRevision(res.note.revision || revision);

      setNotes((prev) => [res.note, ...prev]);
      setIsNewNoteOpen(false);
      setNewNoteTitle('');
      setNewNoteFolder('');
      setNewNoteTags([]);
      setNewNoteTemplateId('');
      setNewNoteStatus(notebookStatuses[0]);
      const statusRes = await fetchGitStatus();
      setGitStatus(statusRes.status);
      handleOpenNote(res.note);
    } catch (error) { setCreateError((error as Error).message); }
  };

  const commitWorkingNotes = async (files: string[], message: string) => {
    const pending = readWorkingNotes(workingScope);
    const sentScreen = files.includes(SCREEN_PAGE_FILE) ? screen.commitDraft() : undefined;
    const selected = files.filter(file => file !== SCREEN_PAGE_FILE).map(file => pending[file]).filter(Boolean);
    if (selected.length + (sentScreen ? 1 : 0) !== files.length) throw new Error('Pending files changed. Review the selection again.');
    const workspace = await fetchWorkspace(true);
    if (!workspace.capabilities.write || workspace.source.identity !== sourceId) throw new Error('Sign in with write access to this workspace before committing.');
    const expected = workspace.revision!;
    const sent: WorkingNotes = {};
    let reviewRequired = false;
    const existingPaths = selected.filter(entry => entry.base).map(entry => entry.note.path);
    const latestNotes = existingPaths.length ? await readNotes(existingPaths, expected) : [];
    const latestByPath = new Map(latestNotes.map(note => [note.path, note]));
    for (const entry of selected) {
      if (entry.blocked) throw new Error(`${entry.note.path}: ${entry.blocked}`);
      let prepared = entry;
      if (entry.base) {
        let latest: NoteItem;
        try {
          latest = latestByPath.get(entry.note.path)!;
          if (!latest) throw new ApiError('Note moved or deleted remotely.', 404);
        }
        catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            const blocked = 'Moved or deleted remotely. Open the note and refresh after it is restored.';
            stageWorkingNote(entry.note, entry.base, blocked);
          }
          throw error;
        }
        if (latest.revision !== expected) throw new Error('Remote changed during review. Retry Commit to check the latest revision.');
        const merged = mergeNote(entry.base, entry.note, latest);
        if (merged.conflict) {
          const blocked = 'Remote changes conflict with this draft. Open the note and Refresh remote version.';
          stageWorkingNote(entry.note, entry.base, blocked);
          throw new Error(`${entry.note.path}: ${blocked}`);
        }
        if (!sameValue(merged.draft, { content: entry.note.content, metadata: entry.note.metadata })) reviewRequired = true;
        prepared = { base: latest, note: { ...entry.note, ...merged.draft, revision: latest.revision } };
      }
      // Compare again after network reads so another tab's newer draft survives.
      if (!sameValue(readWorkingNotes(workingScope)[entry.note.path], entry)) throw new Error('Local draft changed during review. Retry Commit.');
      stageWorkingNote(prepared.note, prepared.base);
      const persisted = readWorkingNotes(workingScope)[entry.note.path];
      if (persisted) sent[entry.note.path] = persisted;
    }
    if (reviewRequired) throw new Error('Remote changes merged into local drafts. Review the updated diff, then Commit again.');
    if (!Object.keys(sent).length && !sentScreen) return;
    const result = await commitRemoteNotes(Object.values(sent).map(entry => ({ path: entry.note.path,
      content: entry.note.content, metadata: entry.note.metadata, createOnly: !entry.base })), expected, message, sentScreen);
    if (sentScreen) screen.committed(sentScreen, result.revision);
    setWorkingNotes(clearCommittedNotes(workingScope, sent));
    setRevision(result.revision);
    setNotes(previous => overlayWorkingNotes(previous, Object.fromEntries(Object.entries(sent).map(([path, entry]) => [path, { ...entry, note: { ...entry.note, revision: result.revision } }]))));
  };

  const handleUploadAsset = async (file: File, directory = '') => {
    return new Promise<AssetItem>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          const targetNotebookId = editingNote?.notebookId || selectedNotebookId;
          const currentRevision = remote ? (await fetchWorkspace()).revision : undefined;
          const uploaded = await uploadAsset(targetNotebookId, file.name, base64, { directory, revision: currentRevision });
          const assetList = await fetchAssets(targetNotebookId);
          setAssets(assetList);
          const statusRes = await fetchGitStatus();
          setGitStatus(statusRes.status);
          const asset = assetList.find(a => a.path === uploaded.path);
          if (!asset) throw new Error('Uploaded asset could not be found.');
          resolve(asset);
        } catch (err) {
          console.error('Failed to upload asset:', err);
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  const refreshAssets = async () => {
    const targetNotebookId = editingNote?.notebookId || selectedNotebookId;
    const assetList = await fetchAssets(targetNotebookId); setAssets(assetList);
    const statusRes = await fetchGitStatus(); setGitStatus(statusRes.status);
    return assetList;
  };
  const handleDeleteAsset = async (asset: AssetItem) => {
    await deleteAsset(asset.path, { noCommit: !remote, revision: asset.revision });
    await refreshAssets();
  };
  const handleMoveAsset = async (asset: AssetItem, directory: string) => {
    const moved = await moveAsset({ path: asset.path, directory, revision: asset.revision });
    const assetList = await refreshAssets();
    const result = assetList.find(a => a.path === moved.path);
    if (!result) throw new Error('Moved asset could not be found.');
    return result;
  };

  const beforeFileChange = async () => {
    await graphEditing.store.flushAll();
    if (Object.keys(readWorkingNotes(workingScope)).length || listLocalDrafts(workingScope).length || screen.dirty) throw new Error(t('folder.draftsHint'));
  };
  const openFileManager = (notebookId: string, relativePath = '') => {
    const notebook = config?.notebooks.find(nb => nb.id === notebookId);
    if (notebook) setFileDialog({ notebookId, path: notebook.root + (relativePath ? '/' + relativePath : '') });
  };
  const handleMoveNote = async (note: NoteItem) => {
    try { await beforeFileChange(); setFileDialog({ notebookId: note.notebookId, path: note.path, movePath: note.path }); }
    catch (error) { setActionError((error as Error).message); throw error; }
  };
  const moveNoteAction = (note: NoteItem) => { void handleMoveNote(note).catch(() => {}); };
  const onFilesChanged = async (result: FileResult) => {
    await refreshWorkspace(); await screen.refresh();
    if (editorRoute.note) {
      const nb = config?.notebooks.find(nb => nb.id === editorNotebookId);
      const previous = nb ? nb.root + '/' + editorRoute.note : '';
      if (nb && result.pathMap[previous]) {
        setEditingNote(null);
        navigate(noteRoute(nb.id, result.pathMap[previous].slice(nb.root.length + 1)) + location.search, { replace: true });
        setFileDialog(undefined);
      } else if (nb) {
        try {
          if (result.deletedPaths.includes(previous)) { setEditingNote(null); navigate(returnTo, { replace: true }); }
          else { setEditingNote(await readNote(previous, nb.id)); setFileEditorRevision(value => value + 1); }
        }
        catch (error) {
          if ((error as { status?: number }).status !== 404) throw error;
          setEditingNote(null);
          navigate(returnTo, { replace: true });
        }
      }
    }
    if (selectedFolder && folderRoot && result.pathMap[folderRoot + '/' + selectedFolder]) {
      const moved = result.pathMap[folderRoot + '/' + selectedFolder];
      changeFilters({ folders: [moved] });
    }
  };
  const openFileIndex = async (path: string) => {
    const nb = config?.notebooks.find(nb => nb.id === selectedNotebookId);
    if (!nb) return;
    await handleOpenFolderIndex(path === nb.root ? '' : path.slice(nb.root.length + 1));
    setFileDialog(undefined);
  };

  const routedPath = editorRoute.note ? `${config?.notebooks.find(nb => nb.id === editorNotebookId)?.root}/${editorRoute.note}` : null;
  const routedNote = routedPath ? (editingNote?.path === routedPath ? editingNote : notes.find(note => note.path === routedPath) || null) : null;
  const noteEditorOpen = Boolean(routedNote) && !routeError;

  const openCommitModal = (request?: ChangeRequest) => { void (async () => {
    if (activeTab === 'agent' && !await agentSystemRef.current?.prepareLeave()) return;
    if (!remote && screen.dirty) await screen.save();
    setCommitRequest(request);
    setIsCommitOpen(true);
  })().catch(error => setActionError(error.message)); };

  const panelRemoteChanges = remote ? [
          ...Object.values(activeWorkingNotes).map(entry => ({ path: entry.note.path, kind: entry.blocked ? 'conflict' as const : entry.base ? 'modified' as const : 'added' as const,
            tracked: Boolean(entry.base), revision: JSON.stringify(entry), available: canWrite && !entry.blocked, staged: false, unstaged: true })),
          ...(screenPending ? [{ path: SCREEN_PAGE_FILE, kind: 'modified' as const, tracked: true, revision: screen.diff, available: canWrite && !screen.error, staged: false, unstaged: true }] : []),
        ] : undefined;
  const panelGetPreview = remote ? (file: string) => file === SCREEN_PAGE_FILE ? screen.diff : activeWorkingNotes[file] ? workingDiff({ [file]: activeWorkingNotes[file] }) : '' : undefined;

  if (loading || loadError) return <ConnectionState loading={loading} error={loadError} onRetry={refreshWorkspace} />;

  return (
    <WorkspaceLinks notebooks={config?.notebooks || []} notes={notes} folders={folders} onOpenNote={handleOpenNote}>
    <div
      className="app-shell h-dvh w-full overflow-hidden flex flex-col font-sans transition-colors duration-200"
      data-workspace-tab={activeTab}
      data-screen-focus={activeTab === 'screen' && Boolean(route.lane)}
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}
    >
      {/* Core Branch User Guidance Banner (Theme-aware, harmonized with active palette) */}
      {!remote && branch === 'core' && (
        <div
          className="shrink-0 flex-none px-4 py-2 text-xs flex items-center justify-between font-medium border-b transition-colors"
          style={{
            backgroundColor: 'var(--color-sidebar)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span
              className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-white shrink-0 shadow-xs"
              style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
            >
              {t('nav.coreBaseline')}
            </span>
            <span className="text-slate-600 dark:text-slate-300">
              {t('nav.coreBanner')}
            </span>
          </div>
        </div>
      )}

      {/* Top Header */}
      <Header
        workspaceTitle={config?.workspace.title || 'MyGitNotes'}
        sourceLabel={remote ? `${sourceId.replace(/^(github|gitlab):/, '')}${canWrite ? '' : ' · Read-only'}` : undefined}
        accountControls={<AuthControls local={!remote} />}
        notebooks={config?.notebooks || []}
        selectedNotebookId={selectedNotebookId}
        onSelectNotebook={id => void setSelectedNotebookId(id)}
        notebookDisabled={loading || resourceNavigationBusy || notebookSwitchBusy}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onCreateNote={() => openNewNote()}
        createNoteDisabled={!canWrite || selectedNotebookId === 'all'}
        onOpenCommands={() => setShortcutMode('palette')}
        navigationDisabled={noteEditorOpen || isCommitOpen}
      />
      <KeyboardShortcuts mode={shortcutMode} onModeChange={setShortcutMode}
        suspended={noteEditorOpen || isCommitOpen}
        activeTab={activeTab} canCreateNote={canWrite}
        onNavigate={tab => void setActiveTab(tab)} onCreateNote={() => openNewNote()}
        onFocusSearch={() => { if (activeTab === 'notes') setFiltersOpen(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.header-search input')?.focus()); }} />

      {routeError && (
        <div role="alert" className="px-6 py-3 text-sm text-rose-600">
          {routeError.startsWith('route.') ? t(routeError as any) : routeError}{' '}
          <button className="underline" onClick={() => navigate('/notes')}>
            {t('route.goToNotes')}
          </button>
        </div>
      )}
      {/* Main Workspace Layout */}
      <div ref={sidebarGestureRef} className="workspace-body relative flex-1 min-h-0 min-w-0 flex overflow-hidden">
        {activeTab === 'notes' && (
          <>
            {/* Sidebar for Notebooks, Filters & Branch Info at bottom */}
            {filtersOpen && <button className="notebook-backdrop mobile-only absolute inset-0 z-20 bg-slate-950/40" aria-label={t('sidebar.closeFilters')} onClick={() => setFiltersOpen(false)} />}
            <div id="notebook-panel" className={`notebook-panel ${filtersOpen ? 'is-open' : ''}`}>
            <Sidebar
              selectedNotebookId={selectedNotebookId}
              folders={folders}
              onManageFiles={openFileManager}
              foldersWritable={canWrite && selectedNotebookId !== 'all'}
              reorder={folderReorder}
              onToggleReorder={() => setFolderReorder(value => !value)}
              filters={filterProps}
              notes={visibleNotes}
              hiddenNoteCount={notes.filter(note => (selectedNotebookId === 'all' || note.notebookId === selectedNotebookId) && isNoteHidden({ ...note.metadata, status: note.status })).length}
              beforeFolderChange={() => {
                if (Object.keys(activeWorkingNotes).length || listLocalDrafts(workingScope).length || screen.dirty) throw new Error(t('folder.draftsHint'));
              }}
              onFoldersChanged={async () => { await refreshWorkspace(); await screen.refresh(); }}
              selectedFolder={selectedFolder}
              onSelectFolder={setSelectedFolder}
              gitStatus={gitStatus}
            />
            </div>

            {/* Main Content Area */}
            <main className="workspace-main notes-main">
              <PageToolbar>
                {indexInToolbar && folderIndex && <FolderIndex note={folderIndex} onOpenNote={handleOpenNote} />}
                <NoteToolbar onManageFiles={selectedNotebookId === 'all' ? undefined : () => openFileManager(selectedNotebookId, selectedFolder || '')} sortField={sortField} sortOrder={sortOrder} onSortChange={handleSortChange} readOnly={!canWrite || selectedNotebookId === 'all'} viewMode={viewMode} setViewMode={setViewMode}
                  onOpenNewNoteModal={() => openNewNote()} filtersOpen={filtersOpen}
                  onToggleFilters={() => setFiltersOpen(open => !open)} />
              </PageToolbar>
              <div className="workspace-scroll">
              {actionError && <p role="alert" className="mb-3 text-sm text-rose-600">{actionError}</p>}
              {!indexInToolbar && <>
                <Breadcrumbs
                  segments={breadcrumbs}
                  currentFolder={selectedFolder}
                  onSelectFolder={setSelectedFolder}
                  subfolderCount={immediateSubfolders.length}
                  noteCount={displayedNotes.length}
                  sortField={sortField}
                  sortOrder={sortOrder}
                  onSortChange={handleSortChange}
                />
                <FolderLinks folders={immediateSubfolders} onSelect={setSelectedFolder}>
                  {folderIndex && <FolderIndex note={folderIndex} onOpenNote={handleOpenNote} />}
                </FolderLinks>
              </>}
              {(viewMode === 'list' || viewMode === 'flat') && (
                <ListView
                  showMobileSort={false}
                  statuses={notebookStatuses}
                  readOnly={!canWrite}
                  canDelete={canWrite}
                  confirmDelete={remote}
                  notes={displayedNotes}
                  hasFolderEntries={immediateSubfolders.length > 0 || Boolean(folderIndex)}
                  onOpenNote={handleOpenNote}
                  onDeleteNote={handleDeleteNote}
                  onMoveNote={moveNoteAction}
                  onUpdateNoteStatus={handleUpdateNoteStatus}
                  onNewNote={() => openNewNote()}
                  sortField={sortField}
                  sortOrder={sortOrder}
                  onSortChange={handleSortChange}
                />
              )}
              {viewMode === 'card' && (
                <CardView
                  statuses={notebookStatuses}
                  readOnly={!canWrite}
                  canDelete={canWrite}
                  confirmDelete={remote}
                  notes={displayedNotes}
                  hasFolderEntries={immediateSubfolders.length > 0 || Boolean(folderIndex)}
                  onOpenNote={handleOpenNote}
                  onDeleteNote={handleDeleteNote}
                  onMoveNote={moveNoteAction}
                  onNewNote={() => openNewNote()}
                  onUpdateNoteStatus={handleUpdateNoteStatus}
                />
              )}
              {viewMode === 'kanban' && (
                <KanbanView
                  statuses={notebookStatuses}
                  readOnly={!canWrite}
                  canDelete={canWrite}
                  confirmDelete={remote}
                  notes={notesBelowFolders}
                  onOpenNote={handleOpenNote}
                  onUpdateNoteStatus={handleUpdateNoteStatus}
                  onDeleteNote={handleDeleteNote}
                  onMoveNote={moveNoteAction}
                  onNewNoteWithStatus={(status) => {
                    openNewNote(status);
                  }}
                  sortField={sortField}
                  sortOrder={sortOrder}
                  onSortChange={handleSortChange}
                />
              )}
              </div>
            </main>
          </>
        )}

        {activeTab === 'agent' && (
          <main className="workspace-route agent-main">
            <AgentSystemView
              notebooks={config?.notebooks || []}
              selectedNotebookId={selectedNotebookId}
              ref={agentSystemRef}
              onBusyChange={setResourceNavigationBusy}
              readOnly={!canWrite}
              remote={remote}
              onGitStatus={setGitStatus}
              readOnlyNotice={t(remote ? 'agent.remoteReadOnlyNotice' : branch === 'core' ? 'agent.coreBranchNotice' : 'agent.workspaceReadOnlyNotice')}
            />
          </main>
        )}

        {activeTab === 'assets' && (
          <main className="workspace-route assets-main has-sidebar-drawer">
            <FileManager key={`${sourceId}:${selectedNotebookId}`} ref={fileManagerRef}
              notebookId={selectedNotebookId} writable={canWrite} onSelectionChange={setSelectedFileEntry} metadataContainer={fileMetadataContainer}
              initialPath={new URLSearchParams(location.search).get('asset') || (new URLSearchParams(location.search).has('directory') ? `${folderRoot}/${config?.notebooks.find(nb => nb.id === selectedNotebookId)?.assets || 'assets'}${new URLSearchParams(location.search).get('directory') ? '/' + new URLSearchParams(location.search).get('directory') : ''}` : undefined)}
              onBusyChange={setResourceNavigationBusy} beforeChange={beforeFileChange}
              onChanged={onFilesChanged} onOpenIndex={openFileIndex} />
          </main>
        )}

        {activeTab === 'screen' && <React.Suspense fallback={<p role="status" className="p-8">{t('screen.loading')}</p>}><ScreenPage key={remote ? sourceId : repoRoot} screen={screen} editing={graphEditing} focusedLaneId={route.lane} onStudySaved={note => { if (note) { setNotes(values => values.map(value => value.path === note.path && value.notebookId === note.notebookId ? note : value)); } else { void refreshWorkspace(); } void fetchGitStatus().then(result => setGitStatus(result.status)).catch(error => setActionError((error as Error).message)); }} notebooks={config?.notebooks || []} notes={notes} folders={folders} selectedNotebookId={selectedNotebookId} onOpenNote={handleOpenNote} onCreateNote={openNewNote} /></React.Suspense>}

        {activeTab === 'graph' && (
          <main className="workspace-route graph-main flex-1 w-full h-full relative min-h-0">
            <React.Suspense fallback={<p role="status" className="p-8">{t('graph.title')}</p>}>
              <GraphPage
                key={remote ? sourceId : repoRoot}
                notebooks={config?.notebooks || []}
                notes={notes}
                filters={filterProps}
                folders={folders}
                screen={screen}
                editing={graphEditing}
                onOpenNote={handleOpenNote}
              />
            </React.Suspense>
          </main>
        )}

        {activeTab === 'settings' && (
          <main className="workspace-route settings-main has-sidebar-drawer">
            <SettingsModal
              config={config}
              branch={branch}
              repoRoot={remote ? sourceId.replace(/^(github|gitlab):/, '') : repoRoot}
              local={!remote}
              accountSettings={<AgentAccessSettings local={!remote} />}
              onRefreshWorkspace={refreshWorkspace}
              currentTheme={currentTheme}
              onSelectTheme={handleSelectTheme}
            />
          </main>
        )}

        <RightPanel
          fileMode={activeTab === 'assets'}
          fileMetadata={selectedFileEntry ? <FileMetadata entry={selectedFileEntry} onEdit={canWrite && !resourceNavigationBusy ? () => void fileManagerRef.current?.editMetadata() : undefined} /> : undefined}
          onFileMetadataContainer={setFileMetadataContainer}
          notes={notes}
          notebooks={config?.notebooks || []}
          selectedNotebookId={selectedNotebookId}
          onOpenNote={handleOpenNote}
          onSaveNote={handleSaveNote}
          gitStatus={gitStatus}
          deletedNotes={deletedNotes}
          onRestoreNote={handleRestoreNote}
          onOpenCommitModal={openCommitModal}
          writable={canWrite}
          remoteChanges={panelRemoteChanges}
          getPreview={panelGetPreview}
          onSynced={remote ? undefined : async () => { await refreshWorkspace(); await screen.refresh(); }}
        />
      </div>

      {activeTab !== 'screen' && screen.dirty && screen.error && <div role="alert" className="workspace-link-error">{screen.error}<button className="ui-button" onClick={() => navigate('/screen')}>{t('nav.screen')}</button></div>}

      {/* Undo Toast Notification (Requirement 2) */}
      {undoToast && (
        <div className="fixed top-20 right-6 z-50 animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="bg-slate-900/95 dark:bg-slate-800/95 text-white backdrop-blur-md px-4 py-3 rounded-xl shadow-xl border border-slate-700/80 flex items-center gap-3 text-xs">
            <span>
              {t('toast.noteMovedToTrash', { title: undoToast.note.title })}
            </span>
            <button
              onClick={() => handleRestoreNote(undoToast.note)}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-semibold rounded-md transition"
            >
              {t('common.undo')}
            </button>
            <button
              onClick={() => setUndoToast(null)}
              className="text-slate-400 hover:text-white p-1 rounded hover:bg-white/10 transition ml-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {fileDialog && <FileManagerDialog notebookId={fileDialog.notebookId} writable={canWrite}
        initialPath={fileDialog.path} movePath={fileDialog.movePath} beforeChange={beforeFileChange}
        onChanged={onFilesChanged} onOpenIndex={openFileIndex} onClose={() => setFileDialog(undefined)} />}
      {/* Note Editor Modal */}
      <EditorModal
        key={fileEditorRevision}
        statuses={resolveNoteStatuses(
          config?.notebooks.find(nb => nb.id === routedNote?.notebookId),
          notes.filter(note => note.notebookId === routedNote?.notebookId).map(note => note.status),
        )}
        metadataFields={config?.notebooks.find(nb => nb.id === routedNote?.notebookId)?.metadata}
        note={routedNote}
        isOpen={Boolean(routedNote) && !routeError}
        onClose={() => {

          setEditingNote(null);
          navigate(returnTo, { replace: true });
        }}
        onSave={handleSaveNote}
        onMoveNote={handleMoveNote}
        onRestoreFile={handleRestoreNoteFile}
        isDirty={Boolean(routedNote && gitStatus && [ ...gitStatus.modified, ...gitStatus.staged, ...gitStatus.untracked ].includes(routedNote.path))}
        availableTags={availableTags}
        assets={assets}
        onUploadAsset={!canWrite ? undefined : handleUploadAsset}
        onDeleteAsset={!canWrite ? undefined : handleDeleteAsset}
        onMoveAsset={!canWrite ? undefined : handleMoveAsset}
        readOnly={!canWrite}
        autoSave={true}
        draftMode={remote}
        remoteBase={routedNote ? activeWorkingNotes[routedNote.path]?.base || sourceNotes.find(note => note.path === routedNote.path) : undefined}
        conflictReason={routedNote ? activeWorkingNotes[routedNote.path]?.blocked : undefined}
        onMarkConflict={remote ? (reason, draft, base) => { stageWorkingNote(draft, base, reason); } : undefined}
        onReadRemote={remote && routedNote && activeWorkingNotes[routedNote.path]?.base !== null ? readNote : undefined}
        branch={branch}
        draftScope={`${sourceId}:${branch}`}
      />

      {/* Commit Modal */}
      <CommitModal
        writable={canWrite}
        remoteChanges={panelRemoteChanges}
        getPreview={panelGetPreview}
        request={commitRequest}
        restoreFile={remote ? async file => {
          if (file.path === SCREEN_PAGE_FILE) { if (file.revision !== screen.diff) throw new Error('Draft changed. Review it again.'); await screen.reload(); return; }
          const entry = readWorkingNotes(workingScope)[file.path];
          if (!entry || JSON.stringify(entry) !== file.revision) throw new Error('Draft changed. Review it again.');
          const latest = entry.base ? await readNote(file.path) : null;
          if (JSON.stringify(readWorkingNotes(workingScope)[file.path]) !== file.revision) throw new Error('Draft changed. Review it again.');
          setWorkingNotes(updateWorkingNote(workingScope, file.path, null));
          setNotes(previous => latest ? previous.map(note => note.path === file.path ? latest : note) : previous.filter(note => note.path !== file.path));
        } : undefined}
        commitFiles={remote ? commitWorkingNotes : undefined}
        isOpen={isCommitOpen}
        onClose={() => setIsCommitOpen(false)}
        gitStatus={gitStatus}
        onChanged={async () => {
          await refreshWorkspace();
          if (!remote) { await screen.refresh(); await agentSystemRef.current?.refresh(); }
        }}
        onCommitted={async () => {
          await refreshWorkspace();
          if (!remote) { await screen.refresh(); await agentSystemRef.current?.refresh(); }
          setDeletedNotes([]);
          setUndoToast(null);
        }}
      />

      {/* Create New Note Modal */}
      {isNewNoteOpen && (
        <div className="viewport-overlay fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className="rounded-2xl shadow-2xl border w-full max-w-md max-h-full overflow-y-auto p-4 md:p-6"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-base mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />
              {t('createNote.title')}
            </h3>

            {createError && <p id="create-note-error" role="alert" className="mb-3 text-sm text-red-600">{createError}</p>}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  {t('createNote.noteTitle')}
                </label>
                <input
                  type="text"
                  placeholder={t('createNote.placeholder')}
                  aria-describedby="create-note-error" value={newNoteTitle}
                  onChange={(e) => setNewNoteTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-black/5 dark:bg-white/5 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateNewNote();
                  }}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5" htmlFor="create-note-folder">
                  {t('createNote.folder')}
                </label>
                <input id="create-note-folder" type="text" list="create-note-folders" aria-label={t('createNote.folder')}
                  placeholder={t('createNote.folderPlaceholder')} value={newNoteFolder} onChange={event => setNewNoteFolder(event.target.value)}
                  className="ui-control" autoComplete="off" />
                <datalist id="create-note-folders">{newNoteFolders.map(folder => <option key={folder} value={folder} />)}</datalist>
              </div>

              {newNoteTemplates.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                    {t('createNote.template')}
                  </label>
                  <Select aria-label={t('createNote.template')} value={newNoteTemplateId} onValueChange={handleTemplateChange}
                    options={[{ value: '', label: t('createNote.noTemplate') }, ...newNoteTemplates.map(tpl => ({ value: tpl.id, label: tpl.title }))]}
                    className="w-full" />
                </div>
              )}

              {newNoteTags.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                    {t('notes.tags')}
                  </label>
                  <div className="flex flex-wrap gap-1.5 py-1">
                    {newNoteTags.map(tag => (
                      <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  {t('createNote.initialStatus')}
                </label>
                <Select aria-label={t('createNote.initialStatus')} value={newNoteStatus} onValueChange={setNewNoteStatus} options={notebookStatuses.map(value => ({value,label:value}))} className="w-full" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => { setIsNewNoteOpen(false); setNewNoteTags([]); setNewNoteTemplateId(''); }}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition active:scale-95"
              >
                {t('common.cancel')}
              </button>
              <Button variant="primary"
                onClick={() => handleCreateNewNote()}
                disabled={!newNoteTitle.trim()}
>
                {t('createNote.submit')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
    </WorkspaceLinks>
  );
};

export const App: React.FC = () => {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
};
