import { WorkspaceLinks } from './components/WorkspaceLinks.js';
import { resolveNoteStatuses, isNoteHidden, withNoteStatus } from '@github-notes/core/note-status';
import { Select } from './components/Select.js';
import { useLocation, useNavigate } from 'react-router-dom';
import { notebookRoute, noteRoute, parseWorkspaceRoute, WorkspaceTab } from './lib/routes.js';
import { readWorkingNotes, updateWorkingNote, clearCommittedNotes, overlayWorkingNotes, workingDiff, WorkingNotes } from './lib/working-notes.js';
import { mergeNote, sameValue } from './lib/merge-note.js';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  fetchWorkspace,
  commitRemoteNotes,
  ApiError,
  fetchFolders,
  fetchNotes,
  readNote,
  readNotes,
  saveNote,
  deleteNote,
  restoreNote,
  fetchAssets,
  uploadAsset,
  deleteAsset,
  moveAsset,
  fetchGitStatus,
} from './lib/api.js';
import {
  WorkspaceConfig,
  FolderItem,
  NoteItem,
  AssetItem,
  GitStatus,
  ViewMode,
} from './lib/types.js';
import { ThemeDefinition, getSavedTheme, applyTheme } from './lib/themes.js';
import { AuthControls, ConnectionState, AgentAccessSettings } from './components/AuthControls.js';
import { inFolder } from './lib/note-paths.js';
import { Header } from './components/Header.js';
import { NoteToolbar } from './components/NoteToolbar.js';
import { PageHeader } from './components/WorkspaceChrome.js';
import { useVisualViewport } from './lib/use-visual-viewport.js';
import { useSidebarSwipe } from './lib/use-sidebar-swipe.js';
import { Sidebar } from './components/Sidebar.js';
import { ListView } from './components/ListView.js';
import { CardView } from './components/CardView.js';
import { KanbanView } from './components/KanbanView.js';
import { EditorModal } from './components/EditorModal.js';
import { AssetBrowser } from './components/AssetBrowser.js';
import { AgentSystemView, type AgentSystemHandle } from './components/AgentSystemView.js';
import { SettingsModal } from './components/SettingsModal.js';
import { CommitModal } from './components/CommitModal.js';
import { FloatingCommitFooter } from './components/FloatingCommitFooter.js';
import { Breadcrumbs } from './components/Breadcrumbs.js';
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

  const [filtersOpen, setFiltersOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setFiltersOpen(false); }, [location.pathname, location.search]);
  useEffect(() => {
    if (!filtersOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setFiltersOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [filtersOpen]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [remote, setRemote] = useState(false);
  const loadedRemote = useRef(false);
  const [canWrite, setCanWrite] = useState(false);
  const [revision, setRevision] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [createError, setCreateError] = useState('');
  const [actionError, setActionError] = useState('');
  // Theme State
  const [currentTheme, setCurrentTheme] = useState<ThemeDefinition>(() => getSavedTheme());

  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  const handleSelectTheme = (theme: ThemeDefinition) => {
    setCurrentTheme(theme);
    applyTheme(theme);
  };

  // Application Data State
  const [repoRoot, setRepoRoot] = useState<string>('');
  const [branch, setBranch] = useState<string>('core');
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);
  const [serverGitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [sourceNotes, setNotes] = useState<NoteItem[]>([]);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [workingNotes, setWorkingNotes] = useState<WorkingNotes>({});
  const workingScope = `${sourceId}:${branch}`;
  const activeWorkingNotes = remote && canWrite ? workingNotes : {};
  const notes = useMemo(() => remote && canWrite ? overlayWorkingNotes(sourceNotes, workingNotes) : sourceNotes, [remote, canWrite, sourceNotes, workingNotes]);
  const gitStatus = useMemo<GitStatus | null>(() => remote ? {
    branch, isClean: Object.keys(activeWorkingNotes).length === 0, staged: [],
    modified: Object.values(activeWorkingNotes).filter(entry => entry.base).map(entry => entry.note.path),
    untracked: Object.values(activeWorkingNotes).filter(entry => !entry.base).map(entry => entry.note.path),
  } : serverGitStatus, [remote, branch, workingNotes, canWrite, serverGitStatus]);
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === `gh_notes_working:${workingScope}`) {
        try { setWorkingNotes(readWorkingNotes(workingScope)); }
        catch (error) { setActionError((error as Error).message); }
      }
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [workingScope]);
  const stageWorkingNote = (note: NoteItem, base: NoteItem | null, blocked?: string) => {
    note = { ...note, status: typeof note.metadata.status === 'string' ? note.metadata.status : undefined,
      tags: Array.isArray(note.metadata.tags) ? note.metadata.tags.map(String) : [],
      title: typeof note.metadata.title === 'string' && note.metadata.title ? note.metadata.title : note.content.match(/^#\s+(.+)$/m)?.[1] || note.title };
    const previous = readWorkingNotes(workingScope)[note.path];
    const entry = { note, base, ...(blocked ? { blocked } : {}) };
    if (!sameValue(previous, entry)) setWorkingNotes(updateWorkingNote(workingScope, note.path, entry));
    setEditingNote(current => current?.path === note.path && !sameValue(current, note) ? note : current);
    return note;
  };

  // Deletion and Undo Buffer State (Requirement 2)
  const [deletedNotes, setDeletedNotes] = useState<NoteItem[]>([]);
  const [undoToast, setUndoToast] = useState<{ note: NoteItem; timerId: any } | null>(null);

  // The URL owns page, notebook, folder and filter selection.
  const navigate = useNavigate();
  const route = useMemo(() => parseWorkspaceRoute(location.pathname, location.search), [location.pathname, location.search]);
  const activeTab = route.tab;
  const sidebarGestureRef = useSidebarSwipe(activeTab === 'notes' && !loading && !loadError, filtersOpen, setFiltersOpen);
  const selectedNotebookId = route.notebook || config?.workspace.default_notebook || config?.notebooks[0]?.id || 'example';
  const notebookStatuses = useMemo(() => resolveNoteStatuses(
    config?.notebooks.find(nb => nb.id === selectedNotebookId),
    notes.filter(note => note.notebookId === selectedNotebookId).map(note => note.status),
  ), [config, notes, selectedNotebookId]);
  const selectedFolder = route.folder;
  const selectedStatus = route.status;
  const showHidden = route.showHidden;
  const visibleNotes = useMemo(() => notes.filter(note => showHidden || !isNoteHidden({ ...note.metadata, status: note.status })), [notes, showHidden]);
  const hiddenNoteCount = notes.filter(note => note.notebookId === selectedNotebookId && isNoteHidden({ ...note.metadata, status: note.status })).length;
  const selectedTag = route.tag;
  const searchQuery = route.q;
  const viewMode = route.view;
  const [routeError, setRouteError] = useState('');
  const updateQuery = (key: string, value: string | null, replace = false) => {
    const query = new URLSearchParams(location.search);
    if (value) query.set(key,value); else query.delete(key);
    navigate({ pathname: location.pathname, search: query.toString() }, { replace });
  };
  const setActiveTab = async (tab: WorkspaceTab) => {
    if (resourceNavigationBusy || notebookSwitchBusy || activeTab === tab) return;
    setNotebookSwitchBusy(true);
    try {
      if (activeTab === 'agent' && !await agentSystemRef.current?.prepareLeave()) return;
      navigate(tab === 'notes' ? notebookRoute(selectedNotebookId,selectedFolder)+location.search : `/${tab}?notebook=${encodeURIComponent(selectedNotebookId)}`);
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
      navigate(activeTab !== 'notes' ? `/${activeTab}?notebook=${encodeURIComponent(id)}` : notebookRoute(id));
    } finally { setNotebookSwitchBusy(false); }
  };
  const setSelectedFolder = (folder: string | null) => navigate(notebookRoute(selectedNotebookId,folder)+location.search);
  const setSelectedStatus = (status: string | null) => updateQuery('status',status);
  const setSelectedTag = (tag: string | null) => updateQuery('tag',tag);
  const setSearchQuery = (query: string) => updateQuery('q',query,true);
  const setViewMode = (mode: ViewMode) => updateQuery('view',mode);

  // Modal States
  const [editingNote, setEditingNote] = useState<NoteItem | null>(null);
  const [isCommitOpen, setIsCommitOpen] = useState<boolean>(false);
  const [isNewNoteOpen, setIsNewNoteOpen] = useState<boolean>(false);

  // New Note Form State
  const [newNoteTitle, setNewNoteTitle] = useState<string>('');
  const [newNoteStatus, setNewNoteStatus] = useState<string>('inbox');
  const openNewNote = (status = notebookStatuses[0]) => {
    setNewNoteStatus(status);
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

  // Determine if the currently edited note has uncommitted changes in Git
  const isEditingNoteDirty = useMemo(() => {
    if (!editingNote || !gitStatus) return false;
    return Boolean(
      gitStatus.modified.includes(editingNote.path) ||
      gitStatus.staged.includes(editingNote.path) ||
      gitStatus.untracked.includes(editingNote.path)
    );
  }, [editingNote, gitStatus]);

  useEffect(() => {
    setEditingNote(null);  setDeletedNotes([]); setIsNewNoteOpen(false);
  }, [sourceId]);

  const refreshWorkspace = async () => {
    try {
      const ws = await fetchWorkspace();
      loadedRemote.current = !ws.capabilities.local;
      setSourceId(ws.source.identity);
      setRemote(!ws.capabilities.local);
      setCanWrite(ws.capabilities.write);
      setRevision(ws.revision || '');
      setLoadError('');
      setRepoRoot(ws.repoRoot);
      setBranch(ws.branch);
      setConfig(ws.config);
      setWorkingNotes(ws.capabilities.local ? {} : readWorkingNotes(`${ws.source.identity}:${ws.branch}`));
      setGitStatus(ws.gitStatus);

      setFolders(await fetchFolders());
      const noteList = await fetchNotes();
      setNotes(noteList);

    } catch (err) {
      setNotes([]); setFolders([]); setAssets([]); setConfig(null);
      setLoadError(err instanceof Error ? err.message : 'Failed to load workspace');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!loadedRemote.current) refreshWorkspace();
  }, [selectedNotebookId]);

  useEffect(() => {
    if (!sourceId || !config) return;
    let active = true;
    fetchAssets(selectedNotebookId).then(items => { if (active) setAssets(items); }).catch(console.error);
    return () => { active = false; };
  }, [sourceId, selectedNotebookId, config]);

  useEffect(() => {
    if (loading || !config) return;
    if (!route.valid) { setRouteError('route.pageNotFound');  return; }
    const notebook = config.notebooks.find(nb => nb.id === selectedNotebookId) || (!route.notebook ? config.notebooks[0] : null);
    if (!notebook) { setRouteError('route.notebookNotFound');  return; }
    if (route.folder && !folders.some(f => f.notebookId === notebook.id && f.path === route.folder)) { setRouteError('route.folderNotFound'); return; }
    if (!route.note) { setRouteError(''); setEditingNote(null);  return; }
    const file = `${notebook.root}/${route.note}`;
    const note = notes.find(n => n.path === file);
    if (note) { setRouteError(''); setEditingNote(previous => previous?.path === file ? previous : note);  }
    else if (editingNote?.path !== file) { setRouteError('route.noteNotFound');  }
  }, [route, config, notes, folders, loading, selectedNotebookId, sourceId]);

  // Filter notes by active notebook, search query, status, and tags
  const filteredNotes = useMemo(() => {
    return visibleNotes.filter((n) => {
      if (selectedNotebookId && n.notebookId !== selectedNotebookId) {
        return false;
      }
      const root = config?.notebooks.find(nb => nb.id === n.notebookId)?.root || '';
      if (!inFolder(n.path, root, selectedFolder)) return false;
      if (selectedStatus && n.status !== selectedStatus) {
        return false;
      }
      if (selectedTag && !n.tags.includes(selectedTag)) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = n.title.toLowerCase().includes(q);
        const matchesContent = n.content.toLowerCase().includes(q);
        const matchesTag = n.tags.some((t) => t.toLowerCase().includes(q));
        const matchesStatus = n.status?.toLowerCase().includes(q);
        return matchesTitle || matchesContent || matchesTag || matchesStatus;
      }
      return true;
    });
  }, [visibleNotes, config, selectedFolder, selectedNotebookId, selectedStatus, selectedTag, searchQuery]);

  // Hierarchical Subfolder Discovery for current folder
  const immediateSubfolders = useMemo(() => {
    if (searchQuery.trim() || selectedStatus || selectedTag) return [];
    const root = config?.notebooks.find((nb) => nb.id === selectedNotebookId)?.root || '';
    return getImmediateSubfolders(visibleNotes, folders, selectedNotebookId, root, selectedFolder);
  }, [visibleNotes, folders, selectedNotebookId, config, selectedFolder, searchQuery, selectedStatus, selectedTag]);

  // Direct notes in current folder (or flat list during search/filter), sorted
  const displayedNotes = useMemo(() => {
    const root = config?.notebooks.find((nb) => nb.id === selectedNotebookId)?.root || '';
    const base = searchQuery.trim() || selectedStatus || selectedTag
      ? filteredNotes
      : getImmediateNotes(filteredNotes, root, selectedFolder);
    return sortNotes(base, sortField, sortOrder, notebookStatuses);
  }, [filteredNotes, config, selectedNotebookId, selectedFolder, searchQuery, selectedStatus, selectedTag, sortField, sortOrder, notebookStatuses]);

  // Breadcrumb Trail from Root to current folder
  const breadcrumbs = useMemo(() => {
    return getBreadcrumbs(selectedFolder, folders, selectedNotebookId, t('folder.allFolders'));
  }, [selectedFolder, folders, selectedNotebookId, t]);

  // Note Handlers
  const handleOpenNote = (note: NoteItem, anchor = '') => {
    setEditingNote(note);

    const notebook = config?.notebooks.find(nb => nb.id === note.notebookId);
    if (notebook) {
      const query = new URLSearchParams(location.search);
      query.delete('notebook');
      if (activeTab === 'screen') query.set('returnTo', 'screen');
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

  // Trash action: delete without immediate commit, allowing restore (Requirement 2)
  const handleDeleteNote = async (note: NoteItem) => {
    if (remote || !canWrite) return;
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
    setNotes((prev) => [res.note, ...prev.filter((n) => n.path !== note.path)]);
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
          navigate(notebookRoute(selectedNotebookId, selectedFolder) + location.search);
          return null;
        }
        const latest = await readNote(notePath);
        setWorkingNotes(updateWorkingNote(workingScope, notePath, null));
        setNotes(previous => previous.map(note => note.path === notePath ? latest : note));
        setEditingNote(latest);
        return latest;
      }
      const res = await restoreNote({ path: notePath });
      setNotes((prev) => prev.map((n) => (n.path === res.note.path ? res.note : n)));
      setEditingNote(res.note);
      const statusRes = await fetchGitStatus();
      setGitStatus(statusRes.status);
      return res.note;
    } catch (err) {
      console.error('Failed to restore note file:', err);
      return null;
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
      const notePath = [root, selectedFolder, `${slug}.md`].filter(Boolean).join('/');
      if (notes.some(n => n.path === notePath)) throw new Error('A note with this filename already exists in this folder. Choose another title.');

      const status = statusOverride || newNoteStatus;
      const initialContent = `# ${title}\n\nWrite your note here.\n`;
      const initialMetadata = withNoteStatus({
        id: slug,
        title,
        status: status || undefined,
        tags: [],
      }, status);

      const res = remote ? { note: stageWorkingNote({
        id: slug, path: notePath, notebookId: currentNotebook!.id, title,
        content: initialContent, metadata: initialMetadata, status, tags: [], revision,
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
      setNewNoteStatus(notebookStatuses[0]);
      const statusRes = await fetchGitStatus();
      setGitStatus(statusRes.status);
      handleOpenNote(res.note);
    } catch (error) { setCreateError((error as Error).message); }
  };

  const commitWorkingNotes = async (files: string[], message: string) => {
    const pending = readWorkingNotes(workingScope);
    const selected = files.map(file => pending[file]).filter(Boolean);
    if (selected.length !== files.length) throw new Error('Pending files changed. Review the selection again.');
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
    if (!Object.keys(sent).length) return;
    const result = await commitRemoteNotes(Object.values(sent).map(entry => ({ path: entry.note.path,
      content: entry.note.content, metadata: entry.note.metadata, createOnly: !entry.base })), expected, message);
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

  const routedPath = route.note ? `${config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root}/${route.note}` : null;
  const routedNote = routedPath ? (editingNote?.path === routedPath ? editingNote : notes.find(note => note.path === routedPath) || null) : null;

  if (loading || loadError) return <ConnectionState loading={loading} error={loadError} onRetry={refreshWorkspace} />;

  return (
    <WorkspaceLinks notebooks={config?.notebooks || []} notes={notes} folders={folders} onOpenNote={handleOpenNote}>
    <div
      className="app-shell h-dvh w-full overflow-hidden flex flex-col font-sans transition-colors duration-200"
      data-workspace-tab={activeTab}
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
              style={{ backgroundColor: 'var(--color-primary)' }}
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
        workspaceTitle={config?.workspace.title || 'GitHub Notes'}
        sourceLabel={remote ? `${sourceId.replace(/^github:/, '')}${canWrite ? '' : ' · Read-only'}` : undefined}
        accountControls={<AuthControls local={!remote} />}
        notebooks={config?.notebooks || []}
        selectedNotebookId={selectedNotebookId}
        onSelectNotebook={id => void setSelectedNotebookId(id)}
        notebookDisabled={loading || resourceNavigationBusy || notebookSwitchBusy}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

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
              statuses={notebookStatuses}
              selectedNotebookId={selectedNotebookId}
              folders={folders}
              selectedFolder={selectedFolder}
              onSelectFolder={setSelectedFolder}
              notes={visibleNotes}
              showHidden={showHidden}
              hiddenNoteCount={hiddenNoteCount}
              onShowHiddenChange={show => updateQuery('showHidden', show ? 'true' : null)}
              selectedStatus={selectedStatus}
              onSelectStatus={setSelectedStatus}
              selectedTag={selectedTag}
              onSelectTag={setSelectedTag}
              gitStatus={gitStatus}
            />
            </div>

            {/* Main Content Area */}
            <main className="workspace-main notes-main">
              <PageHeader title={t('nav.notes')} description={config?.notebooks.find(nb => nb.id === selectedNotebookId)?.title}>
                <NoteToolbar readOnly={!canWrite} viewMode={viewMode} setViewMode={setViewMode}
                  searchQuery={searchQuery} setSearchQuery={setSearchQuery}
                  onOpenNewNoteModal={() => openNewNote()} filtersOpen={filtersOpen}
                  onToggleFilters={() => setFiltersOpen(open => !open)} />
              </PageHeader>
              <div className="workspace-scroll">
              {actionError && <p role="alert" className="mb-3 text-sm text-rose-600">{actionError}</p>}
              <Breadcrumbs
                segments={breadcrumbs}
                currentFolder={selectedFolder}
                onSelectFolder={setSelectedFolder}
                subfolderCount={immediateSubfolders.length}
                noteCount={displayedNotes.length}
                sortField={sortField}
                sortOrder={sortOrder}
                onSortChange={viewMode !== 'kanban' ? handleSortChange : undefined}
              />
              {viewMode === 'list' && (
                <ListView
                  statuses={notebookStatuses}
                  readOnly={!canWrite}
                  canDelete={!remote && canWrite}
                  notes={displayedNotes}
                  subfolders={immediateSubfolders}
                  onOpenNote={handleOpenNote}
                  onDeleteNote={handleDeleteNote}
                  onUpdateNoteStatus={handleUpdateNoteStatus}
                  onNewNote={() => openNewNote()}
                  onSelectFolder={setSelectedFolder}
                  sortField={sortField}
                  sortOrder={sortOrder}
                  onSortChange={handleSortChange}
                />
              )}
              {viewMode === 'card' && (
                <CardView
                  statuses={notebookStatuses}
                  readOnly={!canWrite}
                  canDelete={!remote && canWrite}
                  notes={displayedNotes}
                  subfolders={immediateSubfolders}
                  onOpenNote={handleOpenNote}
                  onDeleteNote={handleDeleteNote}
                  onNewNote={() => openNewNote()}
                  onUpdateNoteStatus={handleUpdateNoteStatus}
                  onSelectFolder={setSelectedFolder}
                />
              )}
              {viewMode === 'kanban' && (
                <KanbanView
                  statuses={notebookStatuses}
                  readOnly={!canWrite}
                  canDelete={!remote && canWrite}
                  notes={filteredNotes}
                  onOpenNote={handleOpenNote}
                  onUpdateNoteStatus={handleUpdateNoteStatus}
                  onDeleteNote={handleDeleteNote}
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
              readOnlyNotice={t(remote ? 'agent.remoteReadOnlyNotice' : branch === 'core' ? 'agent.coreBranchNotice' : 'agent.workspaceReadOnlyNotice')}
            />
          </main>
        )}

        {activeTab === 'assets' && (
          <main className="workspace-route assets-main">
            <AssetBrowser
              assets={assets}
              notebooks={config?.notebooks || []}
              selectedNotebookId={selectedNotebookId}
              onBusyChange={setResourceNavigationBusy}
              onUploadAsset={!canWrite ? undefined : handleUploadAsset}
              onDeleteAsset={!canWrite ? undefined : handleDeleteAsset}
              onMoveAsset={!canWrite ? undefined : handleMoveAsset}
            />
          </main>
        )}

        {activeTab === 'screen' && <React.Suspense fallback={<p role="status" className="p-8">{t('screen.loading')}</p>}><ScreenPage key={remote ? sourceId : repoRoot} scope={remote ? sourceId : `local:${repoRoot}`} notebooks={config?.notebooks || []} notes={notes} folders={folders} selectedNotebookId={selectedNotebookId} onOpenNote={handleOpenNote} onSaved={() => { void fetchGitStatus().then(result => setGitStatus(result.status)); }} /></React.Suspense>}

        {activeTab === 'settings' && (
          <main className="workspace-route settings-main">
            <SettingsModal
              config={config}
              branch={branch}
              repoRoot={remote ? sourceId.replace(/^github:/, '') : repoRoot}
              local={!remote}
              accountSettings={<AgentAccessSettings local={!remote} />}
              onRefreshWorkspace={refreshWorkspace}
              currentTheme={currentTheme}
              onSelectTheme={handleSelectTheme}
            />
          </main>
        )}
      </div>

      {/* Floating Commit Footer: only shows when working tree is dirty, with restore button (Requirement 1 & 2) */}
      <FloatingCommitFooter
        gitStatus={gitStatus}
        onOpenCommitModal={() => setIsCommitOpen(true)}
        deletedNotes={deletedNotes}
        onRestoreNote={handleRestoreNote}
      />

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

      {/* Note Editor Modal */}
      <EditorModal
        statuses={resolveNoteStatuses(
          config?.notebooks.find(nb => nb.id === routedNote?.notebookId),
          notes.filter(note => note.notebookId === routedNote?.notebookId).map(note => note.status),
        )}
        note={routedNote}
        isOpen={Boolean(routedNote) && !routeError}
        onClose={() => {

          setEditingNote(null);
          const query = new URLSearchParams(location.search); query.delete('folder');
          if (query.get('returnTo') === 'screen') navigate(`/screen?notebook=${encodeURIComponent(selectedNotebookId)}`);
          else navigate(notebookRoute(selectedNotebookId,selectedFolder)+'?'+query.toString());
        }}
        onSave={handleSaveNote}
        onRestoreFile={handleRestoreNoteFile}
        isDirty={isEditingNoteDirty}
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
        previewDiff={remote ? workingDiff(activeWorkingNotes) : undefined}
        commitFiles={remote ? commitWorkingNotes : undefined}
        isOpen={isCommitOpen}
        onClose={() => setIsCommitOpen(false)}
        gitStatus={gitStatus}
        onCommitted={async () => {
          await refreshWorkspace();
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
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  {t('createNote.initialStatus')}
                </label>
                <Select aria-label={t('createNote.initialStatus')} value={newNoteStatus} onValueChange={setNewNoteStatus} options={notebookStatuses.map(value => ({value,label:value}))} className="w-full" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setIsNewNoteOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition active:scale-95"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleCreateNewNote()}
                disabled={!newNoteTitle.trim()}
                style={{ backgroundColor: 'var(--color-primary)' }}
                className="px-4 py-2 text-xs font-medium text-white rounded-lg shadow-sm transition hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('createNote.submit')}
              </button>
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
