import type { ChangeRequest } from './lib/types.js';
import { useQueryStates } from 'nuqs';
import { filterParsers, type FilterQuery, writeFilterQuery } from './lib/filter-query.js';
import { legacyFolderPaths, type NoteFilters } from '@mygitnotes/core/note-filters';
import { type NoteListItem, type NoteQuery, noteQueryStatuses } from '@mygitnotes/core/note-query';
import type { FilterControls } from './lib/filter-controls.js';
import { adoptGraphDrafts, listLocalDrafts } from './lib/storage.js';
import { useWorkspaceSync } from './lib/use-workspace-sync.js';
import { WorkspaceLinks } from './components/WorkspaceLinks.js';
import { ImageLightbox } from './components/ImageLightbox.js';
import { isNoteHidden } from '@mygitnotes/core/note-status';
import { useLocation, useNavigate } from 'react-router-dom';
import { legacyAllNotebooksRoute, notebookRoute, noteReturnRoute, noteRoute, parseWorkspaceRoute, WorkspaceTab } from './lib/routes.js';
import { clearCommittedNotes, readWorkingNotes, updateWorkingNote, workingDiff, type WorkingNotes } from './lib/working-notes.js';
import { mergeNote, sameValue } from './lib/merge-note.js';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError, commitRemoteNotes, deleteNote, fetchAssets, fetchGitStatus, fetchWorkspace, readNote, readNotes, restoreNote, saveNote } from './lib/api.js';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateNoteQueries, NOTE_QUERY_KEY, noteLookupOptions, setNoteQueryScope, useNoteFacets, useNoteList, useNoteLookup, useNoteQueryScope, useStaleNoteQueries } from './lib/use-note-queries.js';
import { useDebounced } from './lib/use-debounced.js';
import { noteStatusChange } from './lib/note-mutations.js';
import { NoteListSentinel } from './components/NoteListSentinel.js';
import type { NoteItem, ViewMode } from './lib/types.js';
import { useTagWorkspaceOperations } from './app/useTagWorkspaceOperations.js';
import { useAssetOperations } from './app/useAssetOperations.js';
import { useRoutedNote } from './app/useRoutedNote.js';
import { useNewNoteDialog } from './app/useNewNoteDialog.js';
import { NewNoteDialog } from './app/NewNoteDialog.js';
import { applyTheme, getSavedTheme, ThemeChoice } from './lib/themes.js';
import { AgentAccessSettings, AuthControls, ConnectionState } from './components/AuthControls.js';
import { Header } from './components/Header.js';
import { KeyboardShortcuts, type PaletteCommand, type ShortcutSurfaceMode } from './components/KeyboardShortcuts.js';
import { NoteToolbar } from './components/NoteToolbar.js';
import { PageToolbar, RIGHT_PANEL_RAIL_WIDTH, SidebarProvider, WorkspaceSidebarPortal, WorkspaceSplitLayout } from './components/WorkspaceChrome.js';
import { useVisualViewport } from './lib/use-visual-viewport.js';
import { useSidebarSwipe } from './lib/use-sidebar-swipe.js';
import { Sidebar } from './components/Sidebar.js';
import { ListView } from './components/ListView.js';
import { CardView } from './components/CardView.js';
import { KanbanView } from './components/KanbanView.js';
import { EditorModal } from './components/EditorModal.js';
import type { NoteEditorSharedProps } from './components/NoteEditor.js';
import { NoteEditingProvider, useNoteEditorRegistry } from './lib/note-editing.js';
import { FOCUS_DIVISIONS, type FocusTab, focusTabKey } from '@mygitnotes/core/focus-page';
import { useNoteFocus } from './lib/use-note-focus.js';
import { CURRENT_FOCUS, displayedPanes } from './lib/focus-view.js';
import { FocusArea, usePaneCapacity } from './components/FocusArea.js';
import { FocusControls } from './components/FocusControls.js';
import { AddToFocusDialog } from './components/AddToFocusDialog.js';
import { FocusLaneTab } from './components/FocusLaneTab.js';
import { FocusList } from './components/FocusList.js';
import { BrowseDock, BrowseDockToggle, CARD_TWO_ROW_HEIGHT } from './components/BrowseDock.js';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
import { RightPanel } from './components/RightPanel.js';
import { type DocumentToolId, isDocumentTool, usePanelContext } from './lib/panel-context.js';
import { FileManager, FileManagerDialog, type FileManagerHandle, FileMetadata } from './components/FileManager.js';
import { type FileEntry, type FileResult, mutateFile } from './lib/files-api.js';
import { type AgentSystemHandle, AgentSystemView } from './components/AgentSystemView.js';
import { SettingsModal } from './components/SettingsModal.js';
import { CommitModal } from './components/CommitModal.js';
import { Breadcrumbs } from './components/Breadcrumbs.js';
import { FolderIndex } from './components/FolderIndex.js';
import { FolderLinks } from './components/FolderLinks.js';
import { getBreadcrumbs, getImmediateSubfolders } from './lib/folder-tree.js';
import { mergeNotebookFacets, queryNotebookIds } from './lib/note-facets.js';
import { getSavedSort, saveSort, SortField, SortOrder } from './lib/note-sort.js';
import { I18nProvider, type TranslationKey, useTranslation } from './lib/i18n/index.js';
import { AlertTriangle, X } from 'lucide-react';

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
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Route and source transitions reset transient UI and load the newly selected document. */
    setFiltersOpen(false);
    /* eslint-enable react/set-state-in-effect */
  }, [location.pathname]);
  useEffect(() => {
    if (!filtersOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [filtersOpen]);
  // Theme State
  const [currentTheme, setCurrentTheme] = useState<ThemeChoice>(() => getSavedTheme());

  useEffect(() => {
    applyTheme(currentTheme);
    if (currentTheme.mode !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => applyTheme(currentTheme);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [currentTheme]);

  const handleSelectTheme = (theme: ThemeChoice) => setCurrentTheme(theme);

  const [editingNote, setEditingNote] = useState<NoteListItem | null>(null);
  const [fileEditorRevision, setFileEditorRevision] = useState(0);
  const [fileDialog, setFileDialog] = useState<{ notebookId: string; path?: string; movePath?: string; }>();
  const [fileMetadataContainer, setFileMetadataContainer] = useState<HTMLDivElement | null>(null);
  const [fileMetadataOpen, setFileMetadataOpen] = useState(false);
  // Seeded to the rail width (not 0) so the right panel mounts on first render and can report
  // its real width via onWidthChange — a 0 seed would never let it mount in the first place.
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_RAIL_WIDTH);
  const [selectedFileEntry, setSelectedFileEntry] = useState<FileEntry>();
  const fileManagerRef = useRef<FileManagerHandle>(null);

  // The URL owns page, notebook, folder and filter selection.
  const navigate = useNavigate();
  const editorRoute = useMemo(() => parseWorkspaceRoute(location.pathname, location.search), [location.pathname, location.search]);

  const { selectedNotebookId, folders, sourceId, remote, canWrite, revision, setRevision, loadError, loading, actionError, setActionError, repoRoot, branch, config, gitStatus, setGitStatus, assets, setAssets, setWorkingNotes, workingScope, activeWorkingNotes, screen, focus: focusPage, documents, pendingDocuments, refreshWorkspace, stageWorkingNote } = useWorkspaceSync({ routeNotebook: editorRoute.notebook || undefined, onStageNote: note => setEditingNote(current => current?.path === note.path && !sameValue(current, note) ? note : current) });
  const refreshDocuments = async () => {
    await Promise.all(documents.map(document => document.refresh()));
  };
  const editorRegistry = useNoteEditorRegistry();

  // Every note query is answered for this source and revision; staged drafts are overlaid on top.
  const queryClient = useQueryClient();
  useLayoutEffect(() => {
    setNoteQueryScope({ sourceId, revision, drafts: activeWorkingNotes });
  }, [sourceId, revision, activeWorkingNotes]);
  const queryScope = useNoteQueryScope();
  const invalidateNotes = () => {
    void invalidateNoteQueries(queryClient);
  };
  // Staged drafts are overlaid on remote answers; only local saves change what the note queries return.
  const refreshNotes = async () => {
    if (!remote) await invalidateNoteQueries(queryClient);
  };
  // The server answers from the branch head: a rejected revision or cursor means this client is
  // behind, so the workspace is refreshed and every list restarts from its first page.
  const [staleNotice, setStaleNotice] = useState('');
  useStaleNoteQueries(message => {
    setStaleNotice(message);
    void refreshWorkspace().then(() => queryClient.resetQueries({ queryKey: NOTE_QUERY_KEY }));
  });
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Route and source transitions reset transient UI and load the newly selected document. */
    setStaleNotice('');
    /* eslint-enable react/set-state-in-effect */
  }, [revision]);
  /** The committed note behind a path, ignoring any staged draft, for use as a merge base. */
  const readCommittedNote = async (path: string): Promise<NoteItem> => {
    const result = await queryClient.fetchQuery(noteLookupOptions(queryScope, [path], true));
    const note = result.notes.find(item => item.path === path);
    if (!note || typeof note.content !== 'string') throw new Error(t('notes.readFailed', { path }));
    return note as NoteItem;
  };
  /** The note a change must be applied to: the staged draft when there is one, else the committed note. */
  const readNoteForChange = async (path: string): Promise<NoteItem> => {
    const pending = remote ? readWorkingNotes(workingScope)[path] : undefined;
    return pending ? pending.note : readCommittedNote(path);
  };
  // Deletion and Undo Buffer State (Requirement 2)
  const [deletedNotes, setDeletedNotes] = useState<NoteItem[]>([]);
  const [undoToast, setUndoToast] = useState<{ note: NoteItem; timerId: any; } | null>(null);

  // Tag management: rename/merge/delete across the whole workspace, each a single commit
  // with a session-lifetime undo (kept in `tagOperations.history` until page reload).
  const { tagOperations, previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag, handleUndoTagOperation } = useTagWorkspaceOperations({ queryClient, queryScope, revision, remote, canWrite, t, invalidateNotes, setRevision, setActionError });

  const editorNotebookId = editorRoute.notebook || config?.workspace.default_notebook || config?.notebooks[0]?.id || 'example';
  const returnTo = noteReturnRoute(location.search, editorNotebookId, editorRoute.folder);
  const route = useMemo(() => {
    if (!editorRoute.note) return { ...editorRoute, ...queryState, tag: queryState.tag[0] || null, tags: queryState.tag };
    const origin = new URL(returnTo, window.location.origin);
    return parseWorkspaceRoute(origin.pathname, origin.search);
  }, [editorRoute, returnTo, queryState]);
  const activeTab = route.tab;
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Route and source transitions reset transient UI and load the newly selected document. */
    setFolderReorder(false);
    /* eslint-enable react/set-state-in-effect */
  }, [activeTab, route.notebook]);
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Route and source transitions reset transient UI and load the newly selected document. */
    setFileMetadataOpen(false);
    /* eslint-enable react/set-state-in-effect */
  }, [activeTab]);
  const sidebarGestureRef = useSidebarSwipe(activeTab === 'notes' && !loading && !loadError, filtersOpen, setFiltersOpen);
  const selectedFolders = useMemo(() => route.folders.length ? [...new Set(route.folders)] : legacyFolderPaths(config?.notebooks || [], selectedNotebookId, route.folder), [route.folders, route.folder, config, selectedNotebookId]);
  const folderRoot = config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root.replace(/\/$/, '');
  const selectedFolder = selectedFolders.length === 1 && folderRoot && selectedFolders[0].startsWith(folderRoot + '/') ? selectedFolders[0].slice(folderRoot.length + 1) : route.folder;
  // Notes and Graph query every notebook while the all-notebooks toggle is on; the current notebook stays selected.
  const scopeNotebookId = route.allNotebooks ? 'all' : selectedNotebookId;
  const selectedStatus = route.status;
  const showHidden = route.showHidden;
  // Counts, status options, tag lists and subfolder counts all come from one facet answer.
  const facetsQuery = useNoteFacets(showHidden);
  const facetNotebookIds = useMemo(() => queryNotebookIds(config?.notebooks || [], scopeNotebookId, selectedFolders), [config, scopeNotebookId, selectedFolders]);
  const notebookFacets = useMemo(() => mergeNotebookFacets(facetNotebookIds.flatMap(id => facetsQuery.facets?.[id] || [])), [facetsQuery.facets, facetNotebookIds]);
  const notebookStatuses = useMemo(() => noteQueryStatuses(config?.notebooks || [], facetNotebookIds.length === 1 ? facetNotebookIds[0] : 'all', Object.keys(notebookFacets.statuses)), [config, facetNotebookIds, notebookFacets]);
  // A new note is created in the current notebook, so it offers that notebook's statuses even while every notebook is listed.
  const newNoteStatuses = useMemo(() => noteQueryStatuses(config?.notebooks || [], selectedNotebookId, Object.keys(facetsQuery.facets?.[selectedNotebookId]?.statuses || {})), [config, selectedNotebookId, facetsQuery.facets]);
  const selectedTags = useMemo(() => [...new Set(route.tags)], [route.tags]);
  // Stable across renders so memoized note rows skip re-rendering; calls reach the latest handlers.
  const tagHandlers = useRef({ previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag });
  useLayoutEffect(() => {
    tagHandlers.current = { previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag };
  });
  // The tag vocabulary spans hidden notes too, so it has its own facet answer.
  const tagFacets = useNoteFacets(true);
  const workspaceTagNames = useMemo(() => Array.from(new Set(Object.values(tagFacets.facets || {}).flatMap(facets => Object.keys(facets.tags)))), [tagFacets.facets]);
  const noteTagActions = useMemo(() => canWrite ? { allTags: workspaceTagNames, onPreviewUsage: (tag: string) => tagHandlers.current.previewTagUsage(tag), onRename: (from: string, to: string) => tagHandlers.current.handleRenameTag(from, to), onMerge: (from: string, into: string) => tagHandlers.current.handleMergeTag(from, into), onDelete: (tag: string) => tagHandlers.current.handleDeleteTag(tag) } : undefined, [canWrite, workspaceTagNames]);
  const searchQuery = route.q;
  const viewMode = route.view;
  // Flat and Kanban list the whole notebook, without folder navigation.
  const folderless = viewMode === 'flat' || viewMode === 'kanban';

  // Focus: the URL names the displayed one; named Focus sync through their workspace document.
  const focusCapacity = usePaneCapacity();
  const notebookLanes = useMemo(() => screen.loading || screen.error ? undefined : screen.page.rows.filter(row => row.notebookId === selectedNotebookId), [screen.loading, screen.error, screen.page, selectedNotebookId]);
  const noteFocus = useNoteFocus({ page: focusPage, notebookId: selectedNotebookId, scope: remote ? sourceId : `local:${repoRoot}`, focusKey: activeTab === 'notes' ? route.focus : null, writable: canWrite, lanes: notebookLanes, flushEditors: editorRegistry.flushEditors });
  const focusDisplay = noteFocus.layout && noteFocus.entry ? displayedPanes(noteFocus.entry, noteFocus.layout, focusCapacity) : undefined;
  /** On phones the browse region and the Focus take turns filling the screen. */
  const [focusNarrowView, setFocusNarrowView] = useState<'focus' | 'browse'>('focus');
  const [addingToFocus, setAddingToFocus] = useState<{ tab: FocusTab; label: string; } | null>(null);
  // The rail shows the active pane's document panel when that pane displays a note.
  const panel = usePanelContext();
  const [documentContainer, setDocumentContainer] = useState<HTMLDivElement | null>(null);
  const activePaneNote = Boolean(noteFocus.entry && focusDisplay?.panes.find(pane => pane.panes.includes(noteFocus.entry!.activePane))?.key?.startsWith('note:'));
  const focusDocumentPanel = {
    target: documentContainer,
    mode: panel.isOpen && isDocumentTool(panel.activeTool) ? panel.activeTool : null,
    onChange: (mode: DocumentToolId | null) => {
      if (!mode) panel.close();
      else if (!panel.isOpen || panel.activeTool !== mode) panel.openTool(mode);
    },
  };
  /** Shows a Focus (`current` or an id), or returns to normal browsing with null. */
  const showFocus = async (key: string | null) => {
    if (!await editorRegistry.flushEditors()) return;
    if (!key) noteFocus.forget();
    const query = new URLSearchParams(location.search);
    if (key) query.set('focus', key);
    else query.delete('focus');
    setFocusNarrowView('focus');
    navigate({ pathname: location.pathname, search: query.toString() });
  };
  // Arriving at a notebook's Notes page shows the Focus it displayed last.
  const focusArrival = useRef('');
  /* eslint-disable react-hooks/exhaustive-deps -- This effect responds to route arrival; current query and navigation helpers supply the transition snapshot. */
  useEffect(() => {
    if (activeTab !== 'notes') {
      focusArrival.current = '';
      return;
    }
    if (loading || editorRoute.note) return;
    const arrival = `${sourceId}:${selectedNotebookId}`;
    if (focusArrival.current === arrival) return;
    focusArrival.current = arrival;
    if (route.focus || !noteFocus.view.last) return;
    const query = new URLSearchParams(location.search);
    query.set('focus', noteFocus.view.last);
    navigate({ pathname: location.pathname, search: query.toString() }, { replace: true });
  }, [activeTab, loading, editorRoute.note, sourceId, selectedNotebookId]);
  /* eslint-enable react-hooks/exhaustive-deps */
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
  // Leaving the all-notebooks scope restores the folder filters chosen before it, within the current notebook.
  const foldersBeforeAllNotebooks = useRef<string[] | null>(null);
  const changeAllNotebooks = (value: boolean) => {
    if (value) {
      foldersBeforeAllNotebooks.current = selectedFolders;
      void setFilterQuery({ allNotebooks: true });
      return;
    }
    const restored = (foldersBeforeAllNotebooks.current ?? selectedFolders).filter(path => folderRoot && path.startsWith(folderRoot + '/'));
    foldersBeforeAllNotebooks.current = null;
    void setFilterQuery({ allNotebooks: false, folders: restored });
  };
  const setActiveTab = async (tab: WorkspaceTab) => {
    if (resourceNavigationBusy || notebookSwitchBusy || activeTab === tab) return;
    setNotebookSwitchBusy(true);
    try {
      if (activeTab === 'agent' && !await agentSystemRef.current?.prepareLeave()) return;
      if (activeTab === 'assets' && !await fileManagerRef.current?.prepareLeave()) return;
      if (activeTab === 'notes' && !await editorRegistry.flushEditors()) return;
      if (tab === 'notes' || tab === 'graph') {
        const query = currentFilterSearch({ view: viewMode === 'graph' ? 'flat' : viewMode });
        query.delete('focus');
        query.set('notebook', selectedNotebookId);
        await navigateFiltered(tab === 'notes' ? notebookRoute(selectedNotebookId) : '/graph', query);
      } else {
        const query = new URLSearchParams({ notebook: selectedNotebookId });
        // The Files page opens at the folder selected in Notes.
        if (tab === 'assets' && selectedFolder && folderRoot) query.set('asset', `${folderRoot}/${selectedFolder}`);
        navigate(`/${tab === 'assets' ? 'files' : tab}?${query.toString()}`);
      }
    } finally {
      setNotebookSwitchBusy(false);
    }
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
      if (activeTab === 'notes' && !await editorRegistry.flushEditors()) return;
      const query = currentFilterSearch({ folders: [] });
      query.delete('focus');
      query.set('notebook', id);
      await navigateFiltered(activeTab === 'notes' ? notebookRoute(id) : `/${activeTab}`, query);
    } finally {
      setNotebookSwitchBusy(false);
    }
  };
  const setSelectedFolder = (folder: string | null) => {
    const query = currentFilterSearch({ folders: legacyFolderPaths(config?.notebooks || [], selectedNotebookId, folder) });
    void navigateFiltered(notebookRoute(selectedNotebookId), query);
  };
  const setViewMode = (mode: ViewMode) => {
    void setFilterQuery({ view: mode });
  };
  /* eslint-disable react-hooks/exhaustive-deps -- This effect responds to route arrival; current query and navigation helpers supply the transition snapshot. */
  useEffect(() => {
    if (!config) return;
    const canonical = legacyAllNotebooksRoute(location.pathname, location.search, selectedNotebookId);
    if (canonical) navigate(canonical + location.hash, { replace: true });
  }, [config, location.pathname, location.search]);
  /* eslint-enable react-hooks/exhaustive-deps */
  /* eslint-disable react-hooks/exhaustive-deps -- This effect responds to route arrival; current query and navigation helpers supply the transition snapshot. */
  useEffect(() => {
    if (loading || !config || editorRoute.note || route.tab !== 'notes' || route.view !== 'graph') return;
    const query = currentFilterSearch({ view: 'flat' });
    query.delete('focus');
    query.set('notebook', selectedNotebookId);
    void navigateFiltered('/graph', query, true);
  }, [loading, config, editorRoute.note, route.tab, route.view]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Modal States
  const [commitRequest, setCommitRequest] = useState<ChangeRequest>();
  const [isCommitOpen, setIsCommitOpen] = useState<boolean>(false);
  const [shortcutMode, setShortcutMode] = useState<ShortcutSurfaceMode | null>(null);

  // Aggregated tags across the workspace for autocomplete
  const availableTags = useMemo(() => Array.from(new Set(workspaceTagNames.map(tag => tag.trim()))).filter(Boolean).sort(), [workspaceTagNames]);

  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Route and source transitions reset transient UI and load the newly selected document. */
    setEditingNote(null);
    /* eslint-enable react/set-state-in-effect */
    setDeletedNotes([]);
  }, [sourceId]);

  const { routedNote, routedCommitted, routedLoading, routeError } = useRoutedNote({ config, editorRoute, editorNotebookId, editingNote, loading, sourceId, setEditingNote });

  const noteFilters = useMemo<NoteFilters>(() => ({ notebookId: scopeNotebookId, folders: selectedFolders, tags: selectedTags, descendants: route.descendants, tagMode: route.tagMode, q: searchQuery, status: selectedStatus, showHidden }), [scopeNotebookId, selectedFolders, selectedTags, route.descendants, route.tagMode, searchQuery, selectedStatus, showHidden]);
  const hasCollectionFilter = selectedFolders.length > 0 || selectedTags.length > 0 || scopeNotebookId === 'all';
  // Typing in the search box must not fire one server query per keystroke.
  const debouncedSearch = useDebounced(searchQuery);
  const filtered = Boolean(debouncedSearch.trim() || selectedStatus || hasCollectionFilter);
  const notebookRoot = config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root.replace(/\/$/, '') || '';
  const currentDirectory = [notebookRoot, selectedFolder].filter(Boolean).join('/');

  // Choose by filename before applying visibility so a hidden index keeps priority.
  const browsingNotes = activeTab === 'notes';
  const indexCandidates = useMemo(() => (browsingNotes && !filtered && notebookRoot ? [`${currentDirectory}/index.md`, `${currentDirectory}/README.md`] : []), [browsingNotes, filtered, notebookRoot, currentDirectory]);
  const indexLookup = useNoteLookup(indexCandidates, false);
  const folderIndex = useMemo(() => {
    const selected = indexLookup.notes.find(note => note.path === indexCandidates[0]) ?? indexLookup.notes.find(note => note.path === indexCandidates[1]);
    return selected && (showHidden || !isNoteHidden({ ...selected.metadata, status: selected.status })) ? selected : undefined;
  }, [indexLookup.notes, indexCandidates, showHidden]);

  const baseQuery = useMemo<Partial<NoteQuery>>(() => ({ notebookId: scopeNotebookId, folders: selectedFolders, descendants: route.descendants, tags: selectedTags, tagMode: route.tagMode, status: selectedStatus, showHidden, q: debouncedSearch, sort: sortField, order: sortOrder }), [scopeNotebookId, selectedFolders, route.descendants, selectedTags, route.tagMode, selectedStatus, showHidden, debouncedSearch, sortField, sortOrder]);
  // Browsing a folder lists that one directory; searching or filtering lists the whole result.
  const listQuery = useMemo<Partial<NoteQuery>>(() => (filtered || viewMode === 'flat' || viewMode === 'kanban' ? baseQuery : { ...baseQuery, folders: currentDirectory ? [currentDirectory] : [], descendants: false }), [baseQuery, filtered, viewMode, currentDirectory]);
  // Only the notes page lists notes; the other tabs ask for what they draw themselves.
  const listResult = useNoteList(browsingNotes && viewMode !== 'kanban' ? listQuery : null, { content: viewMode === 'card', hide: folderIndex?.path });
  // Kanban pages each column on its own, so the filter result count needs its own answer.
  const kanbanCount = useNoteList(browsingNotes && filtered && viewMode === 'kanban' ? baseQuery : null);
  const filterCount = filtered ? (viewMode === 'kanban' ? kanbanCount.total : listResult.total) : (facetsQuery.facets ? notebookFacets.total : null);
  const displayedNotes = listResult.notes;

  const filterProps: FilterControls = { value: noteFilters, neighbors: route.neighbors, notebooks: config?.notebooks || [], folders, tags: Object.keys(notebookFacets.tags), statuses: notebookStatuses, count: filterCount, allNotebooks: route.allNotebooks, onAllNotebooksChange: changeAllNotebooks, onChange: changeFilters, onClear: clearFilters };

  // Hierarchical Subfolder Discovery for current folder
  const immediateSubfolders = useMemo(() => {
    if (folderless || filtered) return [];
    return getImmediateSubfolders(notebookFacets.directories, folders, selectedNotebookId, notebookRoot, selectedFolder);
  }, [notebookFacets, folders, selectedNotebookId, notebookRoot, selectedFolder, filtered, folderless]);

  // Breadcrumb Trail from Root to current folder
  const breadcrumbs = useMemo(() => {
    return getBreadcrumbs(selectedFolder, folders, selectedNotebookId, t('folder.allFolders'));
  }, [selectedFolder, folders, selectedNotebookId, t]);

  // Note Handlers
  const handleOpenNote = async (note: NoteListItem, anchor = '') => {
    // Zoom is a Notes route: leaving another tab unmounts its graph cards, so their edits are saved first.
    if (activeTab !== 'notes' && !await editorRegistry.flushEditors()) return;
    setEditingNote(note);

    const notebook = config?.notebooks.find(nb => nb.id === note.notebookId);
    if (notebook) {
      const query = new URLSearchParams(location.search);
      query.delete('notebook');
      query.set('returnTo', editorRoute.note ? returnTo : location.pathname + location.search + location.hash);
      if (selectedFolder && note.notebookId === selectedNotebookId) query.set('folder', selectedFolder);
      else query.delete('folder');
      navigate(noteRoute(notebook.id, note.path.slice(notebook.root.length + 1)) + '?' + query.toString() + (anchor ? '#' + encodeURIComponent(anchor) : ''));
    }
    const targetNotebook = note.notebookId || selectedNotebookId;
    if (targetNotebook) {
      fetchAssets(targetNotebook).then(setAssets).catch(console.error);
    }
  };
  /** In a displayed Focus a note of this notebook opens in a pane: the active one, or beside `source`; false leaves it to zoom. */
  const openInFocus = async (note: NoteListItem, source?: number) => {
    if (!noteFocus.shown || note.notebookId !== selectedNotebookId) return false;
    const result = await noteFocus.openNote(note.path, source);
    if (result === 'opened') setFocusNarrowView('focus');
    return result === 'opened' || result === 'blocked';
  };
  const openFromBrowse = async (note: NoteListItem) => {
    if (!await openInFocus(note)) await handleOpenNote(note);
  };
  const openLink = async (note: NoteListItem, anchor?: string, source?: HTMLElement) => {
    const pane = source?.closest<HTMLElement>('[data-focus-pane]')?.dataset.focusPane;
    if (pane === undefined || !await openInFocus(note, Number(pane))) await handleOpenNote(note, anchor);
  };
  const zoomFocusNote = (path: string) => {
    const note = noteFocus.notes.get(path);
    if (note) void handleOpenNote(note);
  };
  const addToFocus = (note: NoteItem) => note.notebookId === selectedNotebookId ? () => setAddingToFocus({ tab: { kind: 'note', path: note.path }, label: note.title }) : undefined;

  const handleSaveNote = async (params: { path: string; content: string; metadata?: Record<string, unknown>; notebookId?: string; revision?: string; baseNote?: NoteItem; }) => {
    if (!canWrite) throw new Error('This workspace is read-only.');
    if (remote) {
      // A draft is staged against the committed note it was edited from; read it when the
      // caller did not bring one, so nothing is written from a list row without a body.
      const pending = readWorkingNotes(workingScope)[params.path];
      const base = pending?.base === null ? null : params.baseNote || pending?.base || await readCommittedNote(params.path);
      const original = pending?.note || base;
      if (!original) throw new Error(t('notes.unavailable'));
      return stageWorkingNote({ ...original, content: params.content, metadata: params.metadata || original.metadata, title: typeof params.metadata?.title === 'string' ? params.metadata.title : original.title, status: typeof params.metadata?.status === 'string' ? params.metadata.status : undefined, tags: Array.isArray(params.metadata?.tags) ? params.metadata.tags.map(String) : [], revision: base?.revision || original.revision }, base, pending?.blocked);
    }
    // Local saves update the working tree for the explicit Commit action.
    const res = await saveNote({ ...params, notebookId: params.notebookId || selectedNotebookId, noCommit: true });
    // The local workspace keeps one revision, so its cached query answers are refetched.
    invalidateNotes();
    setEditingNote(prev => prev?.path === res.note.path ? res.note : prev);
    // Refresh git status to update dirty count
    const statusRes = await fetchGitStatus();
    setGitStatus(statusRes.status);
    return res.note;
  };

  // Drafts the retired graph editing store left behind join the editor's own draft recovery.
  useEffect(() => adoptGraphDrafts(`${sourceId}:${branch}`), [sourceId, branch]);

  // Remote delete: no working tree to trash into, so commit the removal immediately.
  const handleRemoteDeleteNote = async (note: NoteListItem) => {
    if (!canWrite) return;
    let result: FileResult;
    try {
      result = await mutateFile({ kind: 'delete', notebookId: note.notebookId, path: note.path }, note.revision || revision);
    } catch (error) {
      setActionError((error as Error).message);
      throw error;
    }
    // Apply everything in one synchronous batch: the still-mounted editor must not re-stage a
    // phantom draft for the path we just deleted while the new revision is being queried.
    setRevision(result.revision);
    setWorkingNotes(updateWorkingNote(workingScope, note.path, null));
    if (editingNote?.path === note.path) {
      setEditingNote(null);
      navigate(returnTo, { replace: true });
    }
  };

  // Trash action: delete without immediate commit, allowing restore (Requirement 2)
  const handleDeleteNote = async (note: NoteListItem) => {
    if (!canWrite) return;
    if (remote) return handleRemoteDeleteNote(note);
    // 1. Read the full note first; Undo restores it from this buffer.
    let deleted: NoteItem;
    try {
      deleted = await readNoteForChange(note.path);
    } catch (error) {
      setActionError((error as Error).message);
      return;
    }
    setDeletedNotes((prev) => [deleted, ...prev.filter((n) => n.path !== note.path)]);

    // 2. Delete from disk without committing to git
    await deleteNote(note.path, { noCommit: true });
    invalidateNotes();
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
    setUndoToast({ note: deleted, timerId });
  };

  // Restore deleted note before commit (Requirement 2)
  const handleRestoreNote = async (note: NoteItem) => {
    const res = await restoreNote({ path: note.path, content: note.content, metadata: note.metadata, notebookId: note.notebookId });
    if (!res.note) throw new Error('The deleted note could not be restored.');
    invalidateNotes();
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
          setEditingNote(null);
          navigate(returnTo, { replace: true });
          return null;
        }
        const latest = await readNote(notePath);
        setWorkingNotes(updateWorkingNote(workingScope, notePath, null));
        setEditingNote(latest);
        return latest;
      }
      const res = await restoreNote({ path: notePath });
      const restored = res.note;
      invalidateNotes();
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
  const handleUpdateNoteStatus = async (note: NoteListItem, newStatus: string) => {
    setActionError('');
    // The row carries no body; the note is read in full before the status is written.
    try {
      await handleSaveNote(await noteStatusChange(readNoteForChange, note, newStatus));
    } catch (error) {
      setActionError((error as Error).message);
    }
  };

  const handleOpenFolderIndex = async (folder: string, folderRevision?: string, notebookId = selectedNotebookId) => {
    if (!canWrite) throw new Error(t('folder.readOnly'));
    const notebook = config?.notebooks.find(item => item.id === notebookId);
    if (!notebook) throw new Error(t('route.notebookNotFound'));
    const path = `${notebook.root.replace(/\/$/, '')}/${folder}/index.md`;
    const existing = (await queryClient.fetchQuery(noteLookupOptions(queryScope, [path], true))).notes.find(item => item.path === path);
    let note: NoteListItem | undefined = (remote ? readWorkingNotes(workingScope)[path]?.note : undefined) || existing;
    if (!note) {
      const metadata = { title: t('folder.index'), tags: [] };
      const content = `# ${t('folder.index')}\n\n`;
      note = remote ? stageWorkingNote({ id: path, path, notebookId: notebook.id, title: metadata.title, content, metadata, tags: [], revision: folderRevision || revision }, null) : (await saveNote({ path, notebookId: notebook.id, content, metadata, createOnly: true, noCommit: true })).note;
      if (!remote) invalidateNotes();
    }
    setEditingNote(note);
    const query = new URLSearchParams(location.search);
    query.delete('notebook');
    query.set('folder', folder);
    navigate(noteRoute(notebook.id, `${folder}/index.md`) + '?' + query.toString());
    if (!remote) void fetchGitStatus().then(result => setGitStatus(result.status)).catch(error => setActionError(error.message));
  };

  // Create New Note dialog: its form state and the handlers that render or persist a new note draft.
  const { createError, isNewNoteOpen, setIsNewNoteOpen, newNoteTitle, setNewNoteTitle, newNoteStatus, setNewNoteStatus, newNoteFolder, setNewNoteFolder, newNoteTags, setNewNoteTags, newNoteTemplateId, setNewNoteTemplateId, newNoteFolders, newNoteTemplates, handleTemplateChange, openNewNote, handleCreateNewNote } = useNewNoteDialog({ config, selectedNotebookId, setSelectedNotebookId, folders, remote, canWrite, workingScope, queryClient, queryScope, stageWorkingNote, revision, invalidateNotes, setGitStatus, sourceId, newNoteStatuses, t, onCreated: handleOpenNote });

  const commitWorkingNotes = async (files: string[], message: string) => {
    const pending = readWorkingNotes(workingScope);
    const sentDocuments = documents.filter(document => files.includes(document.file)).map(document => document.prepareCommit());
    const selected = files.filter(file => !sentDocuments.some(document => document.path === file)).map(file => pending[file]).filter(Boolean);
    if (selected.length + sentDocuments.length !== files.length) throw new Error('Pending files changed. Review the selection again.');
    const workspace = await fetchWorkspace(true);
    if (!workspace.capabilities.write || workspace.source.identity !== sourceId) throw new Error('Sign in with write access to this workspace before committing.');
    const expected = workspace.revision!;
    const sent: WorkingNotes = {};
    let reviewRequired = false;
    const existingPaths = selected.filter(entry => entry.base).map(entry => entry.note.path);
    const latestNotes = existingPaths.length ? await readNotes(existingPaths, expected) : [];
    const latestByPath = new Map(latestNotes.map(note => [note.path, note]));
    for (const entry of selected) {
      if (entry.blocked) throw new Error(`${entry.note.path}: ${t(entry.blocked as TranslationKey)}`);
      let prepared = entry;
      if (entry.base) {
        let latest: NoteItem;
        try {
          latest = latestByPath.get(entry.note.path)!;
          if (!latest) throw new ApiError('Note moved or deleted remotely.', 404);
        } catch (error) {
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
    if (reviewRequired) throw new Error(t('changes.reviewRequired'));
    if (!Object.keys(sent).length && !sentDocuments.length) return;
    const result = await commitRemoteNotes(Object.values(sent).map(entry => ({ path: entry.note.path, content: entry.note.content, metadata: entry.note.metadata, createOnly: !entry.base })), expected, message, sentDocuments.map(({ path, page, base }) => ({ path, page, base })));
    for (const document of sentDocuments) document.committed(result.revision);
    setWorkingNotes(clearCommittedNotes(workingScope, sent));
    setRevision(result.revision);
  };

  // Assets are scoped to whichever notebook the open note (or the selected browse notebook) belongs to.
  const { handleUploadAsset, handleDeleteAsset, handleMoveAsset } = useAssetOperations({ editingNote, selectedNotebookId, remote, setAssets, setGitStatus });

  const beforeFileChange = async () => {
    await editorRegistry.flushEditors();
    if (Object.keys(readWorkingNotes(workingScope)).length || listLocalDrafts(workingScope).length || documents.some(document => document.dirty)) throw new Error(t('folder.draftsHint'));
  };
  const openFileManager = (notebookId: string, relativePath = '') => {
    const notebook = config?.notebooks.find(nb => nb.id === notebookId);
    if (notebook) setFileDialog({ notebookId, path: notebook.root + (relativePath ? '/' + relativePath : '') });
  };
  const handleMoveNote = async (note: NoteListItem) => {
    try {
      await beforeFileChange();
      setFileDialog({ notebookId: note.notebookId, path: note.path, movePath: note.path });
    } catch (error) {
      setActionError((error as Error).message);
      throw error;
    }
  };
  const moveNoteAction = (note: NoteListItem) => {
    void handleMoveNote(note).catch(() => {});
  };
  const onFilesChanged = async (result: FileResult) => {
    await refreshWorkspace();
    await refreshDocuments();
    if (editorRoute.note) {
      const nb = config?.notebooks.find(nb => nb.id === editorNotebookId);
      const previous = nb ? nb.root + '/' + editorRoute.note : '';
      if (nb && result.pathMap[previous]) {
        setEditingNote(null);
        navigate(noteRoute(nb.id, result.pathMap[previous].slice(nb.root.length + 1)) + location.search, { replace: true });
        setFileDialog(undefined);
      } else if (nb) {
        try {
          if (result.deletedPaths.includes(previous)) {
            setEditingNote(null);
            navigate(returnTo, { replace: true });
          } else {
            setEditingNote(await readNote(previous, nb.id));
            setFileEditorRevision(value => value + 1);
          }
        } catch (error) {
          if ((error as { status?: number; }).status !== 404) throw error;
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
  const openFileIndex = async (path: string, notebookId: string) => {
    const nb = config?.notebooks.find(nb => nb.id === notebookId);
    if (!nb) return;
    await handleOpenFolderIndex(path === nb.root ? '' : path.slice(nb.root.length + 1), undefined, nb.id);
    setFileDialog(undefined);
  };

  const noteEditorOpen = (Boolean(routedNote) || routedLoading) && !routeError;

  const openCommitModal = (request?: ChangeRequest) => {
    void (async () => {
      if (activeTab === 'agent' && !await agentSystemRef.current?.prepareLeave()) return;
      if (!remote) await Promise.all(documents.map(document => document.save()));
      setCommitRequest(request);
      setIsCommitOpen(true);
    })().catch(error => setActionError(error.message));
  };

  const panelRemoteChanges = remote ? [...Object.values(activeWorkingNotes).map(entry => ({ path: entry.note.path, kind: entry.blocked ? 'conflict' as const : entry.base ? 'modified' as const : 'added' as const, tracked: Boolean(entry.base), revision: JSON.stringify(entry), available: canWrite && !entry.blocked, staged: false, unstaged: true })), ...pendingDocuments.map(document => ({ path: document.file, kind: 'modified' as const, tracked: true, revision: document.diff, available: canWrite && !document.error, staged: false, unstaged: true }))] : undefined;
  const panelGetPreview = remote ? (file: string) => documents.find(document => document.file === file)?.diff ?? (activeWorkingNotes[file] ? workingDiff({ [file]: activeWorkingNotes[file] }) : '') : undefined;

  // Every editor of a note, in zoom or in a Focus pane, is wired to the same handlers and per-path state.
  const editorProps = (note: NoteItem, committed?: NoteItem): NoteEditorSharedProps => ({
    statuses: noteQueryStatuses(config?.notebooks || [], note.notebookId, Object.keys(facetsQuery.facets?.[note.notebookId]?.statuses || {})),
    metadataFields: config?.notebooks.find(nb => nb.id === note.notebookId)?.metadata,
    onSave: handleSaveNote,
    onRestoreFile: handleRestoreNoteFile,
    isDirty: Boolean(gitStatus && [...gitStatus.modified, ...gitStatus.staged, ...gitStatus.untracked].includes(note.path)),
    availableTags,
    assets,
    onUploadAsset: !canWrite ? undefined : handleUploadAsset,
    onDeleteAsset: !canWrite ? undefined : handleDeleteAsset,
    onMoveAsset: !canWrite ? undefined : handleMoveAsset,
    readOnly: !canWrite,
    autoSave: true,
    draftMode: remote,
    remoteBase: activeWorkingNotes[note.path]?.base || (committed && typeof committed.content === 'string' ? committed : undefined),
    conflictReason: activeWorkingNotes[note.path]?.blocked,
    onMarkConflict: remote
      ? (reason, draft, base) => {
        stageWorkingNote(draft, base, reason);
      }
      : undefined,
    onReadRemote: remote ? (activeWorkingNotes[note.path]?.base !== null ? readNote : undefined) : readNote,
    branch,
    draftScope: `${sourceId}:${branch}`,
  });
  const closeZoom = () => {
    setEditingNote(null);
    navigate(returnTo, { replace: true });
  };

  // Palette commands for the displayed Focus; they act on the active pane.
  const activeFocusPane = noteFocus.entry ? focusDisplay?.panes.find(pane => pane.panes.includes(noteFocus.entry!.activePane)) : undefined;
  const cycleFocusPane = (delta: number) => {
    if (!focusDisplay || !activeFocusPane) return;
    const panes = focusDisplay.panes, target = panes[(panes.indexOf(activeFocusPane) + delta + panes.length) % panes.length];
    noteFocus.activate(target.pane);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-focus-pane="${target.pane}"] [role="tab"][aria-selected="true"]`)?.focus());
  };
  const cycleFocusTab = (delta: number) => {
    if (!noteFocus.layout || !activeFocusPane) return;
    const tabs = activeFocusPane.panes.flatMap(pane => noteFocus.layout!.panes[pane].tabs.map(tab => ({ pane, key: focusTabKey(tab) })));
    const index = tabs.findIndex(tab => tab.key === activeFocusPane.key);
    const target = tabs[(index + delta + tabs.length) % tabs.length];
    if (target) void noteFocus.show(target.pane, target.key);
  };
  const lastFocus = noteFocus.view.last && (noteFocus.view.last === CURRENT_FOCUS || noteFocus.focuses.some(item => item.id === noteFocus.view.last)) ? noteFocus.view.last : CURRENT_FOCUS;
  const zoomablePath = activeFocusPane?.key?.startsWith('note:') ? activeFocusPane.key.slice('note:'.length) : null;
  const focusCommands: PaletteCommand[] = [{ id: 'focus-toggle', label: t(noteFocus.shown ? 'focus.close' : 'focus.open'), disabled: activeTab !== 'notes', unavailableReason: t('shortcuts.requiresNotes'), run: () => void showFocus(noteFocus.shown ? null : lastFocus) }, { id: 'focus-next-pane', label: t('focus.nextPane'), disabled: (focusDisplay?.panes.length ?? 0) < 2, unavailableReason: t('shortcuts.requiresTwoFocusPanes'), run: () => cycleFocusPane(1) }, { id: 'focus-previous-pane', label: t('focus.previousPane'), disabled: (focusDisplay?.panes.length ?? 0) < 2, unavailableReason: t('shortcuts.requiresTwoFocusPanes'), run: () => cycleFocusPane(-1) }, { id: 'focus-next-tab', label: t('focus.nextTab'), disabled: !activeFocusPane, unavailableReason: t('shortcuts.requiresFocusTab'), run: () => cycleFocusTab(1) }, { id: 'focus-previous-tab', label: t('focus.previousTab'), disabled: !activeFocusPane, unavailableReason: t('shortcuts.requiresFocusTab'), run: () => cycleFocusTab(-1) }, {
    id: 'focus-close-tab',
    label: t('focus.closeCurrentTab'),
    disabled: !noteFocus.editable || !activeFocusPane?.key,
    unavailableReason: t('shortcuts.requiresEditableFocusTab'),
    run: () => {
      if (activeFocusPane?.key) void noteFocus.close(activeFocusPane.key, activeFocusPane.pane).catch(() => {});
    },
  }, {
    id: 'focus-zoom-tab',
    label: t('focus.zoomCurrentTab'),
    disabled: !zoomablePath,
    unavailableReason: t('shortcuts.requiresFocusNote'),
    run: () => {
      if (zoomablePath) zoomFocusNote(zoomablePath);
    },
  }, ...FOCUS_DIVISIONS.map(division => ({ id: `focus-division-${division}`, label: t('focus.divisionCommand', { name: t(`focus.division.${division}`) }), disabled: !noteFocus.editable || !noteFocus.layout || noteFocus.layout.division === division, unavailableReason: t('shortcuts.requiresEditableFocus'), run: () => void noteFocus.setDivision(division).catch(() => {}) }))];
  // With a Focus displayed, the browse region docks beside it (list, flat) or above it (card, kanban).
  const topDock = viewMode === 'card' || viewMode === 'kanban';
  const browseFocusMode = noteFocus.layout ? { onZoomNote: (note: NoteListItem) => void handleOpenNote(note), canDrag: (note: NoteListItem) => noteFocus.editable && note.notebookId === selectedNotebookId } : undefined;
  // Either dock collapses and reopens from the toolbar's left end.
  const dockToggle = noteFocus.layout && focusCapacity > 1 ? <BrowseDockToggle placement={topDock ? 'top' : 'left'} collapsed={noteFocus.view.dock.collapsed} onCollapsedChange={collapsed => noteFocus.setDock({ collapsed })} /> : undefined;
  const browseRegion = (docked: boolean, dockHeight: number) => (
    <>
      {actionError && <p role='alert' className='mb-3 text-sm text-danger'>{actionError}</p>}
      {staleNotice && <p role='alert' className='mb-3 text-sm text-warning'>{staleNotice}</p>}
      {listResult.error && <p role='alert' className='mb-3 text-sm text-danger'>{t('notes.loadFailed', { message: listResult.error })}</p>}
      {facetsQuery.error && <p role='alert' className='mb-3 text-sm text-danger'>{t('notes.countsFailed', { message: facetsQuery.error })}</p>}
      {indexLookup.error && <p role='alert' className='mb-3 text-sm text-danger'>{t('notes.loadFailed', { message: indexLookup.error })}</p>}
      {listResult.loading && <p role='status' className='mb-3 text-sm text-muted'>{t('notes.loading')}</p>}
      {!folderless && (
        <>
          <Breadcrumbs segments={breadcrumbs} currentFolder={selectedFolder} onSelectFolder={setSelectedFolder} subfolderCount={immediateSubfolders.length} noteCount={listResult.total} sortField={sortField} sortOrder={sortOrder} onSortChange={handleSortChange} compact={docked && !topDock} />
          <FolderLinks folders={immediateSubfolders} onSelect={setSelectedFolder}>{folderIndex && <FolderIndex note={folderIndex} onOpenNote={note => void openFromBrowse(note)} />}</FolderLinks>
        </>
      )}
      {(viewMode === 'list' || viewMode === 'flat') && (
        <>
          <ListView
            showMobileSort={false}
            compact={docked}
            focusMode={browseFocusMode}
            statuses={notebookStatuses}
            readOnly={!canWrite}
            canDelete={canWrite}
            confirmDelete={remote}
            notes={displayedNotes}
            uncommitted={listResult.uncommitted}
            hasFolderEntries={immediateSubfolders.length > 0 || Boolean(folderIndex)}
            onOpenNote={note => void openFromBrowse(note)}
            onDeleteNote={handleDeleteNote}
            onMoveNote={moveNoteAction}
            onUpdateNoteStatus={handleUpdateNoteStatus}
            onNewNote={() => openNewNote()}
            sortField={sortField}
            sortOrder={sortOrder}
            onSortChange={handleSortChange}
            tagActions={noteTagActions}
            leading={viewMode === 'flat' && folderIndex
              ? <FolderIndex note={folderIndex} onOpenNote={note => void openFromBrowse(note)} />
              : undefined}
          />
          <NoteListSentinel hasMore={listResult.hasMore} loading={listResult.loadingMore} error={listResult.error} onLoadMore={listResult.loadMore} />
        </>
      )}
      {viewMode === 'card' && (
        <>
          <CardView strip={docked && dockHeight < CARD_TWO_ROW_HEIGHT} focusMode={browseFocusMode} statuses={notebookStatuses} readOnly={!canWrite} canDelete={canWrite} confirmDelete={remote} notes={displayedNotes} uncommitted={listResult.uncommitted} hasFolderEntries={immediateSubfolders.length > 0 || Boolean(folderIndex)} onOpenNote={note => void openFromBrowse(note)} onDeleteNote={handleDeleteNote} onMoveNote={moveNoteAction} onNewNote={() => openNewNote()} onUpdateNoteStatus={handleUpdateNoteStatus} tagActions={noteTagActions} />
          <NoteListSentinel hasMore={listResult.hasMore} loading={listResult.loadingMore} error={listResult.error} onLoadMore={listResult.loadMore} />
        </>
      )}
      {viewMode === 'kanban' && (
        <KanbanView
          focusMode={browseFocusMode}
          statuses={notebookStatuses}
          readOnly={!canWrite}
          canDelete={canWrite}
          confirmDelete={remote}
          query={baseQuery}
          hiddenNote={folderIndex}
          leading={folderIndex
            ? <FolderIndex note={folderIndex} onOpenNote={note => void openFromBrowse(note)} />
            : undefined}
          onOpenNote={note => void openFromBrowse(note)}
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
    </>
  );
  const renderFocusLane = (row: ScreenRow, pane: number) => (
    <FocusLaneTab
      key={row.id}
      row={row}
      notebooks={config?.notebooks || []}
      graph={row.view === 'graph'
        ? (
          <React.Suspense fallback={<p role='status'>{t('graph.title')}</p>}>
            <GraphPage notebooks={config?.notebooks || []} lane={row} screen={screen} />
          </React.Suspense>
        )
        : undefined}
      onOpenNote={note => void openInFocus(note, pane).then(opened => {
        if (!opened) void handleOpenNote(note);
      })}
      onOpenFolder={item => {
        // A folder of this notebook filters the browse region and keeps the Focus; others open as they do on Screen.
        const notebook = config?.notebooks.find(nb => nb.id === item.notebookId);
        if (item.notebookId !== selectedNotebookId || !notebook || !folderRoot) return false;
        const assetRoot = `${folderRoot}/${notebook.assets || 'assets'}`;
        if (item.path === assetRoot || item.path.startsWith(`${assetRoot}/`)) return false;
        if (item.path !== folderRoot && !item.path.startsWith(`${folderRoot}/`)) return false;
        setSelectedFolder(item.path === folderRoot ? null : item.path.slice(folderRoot.length + 1));
        return true;
      }}
    />
  );

  if (loading || loadError) return <ConnectionState loading={loading} error={loadError} onRetry={refreshWorkspace} />;

  return (
    <WorkspaceLinks notebooks={config?.notebooks || []} folders={folders} onOpenNote={(note, anchor, source) => void openLink(note, anchor, source)}>
      <NoteEditingProvider register={editorRegistry.register} editorProps={editorProps} flushEditors={editorRegistry.flushEditors} refreshNotes={refreshNotes} closeZoom={closeZoom} addToFocus={addToFocus}>
        <div className='app-shell h-dvh w-full overflow-hidden flex flex-col font-sans transition-colors duration-200' data-workspace-tab={activeTab} data-screen-focus={activeTab === 'screen' && Boolean(route.lane)} style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
          {/* Core Branch User Guidance Banner (Theme-aware, harmonized with active palette) */}
          {!remote && branch === 'core' && (
            <div className='shrink-0 flex-none px-4 py-2 text-xs flex items-center justify-between font-medium border-b transition-colors' style={{ backgroundColor: 'var(--color-sidebar)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              <div className='flex items-center gap-2.5'>
                <AlertTriangle className='w-4 h-4 text-warning shrink-0' />
                <span className='px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-on-primary shrink-0 shadow-xs' style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>{t('nav.coreBaseline')}</span>
                <span className='text-muted'>{t('nav.coreBanner')}</span>
              </div>
            </div>
          )}
          {/* Top Header */}
          <Header workspaceTitle={config?.workspace.title || 'MyGitNotes'} sourceLabel={remote ? `${sourceId.replace(/^(github|gitlab):/, '')}${canWrite ? '' : ' · Read-only'}` : undefined} accountControls={<AuthControls local={!remote} />} notebooks={config?.notebooks || []} selectedNotebookId={selectedNotebookId} onSelectNotebook={id => void setSelectedNotebookId(id)} notebookDisabled={loading || resourceNavigationBusy || notebookSwitchBusy} activeTab={activeTab} setActiveTab={setActiveTab} onCreateNote={() => openNewNote()} createNoteDisabled={!canWrite} onOpenCommands={() => setShortcutMode('palette')} navigationDisabled={noteEditorOpen || isCommitOpen} />
          <KeyboardShortcuts
            mode={shortcutMode}
            onModeChange={setShortcutMode}
            suspended={noteEditorOpen || isCommitOpen}
            activeTab={activeTab}
            canCreateNote={canWrite}
            onNavigate={tab => void setActiveTab(tab)}
            onCreateNote={() => openNewNote()}
            onFocusSearch={() => {
              if (activeTab === 'notes') setFiltersOpen(true);
              requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.header-search input')?.focus());
            }}
            pageCommands={focusCommands}
          />
          {routeError && (
            <div role='alert' className='px-6 py-3 text-sm text-danger'>
              {routeError.startsWith('route.') ? t(routeError as any) : routeError} <button className='underline' onClick={() => navigate('/notes')}>{t('route.goToNotes')}</button>
            </div>
          )}
          {/* Main Workspace Layout */}
          <SidebarProvider open={filtersOpen} onOpenChange={setFiltersOpen}>
            <div ref={sidebarGestureRef} className='workspace-body relative flex-1 min-h-0 min-w-0 flex overflow-hidden'>
              <WorkspaceSplitLayout
                hasSidebar={activeTab !== 'graph' && activeTab !== 'screen'}
                sidebarDomId={activeTab === 'notes' ? 'notebook-panel' : activeTab === 'agent' ? 'agent-sidebar-panel' : activeTab === 'assets' ? 'assets-sidebar-panel' : activeTab === 'settings' ? 'settings-sidebar-panel' : undefined}
                closeLabel={t('sidebar.closeFilters')}
                rightPanelWidth={rightPanelWidth}
                rightPanel={
                  <RightPanel
                    documentPanel={activeTab === 'notes' && noteFocus.layout ? { enabled: activePaneNote, onContainer: setDocumentContainer } : undefined}
                    fileMode={activeTab === 'assets'}
                    metadataOpen={fileMetadataOpen}
                    onMetadataOpenChange={setFileMetadataOpen}
                    fileMetadata={selectedFileEntry
                      ? (
                        <FileMetadata
                          entry={selectedFileEntry}
                          onEdit={canWrite && !resourceNavigationBusy
                            ? () => void fileManagerRef.current?.editMetadata()
                            : undefined}
                        />
                      )
                      : undefined}
                    onFileMetadataContainer={setFileMetadataContainer}
                    notebooks={config?.notebooks || []}
                    selectedNotebookId={selectedNotebookId}
                    currentFolder={selectedFolder && notebookRoot ? `${notebookRoot}/${selectedFolder}` : undefined}
                    onOpenNote={handleOpenNote}
                    onSaveNote={handleSaveNote}
                    onReadNote={readNoteForChange}
                    gitStatus={gitStatus}
                    deletedNotes={deletedNotes}
                    onRestoreNote={handleRestoreNote}
                    onOpenCommitModal={openCommitModal}
                    writable={canWrite}
                    remoteChanges={panelRemoteChanges}
                    getPreview={panelGetPreview}
                    onSynced={remote ? undefined : async () => {
                      await refreshWorkspace();
                      await refreshDocuments();
                    }}
                    onWidthChange={setRightPanelWidth}
                  />
                }
              >
                {activeTab === 'notes' && (
                  <>
                    <WorkspaceSidebarPortal>
                      <Sidebar
                        selectedNotebookId={selectedNotebookId}
                        folders={folders}
                        onManageFiles={openFileManager}
                        foldersWritable={canWrite}
                        reorder={folderReorder}
                        onToggleReorder={() => setFolderReorder(value => !value)}
                        filters={filterProps}
                        facets={facetsQuery.facets}
                        facetsLoading={facetsQuery.loading}
                        facetsError={facetsQuery.error}
                        workspaceTagNames={workspaceTagNames}
                        beforeFolderChange={() => {
                          if (Object.keys(activeWorkingNotes).length || listLocalDrafts(workingScope).length || documents.some(document => document.dirty)) throw new Error(t('folder.draftsHint'));
                        }}
                        onFoldersChanged={async () => {
                          await refreshWorkspace();
                          await refreshDocuments();
                        }}
                        selectedFolder={selectedFolder}
                        onSelectFolder={setSelectedFolder}
                        gitStatus={gitStatus}
                        canManageTags={canWrite}
                        onPreviewTagUsage={previewTagUsage}
                        onRenameTag={handleRenameTag}
                        onMergeTag={handleMergeTag}
                        onDeleteTag={handleDeleteTag}
                      />
                    </WorkspaceSidebarPortal>
                    {/* Main Content Area */}
                    <main className='workspace-main notes-main'>
                      <PageToolbar>
                        {dockToggle}
                        <NoteToolbar sortField={sortField} sortOrder={sortOrder} onSortChange={handleSortChange} readOnly={!canWrite} viewMode={viewMode} setViewMode={setViewMode} hiddenNoteCount={facetsQuery.facets ? notebookFacets.hidden : null} showHidden={showHidden} descendants={route.descendants} onShowHiddenChange={value => changeFilters({ showHidden: value })} onDescendantsChange={value => changeFilters({ descendants: value })} onOpenNewNoteModal={() => openNewNote()} filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen(open => !open)} focusControls={<FocusControls focus={noteFocus} onShow={key => void showFocus(key)} onReload={() => void focusPage.reload()} browseToggle={focusCapacity === 1 ? { showing: focusNarrowView === 'browse', onToggle: () => setFocusNarrowView(view => view === 'browse' ? 'focus' : 'browse') } : undefined} />} />
                      </PageToolbar>
                      {noteFocus.layout
                        ? (
                          <BrowseDock placement={topDock ? 'top' : 'left'} size={topDock ? noteFocus.view.dock.top : noteFocus.view.dock.left} onSizeChange={size => noteFocus.setDock(topDock ? { top: size } : { left: size })} collapsed={noteFocus.view.dock.collapsed} narrow={focusCapacity === 1} narrowView={focusNarrowView} browse={height => browseRegion(true, height)}>
                            <FocusArea focus={noteFocus} capacity={focusCapacity} lanes={notebookLanes ?? []} notebookRoot={folderRoot ?? ''} folders={folders} renderLane={renderFocusLane} onZoomNote={zoomFocusNote} documentPanel={focusDocumentPanel} />
                          </BrowseDock>
                        )
                        : <div className='workspace-scroll'>{browseRegion(false, 0)}</div>}
                    </main>
                  </>
                )}
                {activeTab === 'agent' && (
                  <main className='workspace-route agent-main'>
                    <AgentSystemView notebooks={config?.notebooks || []} selectedNotebookId={selectedNotebookId} ref={agentSystemRef} onBusyChange={setResourceNavigationBusy} readOnly={!canWrite} remote={remote} onGitStatus={setGitStatus} readOnlyNotice={t(remote ? 'agent.remoteReadOnlyNotice' : branch === 'core' ? 'agent.coreBranchNotice' : 'agent.workspaceReadOnlyNotice')} />
                  </main>
                )}
                {activeTab === 'assets' && (
                  <main className='workspace-route assets-main has-sidebar-drawer'>
                    <FileManager key={`${sourceId}:${selectedNotebookId}`} ref={fileManagerRef} notebookId={selectedNotebookId} notebooks={config?.notebooks || []} onNotebookChange={id => void setSelectedNotebookId(id)} writable={canWrite} onSelectionChange={setSelectedFileEntry} metadataContainer={fileMetadataContainer} onShowMetadata={() => setFileMetadataOpen(true)} initialPath={new URLSearchParams(location.search).get('asset') || (new URLSearchParams(location.search).has('directory') ? `${folderRoot}/${config?.notebooks.find(nb => nb.id === selectedNotebookId)?.assets || 'assets'}${new URLSearchParams(location.search).get('directory') ? '/' + new URLSearchParams(location.search).get('directory') : ''}` : undefined)} onBusyChange={setResourceNavigationBusy} beforeChange={beforeFileChange} onChanged={onFilesChanged} onOpenIndex={openFileIndex} />
                  </main>
                )}
                {activeTab === 'screen' && (
                  <React.Suspense fallback={<p role='status' className='p-8'>{t('screen.loading')}</p>}>
                    <ScreenPage
                      key={remote ? sourceId : repoRoot}
                      screen={screen}
                      focusedLaneId={route.lane}
                      onStudySaved={() => {
                        if (remote) void refreshWorkspace();
                        else invalidateNotes();
                        void fetchGitStatus().then(result => setGitStatus(result.status)).catch(error => setActionError((error as Error).message));
                      }}
                      notebooks={config?.notebooks || []}
                      folders={folders}
                      selectedNotebookId={selectedNotebookId}
                      onOpenNote={handleOpenNote}
                      onCreateNote={openNewNote}
                      focusSection={<FocusList focus={noteFocus} onOpen={id => navigate(`${notebookRoute(selectedNotebookId)}?${new URLSearchParams({ focus: id })}`)} />}
                      onAddLaneToFocus={row => setAddingToFocus({ tab: { kind: 'lane', id: row.id }, label: row.name })}
                    />
                  </React.Suspense>
                )}
                {activeTab === 'graph' && (
                  <main className='workspace-route graph-main flex-1 w-full h-full relative min-h-0'>
                    <React.Suspense fallback={<p role='status' className='p-8'>{t('graph.title')}</p>}>
                      <GraphPage key={remote ? sourceId : repoRoot} notebooks={config?.notebooks || []} filters={filterProps} folders={folders} screen={screen} />
                    </React.Suspense>
                  </main>
                )}
                {activeTab === 'settings' && (
                  <main className='workspace-route settings-main has-sidebar-drawer'>
                    <SettingsModal config={config} branch={branch} repoRoot={remote ? sourceId.replace(/^(github|gitlab):/, '') : repoRoot} local={!remote} accountSettings={<AgentAccessSettings local={!remote} />} onRefreshWorkspace={refreshWorkspace} currentTheme={currentTheme} onSelectTheme={handleSelectTheme} />
                  </main>
                )}
              </WorkspaceSplitLayout>
            </div>
          </SidebarProvider>
          {activeTab !== 'screen' && screen.dirty && screen.error && (
            <div role='alert' className='workspace-link-error'>
              {screen.error}
              <button className='ui-button' onClick={() => navigate('/screen')}>{t('nav.screen')}</button>
            </div>
          )}
          {/* Undo Toast Notification (Requirement 2) */}
          {undoToast && (
            <div className='fixed top-20 right-6 z-50 animate-in fade-in slide-in-from-top-3 duration-200'>
              <div className='bg-surface/95 text-fg backdrop-blur-md px-4 py-3 rounded-xl shadow-xl border border-line/80 flex items-center gap-3 text-xs'>
                <span>{t('toast.noteMovedToTrash', { title: undoToast.note.title })}</span>
                <button onClick={() => handleRestoreNote(undoToast.note)} className='px-2.5 py-1 bg-warning hover:bg-warning/90 active:scale-95 text-on-warning font-semibold rounded-md transition'>{t('common.undo')}</button>
                <button onClick={() => setUndoToast(null)} className='text-muted hover:text-fg p-1 rounded hover:bg-fg/10 transition ml-1'>
                  <X className='w-3.5 h-3.5' />
                </button>
              </div>
            </div>
          )}
          {
            /* Recent tag operations: session-lifetime, each independently undoable (the list itself
          is not cleared by navigation or further mutations, only by page reload). Undoing a
          record unconditionally restores its recorded prior tags on every note it touched; it
          does not detect or warn about a later edit to the same note's tags in the meantime. */
          }
          {tagOperations.history.length > 0 && (
            <section className='fixed top-28 sm:top-auto sm:bottom-6 right-4 sm:right-16 left-4 sm:left-auto z-50 flex flex-col gap-2 items-end' aria-label={t('sidebar.recentTagChanges')}>
              {tagOperations.history.map(record => (
                <div key={record.id} className='bg-surface/95 text-fg backdrop-blur-md px-4 py-3 rounded-xl shadow-xl border border-line/80 flex items-center gap-3 text-xs max-w-sm'>
                  <span>{record.label}</span>
                  <button
                    autoFocus
                    onClick={() => void handleUndoTagOperation(record.id)}
                    className='px-2.5 py-1 bg-warning hover:bg-warning/90 active:scale-95 text-on-warning font-semibold rounded-md transition shrink-0'
                  >
                    {t('common.undo')}
                  </button>
                  <button
                    aria-label={t('sidebar.dismissTagOperation')}
                    onClick={() => tagOperations.dismiss(record.id)}
                    className='text-muted hover:text-fg p-1 rounded hover:bg-fg/10 transition ml-1 shrink-0'
                  >
                    <X className='w-3.5 h-3.5' />
                  </button>
                </div>
              ))}
            </section>
          )}
          {fileDialog && <FileManagerDialog notebookId={fileDialog.notebookId} notebooks={config?.notebooks || []} writable={canWrite} initialPath={fileDialog.path} movePath={fileDialog.movePath} beforeChange={beforeFileChange} onChanged={onFilesChanged} onOpenIndex={openFileIndex} onClose={() => setFileDialog(undefined)} />}
          {/* Note Editor Modal */}
          <EditorModal key={fileEditorRevision} note={routedNote} committed={routedCommitted && typeof routedCommitted.content === 'string' ? routedCommitted as NoteItem : undefined} loading={routedLoading} isOpen={noteEditorOpen} />
          {addingToFocus && <AddToFocusDialog focus={noteFocus} tab={addingToFocus.tab} label={addingToFocus.label} onClose={() => setAddingToFocus(null)} />}
          {/* Commit Modal */}
          <CommitModal
            writable={canWrite}
            remoteChanges={panelRemoteChanges}
            getPreview={panelGetPreview}
            request={commitRequest}
            restoreFile={remote
              ? async file => {
                const pendingDocument = documents.find(document => document.file === file.path);
                if (pendingDocument) {
                  if (file.revision !== pendingDocument.diff) throw new Error('Draft changed. Review it again.');
                  await pendingDocument.reload();
                  return;
                }
                const entry = readWorkingNotes(workingScope)[file.path];
                if (!entry || JSON.stringify(entry) !== file.revision) throw new Error('Draft changed. Review it again.');
                const latest = entry.base ? await readNote(file.path) : null;
                if (JSON.stringify(readWorkingNotes(workingScope)[file.path]) !== file.revision) throw new Error('Draft changed. Review it again.');
                setWorkingNotes(updateWorkingNote(workingScope, file.path, null));
                if (latest && editingNote?.path === file.path) setEditingNote(latest);
              }
              : undefined}
            commitFiles={remote ? commitWorkingNotes : undefined}
            isOpen={isCommitOpen}
            onClose={() => setIsCommitOpen(false)}
            gitStatus={gitStatus}
            onChanged={async () => {
              await refreshWorkspace();
              if (!remote) {
                await refreshDocuments();
                await agentSystemRef.current?.refresh();
              }
            }}
            onCommitted={async () => {
              await refreshWorkspace();
              if (!remote) {
                await refreshDocuments();
                await agentSystemRef.current?.refresh();
              }
              setDeletedNotes([]);
              setUndoToast(null);
            }}
          />
          {/* Create New Note Modal */}
          {isNewNoteOpen && (
            <NewNoteDialog
              t={t}
              createError={createError}
              newNoteTitle={newNoteTitle}
              onTitleChange={setNewNoteTitle}
              onSubmit={() => handleCreateNewNote()}
              newNoteFolder={newNoteFolder}
              onFolderChange={setNewNoteFolder}
              newNoteFolders={newNoteFolders}
              newNoteTemplates={newNoteTemplates}
              newNoteTemplateId={newNoteTemplateId}
              onTemplateChange={handleTemplateChange}
              newNoteTags={newNoteTags}
              newNoteStatus={newNoteStatus}
              onStatusChange={setNewNoteStatus}
              newNoteStatuses={newNoteStatuses}
              onCancel={() => {
                setIsNewNoteOpen(false);
                setNewNoteTags([]);
                setNewNoteTemplateId('');
              }}
            />
          )}
        </div>
        <ImageLightbox />
      </NoteEditingProvider>
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
