import { useNoteSort } from './app/useNoteSort.js';
import { useFilterSidebar } from './app/useFilterSidebar.js';
import { useTheme } from './app/useTheme.js';
import { useFilePanel } from './app/useFilePanel.js';
import { useWorkspaceNotes } from './app/useWorkspaceNotes.js';
import { useBrowseRoute } from './app/useBrowseRoute.js';
import { useBrowseFacets } from './app/useBrowseFacets.js';
import { useFocusPanes } from './app/useFocusPanes.js';
import { useWorkspaceNavigation } from './app/useWorkspaceNavigation.js';
import { useSourceReset } from './app/useSourceReset.js';
import { useBrowseNotes } from './app/useBrowseNotes.js';
import { useNoteActions } from './app/useNoteActions.js';
import { useFocusNoteNavigation } from './app/useFocusNoteNavigation.js';
import { useNoteSaving } from './app/useNoteSaving.js';
import { useDeletionUndo } from './app/useDeletionUndo.js';
import { useNoteRestoration } from './app/useNoteRestoration.js';
import { useWorkingNoteCommit } from './app/useWorkingNoteCommit.js';
import { useFileNavigation } from './app/useFileNavigation.js';
import { useChangeDialog } from './app/useChangeDialog.js';
import { useQuickNoteCommit } from './app/useQuickNoteCommit.js';
import { useShortcutSurface } from './app/useShortcutSurface.js';
import { type NoteListItem, noteQueryStatuses, type NoteRef, noteRefKey, sameNote } from '@mygitnotes/core/note-query';
import { useWorkspaceSync } from './lib/use-workspace-sync.js';
import { discardDocumentDraft } from './lib/use-workspace-document.js';
import { documentClientOf } from './lib/workspace-document-clients.js';
import { WorkspaceLinks } from './components/WorkspaceLinks.js';
import { type NoteLocation, NoteLocationProvider, readOnlyReason } from './lib/note-location.js';
import { ImageLightbox } from './components/ImageLightbox.js';
import { useNavigate } from 'react-router-dom';
import { notebookRoute, noteRoute, noteTrail, parseWorkspaceRoute } from './lib/routes.js';
import { draftScope } from './lib/workspace-repositories.js';
import { sameValue } from './lib/merge-note.js';
import React, { useMemo, useState } from 'react';
import { fetchFileDiff, fetchGitStatus, readNote } from './lib/api.js';
import { workingDiff } from './lib/working-notes.js';
import { NoteListSentinel } from './components/NoteListSentinel.js';
import type { NoteItem } from './lib/types.js';
import { useTagWorkspaceOperations } from './app/useTagWorkspaceOperations.js';
import { useNoteSelection } from './app/useNoteSelection.js';
import { useBulkNoteActions } from './app/useBulkNoteActions.js';
import { BulkActionsToolbar } from './components/BulkActionsToolbar.js';
import { BulkMoveDialog } from './components/BulkMoveDialog.js';
import { useAssetOperations } from './app/useAssetOperations.js';
import { useRoutedNote } from './app/useRoutedNote.js';
import { useNewNoteDialog } from './app/useNewNoteDialog.js';
import { NewNoteDialog } from './app/NewNoteDialog.js';
import { AgentAccessSettings, AuthControls, ConnectionState } from './components/AuthControls.js';
import { Header } from './components/Header.js';
import { KeyboardShortcuts } from './components/KeyboardShortcuts.js';
import { NoteToolbar } from './components/NoteToolbar.js';
import { PageToolbar, SidebarProvider, WorkspaceSidebarPortal, WorkspaceSplitLayout } from './components/WorkspaceChrome.js';
import { useVisualViewport } from './lib/use-visual-viewport.js';
import { Sidebar } from './components/Sidebar.js';
import { ListView } from './components/ListView.js';
import { CardView } from './components/CardView.js';
import { KanbanView } from './components/KanbanView.js';
import { EditorModal } from './components/EditorModal.js';
import type { NoteEditorSharedProps } from './components/note-editor/types.js';
import { NoteEditingProvider, useNoteEditorRegistry } from './lib/note-editing.js';
import { FocusArea } from './components/FocusArea.js';
import { FocusControls } from './components/FocusControls.js';
import { AddToFocusDialog } from './components/AddToFocusDialog.js';
import { CompilationView } from './components/CompilationView.js';
import { NewCompilationDialog } from './components/NewCompilationDialog.js';
import { planNewCompilation } from './lib/compilation-create.js';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { usePhone } from './components/FocusArea.js';
import { useFocusSearch } from './lib/focus-search.js';
import { LegacyScreenRedirect } from './components/LegacyScreenRedirect.js';
import { LegacySchemaNotice } from './components/LegacySchemaNotice.js';
import { CompilationActionsProvider } from './lib/compilation-actions.js';
import { useCompilationActionsValue } from './app/useCompilationActionsValue.js';
import { BrowseDock, BrowseDockToggle, CARD_TWO_ROW_HEIGHT } from './components/BrowseDock.js';
import { RightPanel } from './components/RightPanel.js';
import { FileManager, FileManagerDialog, FileMetadata } from './components/files/index.js';
import { AgentSystemView } from './components/AgentSystemView.js';
import { SettingsModal } from './components/SettingsModal.js';
import { CommitModal } from './components/CommitModal.js';
import { Breadcrumbs } from './components/Breadcrumbs.js';
import { FolderIndex } from './components/FolderIndex.js';
import { FolderLinks } from './components/FolderLinks.js';
import { I18nProvider, useTranslation } from './lib/i18n/index.js';
import { AlertCircle, AlertTriangle, X } from 'lucide-react';
import { LoadingStatus } from './components/LoadingStatus.js';

const CompilationStudy = React.lazy(() => import('./components/CompilationStudy.js').then(module => ({ default: module.CompilationStudy })));
const NotebookGraphPage = React.lazy(() => import('./components/NotebookGraphPage.js').then(module => ({ default: module.NotebookGraphPage })));

const AppContent: React.FC = () => {
  useVisualViewport();
  const { t } = useTranslation();
  const { sortField, sortOrder, handleSortChange } = useNoteSort();

  const { folderReorder, setFolderReorder, filtersOpen, setFiltersOpen, location, queryState, setFilterQuery } = useFilterSidebar();

  const { currentTheme, handleSelectTheme } = useTheme();

  const [editingNote, setEditingNote] = useState<NoteListItem | null>(null);
  const [fileEditorRevision, setFileEditorRevision] = useState(0);

  const { fileDialog, setFileDialog, fileMetadataContainer, setFileMetadataContainer, fileMetadataOpen, setFileMetadataOpen, rightPanelWidth, setRightPanelWidth, selectedFileEntry, setSelectedFileEntry, fileManagerRef } = useFilePanel();

  // The URL owns page, notebook, folder and filter selection.
  const navigate = useNavigate();
  const editorRoute = useMemo(() => parseWorkspaceRoute(location.pathname, location.search), [location.pathname, location.search]);

  const { selectedNotebookId, folders, sourceId, remote, repositories, homeRepository, homeBranch, repositoryFor, canWriteNotebook, revisionFor, setRepositoryRevision, setNotebookRevision, configRevision, setConfigRevision, loadError, loading, actionError, setActionError, repoRoot, config, gitStatus, setGitStatus, assets, setAssets, activeWorkingNotes, readDraft, readDraftIn, updateDraft, clearCommittedDrafts, hasPendingDrafts, focus: focusPage, documents, pendingDocuments, refreshWorkspace, stageWorkingNote } = useWorkspaceSync({ routeNotebook: editorRoute.notebook || undefined, onStageNote: note => setEditingNote(current => current && sameNote(current, note) && !sameValue(current, note) ? note : current) });
  const refreshDocuments = async () => {
    await Promise.all(documents.map(document => document.refresh()));
  };
  // The selected notebook's repository decides what the browse, create and file views may write.
  const canWrite = canWriteNotebook(selectedNotebookId);
  const branch = repositoryFor(selectedNotebookId)?.branch ?? homeBranch;
  // Workspace documents and the manifest live in the home repository.
  /** Where a note lives, for the note Info tab: the repository and branch of its notebook, and why it is read-only. */
  const locateNote = (note: NoteRef): NoteLocation | undefined => {
    const repository = repositoryFor(note.notebookId);
    const notebook = config?.notebooks.find(nb => nb.id === note.notebookId);
    if (!notebook) return undefined;
    const name = repository?.repository ?? (repository?.id.startsWith('local:') ? repository.id.slice('local:'.length) : repository?.id ?? '');
    const readOnly = readOnlyReason(repository);
    return { notebook: notebook.title, repository: name, branch: repository?.branch ?? '', path: note.path, readOnly, gists: repository?.type === 'github' && !readOnly };
  };
  /** Pending changes across repositories; a path names a file only within its repository, so each repository counts its own. */
  const changeCount = remote ? Object.keys(activeWorkingNotes).length + pendingDocuments.length : repositories.filter(repository => !repository.unavailable).reduce((sum, repository) => {
    const status = repository.id === sourceId ? gitStatus : repository.gitStatus;
    return sum + (status ? new Set([...status.staged, ...status.modified, ...status.untracked]).size : 0);
  }, 0);
  /** With several repositories, Changes groups entries under each repository and its branch. */
  const repositoryHeading = repositories.length > 1
    ? (id: string | undefined) => {
      const repository = repositories.find(candidate => candidate.id === id);
      const name = repository?.repository ?? (id?.startsWith('local:') ? id.slice('local:'.length) : id ?? '');
      return repository?.branch ? `${name} · ${repository.branch}` : name;
    }
    : undefined;
  /** Why the selected notebook's repository cannot serve it; its notebook views show this instead. */
  const notebookUnavailable = repositoryFor(selectedNotebookId)?.unavailable;
  /** The Agents page edits the Agent files of the selected notebook's repository; the app-wide Git status is the home worktree's. */
  const agentRepository = repositoryFor(selectedNotebookId)?.id;
  /** The manifest lives in the home repository. */
  const manifestWritable = Boolean(homeRepository?.write);
  // A workspace-wide tag change commits to every repository that serves a notebook.
  const canManageTags = repositories.some(repository => repository.notebooks.length) && repositories.every(repository => repository.write || !repository.notebooks.length);
  const editorRegistry = useNoteEditorRegistry();

  const { queryClient, queryScope, invalidateNotes, refreshNotes, staleNotice, readCommittedNote, readNoteForChange } = useWorkspaceNotes({ sourceId, repositories, activeWorkingNotes, remote, refreshWorkspace, readDraft, t });

  // Tag management: rename/merge/delete across the whole workspace, one commit per repository,
  // with a session-lifetime undo (kept in `tagOperations.history` until page reload).
  const { tagOperations, previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag, handleUndoTagOperation } = useTagWorkspaceOperations({ queryClient, queryScope, repositories, remote, canWrite: canManageTags, t, invalidateNotes, setRepositoryRevision, setActionError });

  const { editorNotebookId, returnTo, route, activeTab, sidebarGestureRef, selectedFolders, folderRoot, selectedFolder, scopeNotebookId, selectedStatus, showHidden } = useBrowseRoute({ editorRoute, config, location, queryState, setFolderReorder, setFileMetadataOpen, loading, loadError, filtersOpen, setFiltersOpen, selectedNotebookId });

  const { facetsQuery, notebookFacets, notebookStatuses, newNoteStatuses, selectedTags, workspaceTagNames, noteTagActions, searchQuery, viewMode, folderless } = useBrowseFacets({ showHidden, config, scopeNotebookId, selectedFolders, selectedNotebookId, route, canManageTags, previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag });

  const { focusCapacity, noteFocus, focusDisplay, focusNarrowView, setFocusNarrowView, addingToFocus, setAddingToFocus, activePaneNote, focusDocumentPanel, setDocumentContainer, showFocus } = useFocusPanes({ selectedNotebookId, focusPage, remote, sourceId, repoRoot, activeTab, route, canWrite: canWriteNotebook(selectedNotebookId), editorRegistry, location, navigate, editorRoute, config });

  const { changeFilters, clearFilters, changeAllNotebooks, setActiveTab, agentSystemRef, resourceNavigationBusy, setResourceNavigationBusy, notebookSwitchBusy, setSelectedNotebookId, setSelectedFolder, setViewMode } = useWorkspaceNavigation({ location, queryState, selectedFolders, setFilterQuery, navigate, route, activeTab, selectedNotebookId, folderRoot, viewMode, selectedFolder, config, editorRegistry, fileManagerRef, loading, editorRoute });

  const { commitRequest, isCommitOpen, setIsCommitOpen, openCommitModal, panelRemoteChanges, panelGetPreview } = useChangeDialog({ activeTab, agentSystemRef, remote, documents, setActionError, activeWorkingNotes, pendingDocuments, canWriteNotebook, repositoryFor });

  // Aggregated tags across the workspace for autocomplete
  const availableTags = useMemo(() => Array.from(new Set(workspaceTagNames.map(tag => tag.trim()))).filter(Boolean).sort(), [workspaceTagNames]);

  const { deletedNotes, setDeletedNotes, undoToast, setUndoToast, handleDeleteNote, handleRestoreNote } = useDeletionUndo({ canWriteNotebook, revisionFor, setNotebookRevision, updateDraft, editingNote, setEditingNote, navigate, returnTo, remote, setActionError, readNoteForChange, invalidateNotes, setGitStatus });

  useSourceReset({ sourceId, setEditingNote, setDeletedNotes });

  const { routedNote, routedCommitted, routedLoading, routeError } = useRoutedNote({ config, editorRoute, editorNotebookId, editingNote, loading, sourceId, setEditingNote });

  const { notebookRoot, folderIndex, baseQuery, listResult, displayedNotes, filterProps, immediateSubfolders, breadcrumbs, indexLookup, debouncedSearch } = useBrowseNotes({ scopeNotebookId, selectedFolders, selectedTags, route, searchQuery, selectedStatus, showHidden, config, selectedNotebookId, selectedFolder, activeTab, sortField, sortOrder, viewMode, facetsQuery, notebookFacets, folders, notebookStatuses, changeAllNotebooks, changeFilters, clearFilters, folderless, t });

  const { handleOpenNote } = useNoteActions({ activeTab, editorRegistry, setEditingNote, config, location, editorRoute, returnTo, selectedFolder, selectedNotebookId, navigate, setAssets });

  const { openInFocus, openFromBrowse, openLink, zoomFocusNote, addToFocus } = useFocusNoteNavigation({ noteFocus, selectedNotebookId, setFocusNarrowView, handleOpenNote, setAddingToFocus });

  const { handleSaveNote } = useNoteSaving({ canWriteNotebook, remote, readDraft, readCommittedNote, t, stageWorkingNote, invalidateNotes, setEditingNote, setGitStatus, homeDraftScope: homeRepository ? draftScope(homeRepository) : '' });

  const { handleRestoreNoteFile, handleUpdateNoteStatus, handleOpenFolderIndex } = useNoteRestoration({ remote, readDraft, updateDraft, setEditingNote, navigate, returnTo, invalidateNotes, setGitStatus, setActionError, handleSaveNote, readNoteForChange, selectedNotebookId, canWriteNotebook, t, config, queryClient, queryScope, stageWorkingNote, revisionFor, location });

  // Multi-select and bulk actions (set status, add/remove tag, move to folder) for the browse views.
  const { selectedNotes, selectedKeys, toggleSelect, clearSelection } = useNoteSelection({ displayedNotes, viewMode, selectedNotebookId, scopeKey: location.pathname + location.search });
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const bulkMoveNotebookId = selectedNotes.length > 0 && selectedNotes.every(note => note.notebookId === selectedNotes[0].notebookId) ? selectedNotes[0].notebookId : undefined;
  const bulkMoveNotebook = config?.notebooks.find(nb => nb.id === bulkMoveNotebookId);

  // Create New Note dialog: its form state and the handlers that render or persist a new note draft.
  const { createError, isNewNoteOpen, setIsNewNoteOpen, newNoteTitle, setNewNoteTitle, newNoteStatus, setNewNoteStatus, newNoteFolder, setNewNoteFolder, newNoteTags, setNewNoteTags, newNoteTemplateId, setNewNoteTemplateId, newNoteFolders, newNoteTemplates, handleTemplateChange, openNewNote, handleCreateNewNote } = useNewNoteDialog({ config, selectedNotebookId, setSelectedNotebookId, folders, remote, canWrite, readDraft, queryClient, queryScope, stageWorkingNote, revisionFor, invalidateNotes, setGitStatus, sourceId, newNoteStatuses, t, onCreated: handleOpenNote });

  const { commitWorkingNotes } = useWorkingNoteCommit({ documents, sourceId, t, stageWorkingNote, clearCommittedDrafts, setRepositoryRevision, setActionError });
  const { commitNoteFile } = useQuickNoteCommit({ remote, repositoryFor, refreshWorkspace, commitWorkingNotes });

  // Assets are scoped to whichever notebook the open note (or the selected browse notebook) belongs to.
  const { handleUploadAsset, handleDeleteAsset, handleMoveAsset } = useAssetOperations({ editingNote, selectedNotebookId, remote, setAssets, setGitStatus });

  const { beforeFileChange, openFileManager, moveNoteAction, onFilesChanged, openFileIndex } = useFileNavigation({ editorRegistry, hasPendingDrafts, documents, t, config, setFileDialog, setActionError, refreshWorkspace, refreshDocuments, editorRoute, editorNotebookId, setEditingNote, navigate, location, returnTo, setFileEditorRevision, selectedFolder, folderRoot, changeFilters, handleOpenFolderIndex });
  const { bulkBusy, runBulkStatus, runBulkTag, runBulkMove } = useBulkNoteActions({ selectedNotes, clearSelection, onUpdateNoteStatus: handleUpdateNoteStatus, beforeFileChange, onFilesChanged, repositories, remote, canWrite, t, invalidateNotes, setRepositoryRevision, setActionError, tagOperations, config });

  const noteEditorOpen = (Boolean(routedNote) || routedLoading) && !routeError;

  // Every editor of a note, in zoom or in a Focus pane, is wired to the same handlers and per-path state.
  const editorProps = (note: NoteItem, committed?: NoteItem): NoteEditorSharedProps => {
    // The note's repository decides whether it may be written and where its drafts are kept.
    const repository = repositoryFor(note.notebookId);
    const writable = Boolean(repository?.write);
    const draft = activeWorkingNotes[noteRefKey(note)];
    const repositoryStatus = repository?.id === sourceId ? gitStatus : repository?.gitStatus ?? null;
    return {
      statuses: noteQueryStatuses(config?.notebooks || [], note.notebookId, Object.keys(facetsQuery.facets?.[note.notebookId]?.statuses || {})),
      metadataFields: config?.notebooks.find(nb => nb.id === note.notebookId)?.metadata,
      onSave: params => handleSaveNote({ ...params, notebookId: note.notebookId }),
      onRestoreFile: path => handleRestoreNoteFile(path, note.notebookId),
      onCommitFile: writable ? path => commitNoteFile(path, note.notebookId) : undefined,
      // The same diff the Changes panel shows: a remote note's draft against its base, a local note's worktree against HEAD.
      readDiff: remote ? draft && (async () => workingDiff({ [note.path]: draft })) : () => fetchFileDiff({ path: note.path, repository: repository?.id }, 'current'),
      // A path names a file only within its repository: a remote note is dirty when it holds a draft, a local one when its worktree reports it.
      isDirty: remote ? Boolean(draft) : Boolean(repositoryStatus && [...repositoryStatus.modified, ...repositoryStatus.staged, ...repositoryStatus.untracked].includes(note.path)),
      availableTags,
      assets,
      onUploadAsset: !writable ? undefined : handleUploadAsset,
      onDeleteAsset: !writable ? undefined : handleDeleteAsset,
      onMoveAsset: !writable ? undefined : handleMoveAsset,
      beforeFileChange: !writable ? undefined : beforeFileChange,
      onFilesChanged: !writable ? undefined : onFilesChanged,
      readOnly: !writable,
      autoSave: true,
      draftMode: remote,
      remoteBase: draft?.base || (committed && typeof committed.content === 'string' ? committed : undefined),
      conflictReason: draft?.blocked,
      onMarkConflict: remote
        ? (reason, draft, base) => {
          stageWorkingNote(draft, base, reason);
        }
        : undefined,
      onReadRemote: remote && draft?.base === null ? undefined : (path: string) => readNote(path, note.notebookId),
      branch: repository?.branch ?? '',
      draftScope: repository ? draftScope(repository) : '',
    };
  };
  const closeZoom = () => {
    setEditingNote(null);
    const trail = noteTrail(location.state);
    const previous = trail[trail.length - 1];
    if (previous) navigate(previous, { replace: true, state: trail.length > 1 ? { noteTrail: trail.slice(0, -1) } : null });
    else navigate(returnTo, { replace: true });
  };

  const { focusCommands, shortcutMode, setShortcutMode } = useShortcutSurface({ noteFocus, focusDisplay, t, activeTab, showFocus, zoomFocusNote });

  // With a Focus displayed, the browse region docks beside it (list, flat) or above it (card, kanban).
  const topDock = viewMode === 'card' || viewMode === 'kanban';
  const browseFocusMode = noteFocus.layout ? { onZoomNote: (note: NoteListItem) => void handleOpenNote(note), canDrag: (note: NoteListItem) => noteFocus.editable && note.notebookId === selectedNotebookId } : undefined;
  // Either dock collapses and reopens from the toolbar's left end.
  const dockToggle = noteFocus.layout && focusCapacity > 1 ? <BrowseDockToggle placement={topDock ? 'top' : 'left'} collapsed={noteFocus.view.dock.collapsed} onCollapsedChange={collapsed => noteFocus.setDock({ collapsed })} /> : undefined;
  const browseRegion = (docked: boolean, dockHeight: number) => (
    <>
      <LegacySchemaNotice schemaVersion={config?.schema_version} />
      {actionError && <p role='alert' className='mb-3 text-sm text-danger'>{actionError}</p>}
      {selectedNotes.length > 0 && <BulkActionsToolbar count={selectedNotes.length} statuses={notebookStatuses} availableTags={availableTags} busy={bulkBusy} readOnly={!canWrite} canMove={Boolean(bulkMoveNotebookId)} onSetStatus={status => void runBulkStatus(status)} onAddTag={tag => void runBulkTag('add', tag)} onRemoveTag={tag => void runBulkTag('remove', tag)} onMove={() => setBulkMoveOpen(true)} onClear={clearSelection} />}
      {staleNotice && <p role='alert' className='mb-3 text-sm text-warning'>{staleNotice}</p>}
      {listResult.error && <p role='alert' className='mb-3 text-sm text-danger'>{t('notes.loadFailed', { message: listResult.error })}</p>}
      {facetsQuery.error && <p role='alert' className='mb-3 text-sm text-danger'>{t('notes.countsFailed', { message: facetsQuery.error })}</p>}
      {indexLookup.error && <p role='alert' className='mb-3 text-sm text-danger'>{t('notes.loadFailed', { message: indexLookup.error })}</p>}
      {listResult.loading && <LoadingStatus className='mb-3 text-sm text-muted'>{t('notes.loading')}</LoadingStatus>}
      {!folderless && (
        <>
          <Breadcrumbs segments={breadcrumbs} currentFolder={selectedFolder} onSelectFolder={setSelectedFolder} subfolderCount={immediateSubfolders.length} noteCount={listResult.total} sortField={sortField} sortOrder={sortOrder} onSortChange={handleSortChange} compact={docked && !topDock} />
          <FolderLinks folders={immediateSubfolders} onSelect={setSelectedFolder}>{folderIndex && <FolderIndex note={folderIndex} onOpenNote={note => void openFromBrowse(note)} />}</FolderLinks>
        </>
      )}
      {(viewMode === 'list' || viewMode === 'flat') && (
        <>
          <ListView showMobileSort={false} compact={docked} focusMode={browseFocusMode} statuses={notebookStatuses} readOnly={!canWrite} canDelete={canWrite} confirmDelete={remote} notes={displayedNotes} loading={listResult.loading} uncommitted={listResult.uncommitted} hasFolderEntries={immediateSubfolders.length > 0 || Boolean(folderIndex)} onOpenNote={note => void openFromBrowse(note)} onDeleteNote={handleDeleteNote} onMoveNote={moveNoteAction} onUpdateNoteStatus={handleUpdateNoteStatus} onNewNote={() => openNewNote()} sortField={sortField} sortOrder={sortOrder} onSortChange={handleSortChange} tagActions={noteTagActions} leading={viewMode === 'flat' && folderIndex ? <FolderIndex note={folderIndex} onOpenNote={note => void openFromBrowse(note)} /> : undefined} highlightQuery={debouncedSearch} selectedKeys={selectedKeys} onToggleSelect={toggleSelect} />
          <NoteListSentinel hasMore={listResult.hasMore} loading={listResult.loadingMore} error={listResult.error} onLoadMore={listResult.loadMore} />
        </>
      )}
      {viewMode === 'card' && (
        <>
          <CardView strip={docked && dockHeight < CARD_TWO_ROW_HEIGHT} focusMode={browseFocusMode} statuses={notebookStatuses} readOnly={!canWrite} canDelete={canWrite} confirmDelete={remote} notes={displayedNotes} loading={listResult.loading} uncommitted={listResult.uncommitted} hasFolderEntries={immediateSubfolders.length > 0 || Boolean(folderIndex)} onOpenNote={note => void openFromBrowse(note)} onDeleteNote={handleDeleteNote} onMoveNote={moveNoteAction} onNewNote={() => openNewNote()} onUpdateNoteStatus={handleUpdateNoteStatus} tagActions={noteTagActions} highlightQuery={debouncedSearch} selectedKeys={selectedKeys} onToggleSelect={toggleSelect} />
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
          selectedKeys={selectedKeys}
          onToggleSelect={toggleSelect}
        />
      )}
    </>
  );
  // The toolbar search dims what the Focus shows that it does not match; on a phone it only filters the list.
  const phone = usePhone();
  const focusMatches = useFocusSearch({ q: debouncedSearch, notebookId: selectedNotebookId, enabled: Boolean(noteFocus.layout) && !phone });
  const compilationActions = useCompilationActionsValue({ remote, canWriteNotebook, repositoryId: notebookId => repositoryFor(notebookId)?.id, revisionFor, save: handleSaveNote, remove: handleDeleteNote, stageWorkingNote, invalidateNotes, setGitStatus, createNote: openNewNote });
  const [newCompilationOpen, setNewCompilationOpen] = useState(false);
  const createCompilation = async (row: CompilationRow) => {
    const notebook = config?.notebooks.find(nb => nb.id === row.notebookId);
    if (!notebook) return;
    try {
      const plan = await planNewCompilation(row, notebook, selectedFolder ?? '');
      void openFromBrowse(await compilationActions.create(notebook.id, plan.path, plan.content, plan.metadata));
    } catch (error) {
      setActionError((error as Error).message);
    }
  };
  const openCompilationFolder = (item: { notebookId: string; path: string; }) => {
    // A folder of this notebook filters the browse region and keeps the Focus; others open as they do elsewhere.
    const notebook = config?.notebooks.find(nb => nb.id === item.notebookId);
    if (item.notebookId !== selectedNotebookId || !notebook || !folderRoot) return false;
    const assetRoot = `${folderRoot}/${notebook.assets || 'assets'}`;
    if (item.path === assetRoot || item.path.startsWith(`${assetRoot}/`)) return false;
    if (item.path !== folderRoot && !item.path.startsWith(`${folderRoot}/`)) return false;
    setSelectedFolder(item.path === folderRoot ? null : item.path.slice(folderRoot.length + 1));
    return true;
  };
  /** The compilation at `path` of the selected notebook, in a Focus pane (`pane`) or in zoom. */
  const renderCompilation = (path: string, pane?: number) => (
    <CompilationView
      key={`${selectedNotebookId}:${path}`}
      notebookId={selectedNotebookId}
      path={path}
      notebooks={config?.notebooks || []}
      folders={folders}
      frame={pane === undefined ? 'zoom' : 'pane'}
      onOpenNote={note => void (pane === undefined ? handleOpenNote(note) : openInFocus(note, pane).then(opened => {
        if (!opened) void handleOpenNote(note);
      }))}
      onOpenFolder={openCompilationFolder}
      onClose={pane === undefined ? closeZoom : undefined}
    />
  );

  if (loading || loadError) return <ConnectionState loading={loading} error={loadError} onRetry={refreshWorkspace} />;
  if (route.legacyScreen) return <LegacyScreenRedirect laneId={route.legacyLane} notebooks={config?.notebooks || []} onMissing={setActionError} />;

  return (
    <CompilationActionsProvider value={compilationActions}>
      <WorkspaceLinks notebooks={config?.notebooks || []} folders={folders} onOpenNote={(note, anchor, source) => void openLink(note, anchor, source)}>
        <NoteLocationProvider locate={locateNote}>
          <NoteEditingProvider register={editorRegistry.register} editorProps={editorProps} flushEditors={editorRegistry.flushEditors} refreshNotes={refreshNotes} closeZoom={closeZoom} addToFocus={addToFocus}>
            <div className='app-shell h-dvh w-full overflow-hidden flex flex-col font-sans transition-colors duration-200' data-workspace-tab={activeTab} data-screen-focus={Boolean(route.study)} style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
              {/* Core Branch User Guidance Banner (Theme-aware, harmonized with active palette) */}
              {!remote && homeBranch === 'core' && (
                <div className='shrink-0 flex-none px-4 py-2 text-xs flex items-center justify-between font-medium border-b transition-colors' style={{ backgroundColor: 'var(--color-sidebar)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <div className='flex items-center gap-2.5'>
                    <AlertTriangle className='w-4 h-4 text-warning shrink-0' />
                    <span className='px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-on-primary shrink-0 shadow-xs' style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>{t('nav.coreBaseline')}</span>
                    <span className='text-muted'>{t('nav.coreBanner')}</span>
                  </div>
                </div>
              )}
              {/* Top Header */}
              <Header unavailableNotebooks={repositories.filter(repository => repository.unavailable).flatMap(repository => repository.notebooks)} workspaceTitle={config?.workspace.title || 'MyGitNotes'} accountControls={<AuthControls local={!remote} />} notebooks={config?.notebooks || []} selectedNotebookId={selectedNotebookId} onSelectNotebook={id => void setSelectedNotebookId(id)} notebookDisabled={loading || resourceNavigationBusy || notebookSwitchBusy} activeTab={activeTab} setActiveTab={setActiveTab} onCreateNote={() => openNewNote()} createNoteDisabled={!canWrite} onOpenCommands={() => setShortcutMode('palette')} navigationDisabled={noteEditorOpen || isCommitOpen} />
              <KeyboardShortcuts
                mode={shortcutMode}
                onModeChange={setShortcutMode}
                suspended={isCommitOpen}
                noteEditorOpen={noteEditorOpen}
                activeTab={activeTab}
                canCreateNote={canWrite}
                selectedNotebookId={selectedNotebookId}
                onNavigate={tab => void setActiveTab(tab)}
                onCreateNote={() => openNewNote()}
                onFocusSearch={() => {
                  if (activeTab === 'notes') setFiltersOpen(true);
                  requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.header-search input')?.focus());
                }}
                onOpenNote={note => void handleOpenNote(note)}
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
                    // Collapsing the Notes browse dock hides the notebook sidebar with it; expanding the dock brings both back.
                    hasSidebar={activeTab !== 'graph' && !route.study && !(activeTab === 'notes' && dockToggle && noteFocus.view.dock.collapsed)}
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
                        changeCount={changeCount}
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
                        repositoryHeading={repositoryHeading}
                        syncTargets={remote ? undefined : repositories.filter(repository => !repository.unavailable).map(repository => ({ id: repository.id, label: repository.repository ?? repository.id.replace(/^local:/, ''), gitStatus: repository.id === sourceId ? gitStatus : repository.gitStatus ?? null }))}
                        onWidthChange={setRightPanelWidth}
                      />
                    }
                  >
                    {notebookUnavailable && ['notes', 'assets', 'graph'].includes(activeTab) && (
                      <main className='workspace-route notebook-unavailable'>
                        <section role='alert' className='notebook-unavailable-card'>
                          <AlertCircle aria-hidden='true' />
                          <div>
                            <h2>{t('notebook.unavailableTitle', { title: config?.notebooks.find(nb => nb.id === selectedNotebookId)?.title ?? selectedNotebookId })}</h2>
                            <p>{t(`notebook.unavailable.${notebookUnavailable.reason}`)}</p>
                            <p className='notebook-unavailable-detail'>{notebookUnavailable.message}</p>
                          </div>
                        </section>
                      </main>
                    )}
                    {!notebookUnavailable && activeTab === 'notes' && !route.study && (
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
                              if (hasPendingDrafts() || documents.some(document => document.dirty)) throw new Error(t('folder.draftsHint'));
                            }}
                            onFoldersChanged={async () => {
                              await refreshWorkspace(remote);
                              await refreshDocuments();
                            }}
                            selectedFolder={selectedFolder}
                            onSelectFolder={setSelectedFolder}
                            changeCount={changeCount}
                            onPulled={remote ? undefined : async () => {
                              await refreshWorkspace();
                              await refreshDocuments();
                            }}
                            repoRoot={repoRoot}
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
                            <NoteToolbar sortField={sortField} sortOrder={sortOrder} onSortChange={handleSortChange} readOnly={!canWrite} viewMode={viewMode} setViewMode={setViewMode} hiddenNoteCount={facetsQuery.facets ? notebookFacets.hidden : null} showHidden={showHidden} descendants={route.descendants} onShowHiddenChange={value => changeFilters({ showHidden: value })} onDescendantsChange={value => changeFilters({ descendants: value })} onOpenNewNoteModal={() => openNewNote()} onOpenNewCompilation={() => setNewCompilationOpen(true)} query={searchQuery} onQueryChange={value => changeFilters({ q: value })} filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen(open => !open)} focusControls={<FocusControls focus={noteFocus} onShow={key => void showFocus(key)} onReload={() => void focusPage.reload()} browseToggle={focusCapacity === 1 ? { showing: focusNarrowView === 'browse', onToggle: () => setFocusNarrowView(view => view === 'browse' ? 'focus' : 'browse') } : undefined} />} />
                          </PageToolbar>
                          {noteFocus.layout
                            ? (
                              <BrowseDock placement={topDock ? 'top' : 'left'} size={topDock ? noteFocus.view.dock.top : noteFocus.view.dock.left} onSizeChange={size => noteFocus.setDock(topDock ? { top: size } : { left: size })} collapsed={noteFocus.view.dock.collapsed} narrow={focusCapacity === 1} narrowView={focusNarrowView} browse={height => browseRegion(true, height)}>
                                <FocusArea focus={noteFocus} capacity={focusCapacity} notebookRoot={folderRoot ?? ''} folders={folders} renderCompilation={renderCompilation} searchMatches={focusMatches} onZoomNote={zoomFocusNote} documentPanel={focusDocumentPanel} />
                              </BrowseDock>
                            )
                            : <div className='workspace-scroll'>{browseRegion(false, 0)}</div>}
                        </main>
                      </>
                    )}
                    {activeTab === 'agent' && (
                      <main className='workspace-route agent-main'>
                        <AgentSystemView key={agentRepository} repository={agentRepository} notebooks={config?.notebooks || []} selectedNotebookId={selectedNotebookId} ref={agentSystemRef} onBusyChange={setResourceNavigationBusy} readOnly={!canWrite} remote={remote} onGitStatus={agentRepository === sourceId ? setGitStatus : undefined} readOnlyNotice={t(remote ? 'agent.remoteReadOnlyNotice' : branch === 'core' ? 'agent.coreBranchNotice' : 'agent.workspaceReadOnlyNotice')} />
                      </main>
                    )}
                    {!notebookUnavailable && activeTab === 'assets' && (
                      <main className='workspace-route assets-main has-sidebar-drawer'>
                        <FileManager key={`${sourceId}:${selectedNotebookId}`} ref={fileManagerRef} notebookId={selectedNotebookId} notebooks={config?.notebooks || []} onNotebookChange={id => void setSelectedNotebookId(id)} writable={canWrite} onSelectionChange={setSelectedFileEntry} metadataContainer={fileMetadataContainer} onShowMetadata={() => setFileMetadataOpen(true)} initialPath={new URLSearchParams(location.search).get('asset') || (new URLSearchParams(location.search).has('directory') ? `${folderRoot}/${config?.notebooks.find(nb => nb.id === selectedNotebookId)?.assets || 'assets'}${new URLSearchParams(location.search).get('directory') ? '/' + new URLSearchParams(location.search).get('directory') : ''}` : undefined)} onBusyChange={setResourceNavigationBusy} beforeChange={beforeFileChange} onChanged={onFilesChanged} onOpenIndex={openFileIndex} />
                      </main>
                    )}
                    {!notebookUnavailable && activeTab === 'notes' && route.study && (
                      <React.Suspense fallback={<LoadingStatus className='p-8'>{t('screen.loading')}</LoadingStatus>}>
                        <CompilationStudy
                          key={`${selectedNotebookId}:${route.study}`}
                          notebooks={config?.notebooks || []}
                          folders={folders}
                          notebookId={selectedNotebookId}
                          path={route.study}
                          onStudySaved={() => {
                            if (remote) void refreshWorkspace(true);
                            else invalidateNotes();
                            void fetchGitStatus().then(result => setGitStatus(result.status)).catch(error => setActionError((error as Error).message));
                          }}
                          onOpenNote={handleOpenNote}
                          onBack={() => {
                            const notebook = config?.notebooks.find(nb => nb.id === selectedNotebookId);
                            navigate(notebook ? noteRoute(notebook.id, route.study!.slice(notebook.root.length + 1)) : '/notes');
                          }}
                        />
                      </React.Suspense>
                    )}
                    {!notebookUnavailable && activeTab === 'graph' && (
                      <main className='workspace-route graph-main flex-1 w-full h-full relative min-h-0'>
                        <React.Suspense fallback={<p role='status' className='p-8'>{t('graph.title')}</p>}>
                          <NotebookGraphPage key={remote ? sourceId : repoRoot} notebookId={selectedNotebookId} notebooks={config?.notebooks || []} filters={filterProps} folders={folders} />
                        </React.Suspense>
                      </main>
                    )}
                    {activeTab === 'settings' && (
                      <main className='workspace-route settings-main has-sidebar-drawer'>
                        <SettingsModal config={config} branch={homeBranch} local={!remote} canWrite={manifestWritable} configRevision={configRevision} onConfigRevision={setConfigRevision} accountSettings={<AgentAccessSettings local={!remote} />} onRefreshWorkspace={refreshWorkspace} currentTheme={currentTheme} onSelectTheme={handleSelectTheme} />
                      </main>
                    )}
                  </WorkspaceSplitLayout>
                </div>
              </SidebarProvider>
              {/* Undo Toast Notification */}
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
                      <span>{t(record.label.key, record.label.params)}</span>
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
              {bulkMoveOpen && bulkMoveNotebook && (
                <BulkMoveDialog
                  notebook={bulkMoveNotebook}
                  folders={folders}
                  count={selectedNotes.length}
                  busy={bulkBusy}
                  onClose={() => setBulkMoveOpen(false)}
                  onConfirm={destination => {
                    setBulkMoveOpen(false);
                    void runBulkMove(bulkMoveNotebook.id, destination);
                  }}
                />
              )}
              {/* Note Editor Modal */}
              <EditorModal key={fileEditorRevision} note={routedNote} committed={routedCommitted && typeof routedCommitted.content === 'string' ? routedCommitted as NoteItem : undefined} loading={routedLoading} isOpen={noteEditorOpen} renderCompilation={renderCompilation} />
              {newCompilationOpen && <NewCompilationDialog notebooks={config?.notebooks || []} folders={folders} notebookId={selectedNotebookId} onAdd={row => void createCompilation(row)} onClose={() => setNewCompilationOpen(false)} />}
              {addingToFocus && (
                <AddToFocusDialog
                  focus={noteFocus}
                  tab={addingToFocus.tab}
                  label={addingToFocus.label}
                  onClose={() => setAddingToFocus(null)}
                  onPlaced={addingToFocus.tab.kind === 'note'
                    ? target => {
                      setEditingNote(null);
                      setFocusNarrowView('focus');
                      navigate(`${notebookRoute(selectedNotebookId)}?${new URLSearchParams({ focus: target })}`, { replace: true });
                    }
                    : undefined}
                />
              )}
              {/* Commit Modal */}
              <CommitModal
                writable={repositories.some(repository => repository.write)}
                remoteChanges={panelRemoteChanges}
                getPreview={panelGetPreview}
                request={commitRequest}
                restoreFile={remote
                  ? async file => {
                    const pendingDocument = pendingDocuments.find(document => document.repository === file.repository && document.file === file.path);
                    if (pendingDocument) {
                      if (file.revision !== pendingDocument.diff) throw new Error('Draft changed. Review it again.');
                      discardDocumentDraft(documentClientOf(file.path)!, pendingDocument.repository);
                      const live = documents.find(document => document.file === file.path && document.repository === pendingDocument.repository);
                      if (live) await live.reload();
                      return;
                    }
                    const entry = file.repository ? readDraftIn(file.repository, file.path) : undefined;
                    if (!entry || JSON.stringify(entry) !== file.revision) throw new Error('Draft changed. Review it again.');
                    // The draft lives in this browser, so discarding it is a local delete. Reading the remote
                    // only refreshes an open editor, and a draft is often blocked precisely because that read
                    // fails, which used to leave the draft undiscardable.
                    const latest = entry.base ? await readNote(file.path).catch(() => null) : null;
                    if (JSON.stringify(readDraft(entry.note.notebookId, file.path)) !== file.revision) throw new Error('Draft changed. Review it again.');
                    updateDraft(entry.note.notebookId, file.path, null);
                    if (latest && editingNote && sameNote(editingNote, entry.note)) setEditingNote(latest);
                  }
                  : undefined}
                commitFiles={remote ? commitWorkingNotes : undefined}
                repositoryHeading={repositoryHeading}
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
                  // Another server instance may still cache the head from before this commit.
                  await refreshWorkspace(true);
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
        </NoteLocationProvider>
      </WorkspaceLinks>
    </CompilationActionsProvider>
  );
};

export const App: React.FC = () => {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
};
