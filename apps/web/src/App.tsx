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
import { useShortcutSurface } from './app/useShortcutSurface.js';
import { type NoteListItem, noteQueryStatuses } from '@mygitnotes/core/note-query';
import { listLocalDrafts } from './lib/storage.js';
import { useWorkspaceSync } from './lib/use-workspace-sync.js';
import { WorkspaceLinks } from './components/WorkspaceLinks.js';
import { ImageLightbox } from './components/ImageLightbox.js';
import { useNavigate } from 'react-router-dom';
import { notebookRoute, noteTrail, parseWorkspaceRoute } from './lib/routes.js';
import { readWorkingNotes, updateWorkingNote } from './lib/working-notes.js';
import { sameValue } from './lib/merge-note.js';
import React, { useMemo, useState } from 'react';
import { fetchGitStatus, readNote } from './lib/api.js';
import { NoteListSentinel } from './components/NoteListSentinel.js';
import type { NoteItem } from './lib/types.js';
import { useTagWorkspaceOperations } from './app/useTagWorkspaceOperations.js';
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
import type { NoteEditorSharedProps } from './components/NoteEditor.js';
import { NoteEditingProvider, useNoteEditorRegistry } from './lib/note-editing.js';
import { FocusArea } from './components/FocusArea.js';
import { FocusControls } from './components/FocusControls.js';
import { AddToFocusDialog } from './components/AddToFocusDialog.js';
import { FocusLaneTab } from './components/FocusLaneTab.js';
import { FocusList } from './components/FocusList.js';
import { BrowseDock, BrowseDockToggle, CARD_TWO_ROW_HEIGHT } from './components/BrowseDock.js';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
import { RightPanel } from './components/RightPanel.js';
import { FileManager, FileManagerDialog, FileMetadata } from './components/files/index.js';
import { AgentSystemView } from './components/AgentSystemView.js';
import { SettingsModal } from './components/SettingsModal.js';
import { CommitModal } from './components/CommitModal.js';
import { Breadcrumbs } from './components/Breadcrumbs.js';
import { FolderIndex } from './components/FolderIndex.js';
import { FolderLinks } from './components/FolderLinks.js';
import { I18nProvider, useTranslation } from './lib/i18n/index.js';
import { AlertTriangle, X } from 'lucide-react';
import { LoadingStatus } from './components/LoadingStatus.js';

const ScreenPage = React.lazy(() => import('./components/ScreenPage.js').then(module => ({ default: module.ScreenPage })));
const GraphPage = React.lazy(() => import('./components/GraphPage.js').then(module => ({ default: module.GraphPage })));

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

  const { selectedNotebookId, folders, sourceId, remote, canWrite, revision, setRevision, loadError, loading, actionError, setActionError, repoRoot, branch, config, gitStatus, setGitStatus, assets, setAssets, setWorkingNotes, workingScope, activeWorkingNotes, screen, focus: focusPage, documents, pendingDocuments, refreshWorkspace, stageWorkingNote } = useWorkspaceSync({ routeNotebook: editorRoute.notebook || undefined, onStageNote: note => setEditingNote(current => current?.path === note.path && !sameValue(current, note) ? note : current) });
  const refreshDocuments = async () => {
    await Promise.all(documents.map(document => document.refresh()));
  };
  const editorRegistry = useNoteEditorRegistry();

  const { queryClient, queryScope, invalidateNotes, refreshNotes, staleNotice, readCommittedNote, readNoteForChange } = useWorkspaceNotes({ sourceId, revision, activeWorkingNotes, remote, refreshWorkspace, workingScope, t });

  // Tag management: rename/merge/delete across the whole workspace, each a single commit
  // with a session-lifetime undo (kept in `tagOperations.history` until page reload).
  const { tagOperations, previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag, handleUndoTagOperation } = useTagWorkspaceOperations({ queryClient, queryScope, revision, remote, canWrite, t, invalidateNotes, setRevision, setActionError });

  const { editorNotebookId, returnTo, route, activeTab, sidebarGestureRef, selectedFolders, folderRoot, selectedFolder, scopeNotebookId, selectedStatus, showHidden } = useBrowseRoute({ editorRoute, config, location, queryState, setFolderReorder, setFileMetadataOpen, loading, loadError, filtersOpen, setFiltersOpen, selectedNotebookId });

  const { facetsQuery, notebookFacets, notebookStatuses, newNoteStatuses, selectedTags, workspaceTagNames, noteTagActions, searchQuery, viewMode, folderless } = useBrowseFacets({ showHidden, config, scopeNotebookId, selectedFolders, selectedNotebookId, route, canWrite, previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag });

  const { focusCapacity, notebookLanes, noteFocus, focusDisplay, focusNarrowView, setFocusNarrowView, addingToFocus, setAddingToFocus, activePaneNote, focusDocumentPanel, setDocumentContainer, showFocus } = useFocusPanes({ screen, selectedNotebookId, focusPage, remote, sourceId, repoRoot, activeTab, route, canWrite, editorRegistry, location, navigate, loading, editorRoute, config });

  const { changeFilters, clearFilters, changeAllNotebooks, setActiveTab, agentSystemRef, resourceNavigationBusy, setResourceNavigationBusy, notebookSwitchBusy, setSelectedNotebookId, setSelectedFolder, setViewMode } = useWorkspaceNavigation({ location, queryState, selectedFolders, setFilterQuery, navigate, route, activeTab, selectedNotebookId, folderRoot, viewMode, selectedFolder, config, editorRegistry, fileManagerRef, loading, editorRoute });

  const { commitRequest, isCommitOpen, setIsCommitOpen, openCommitModal, panelRemoteChanges, panelGetPreview } = useChangeDialog({ activeTab, agentSystemRef, remote, documents, setActionError, activeWorkingNotes, pendingDocuments, canWrite });

  // Aggregated tags across the workspace for autocomplete
  const availableTags = useMemo(() => Array.from(new Set(workspaceTagNames.map(tag => tag.trim()))).filter(Boolean).sort(), [workspaceTagNames]);

  const { deletedNotes, setDeletedNotes, undoToast, setUndoToast, handleDeleteNote, handleRestoreNote } = useDeletionUndo({ canWrite, revision, setRevision, setWorkingNotes, workingScope, editingNote, setEditingNote, navigate, returnTo, remote, setActionError, readNoteForChange, invalidateNotes, setGitStatus });

  useSourceReset({ sourceId, setEditingNote, setDeletedNotes });

  const { routedNote, routedCommitted, routedLoading, routeError } = useRoutedNote({ config, editorRoute, editorNotebookId, editingNote, loading, sourceId, setEditingNote });

  const { notebookRoot, folderIndex, baseQuery, listResult, displayedNotes, filterProps, immediateSubfolders, breadcrumbs, indexLookup } = useBrowseNotes({ scopeNotebookId, selectedFolders, selectedTags, route, searchQuery, selectedStatus, showHidden, config, selectedNotebookId, selectedFolder, activeTab, sortField, sortOrder, viewMode, facetsQuery, notebookFacets, folders, notebookStatuses, changeAllNotebooks, changeFilters, clearFilters, folderless, t });

  const { handleOpenNote } = useNoteActions({ activeTab, editorRegistry, setEditingNote, config, location, editorRoute, returnTo, selectedFolder, selectedNotebookId, navigate, setAssets });

  const { openInFocus, openFromBrowse, openLink, zoomFocusNote, addToFocus } = useFocusNoteNavigation({ noteFocus, selectedNotebookId, setFocusNarrowView, handleOpenNote, setAddingToFocus });

  const { handleSaveNote } = useNoteSaving({ canWrite, remote, workingScope, readCommittedNote, t, stageWorkingNote, selectedNotebookId, invalidateNotes, setEditingNote, setGitStatus, sourceId, branch });

  const { handleRestoreNoteFile, handleUpdateNoteStatus, handleOpenFolderIndex } = useNoteRestoration({ remote, workingScope, setWorkingNotes, setEditingNote, navigate, returnTo, invalidateNotes, setGitStatus, setActionError, handleSaveNote, readNoteForChange, selectedNotebookId, canWrite, t, config, queryClient, queryScope, stageWorkingNote, revision, location });

  // Create New Note dialog: its form state and the handlers that render or persist a new note draft.
  const { createError, isNewNoteOpen, setIsNewNoteOpen, newNoteTitle, setNewNoteTitle, newNoteStatus, setNewNoteStatus, newNoteFolder, setNewNoteFolder, newNoteTags, setNewNoteTags, newNoteTemplateId, setNewNoteTemplateId, newNoteFolders, newNoteTemplates, handleTemplateChange, openNewNote, handleCreateNewNote } = useNewNoteDialog({ config, selectedNotebookId, setSelectedNotebookId, folders, remote, canWrite, workingScope, queryClient, queryScope, stageWorkingNote, revision, invalidateNotes, setGitStatus, sourceId, newNoteStatuses, t, onCreated: handleOpenNote });

  const { commitWorkingNotes } = useWorkingNoteCommit({ workingScope, documents, sourceId, t, stageWorkingNote, setWorkingNotes, setRevision });

  // Assets are scoped to whichever notebook the open note (or the selected browse notebook) belongs to.
  const { handleUploadAsset, handleDeleteAsset, handleMoveAsset } = useAssetOperations({ editingNote, selectedNotebookId, remote, setAssets, setGitStatus });

  const { beforeFileChange, openFileManager, moveNoteAction, onFilesChanged, openFileIndex } = useFileNavigation({ editorRegistry, workingScope, documents, t, config, setFileDialog, setActionError, refreshWorkspace, refreshDocuments, editorRoute, editorNotebookId, setEditingNote, navigate, location, returnTo, setFileEditorRevision, selectedFolder, folderRoot, changeFilters, handleOpenFolderIndex });

  const noteEditorOpen = (Boolean(routedNote) || routedLoading) && !routeError;

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
      {actionError && <p role='alert' className='mb-3 text-sm text-danger'>{actionError}</p>}
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
          <ListView
            showMobileSort={false}
            compact={docked}
            focusMode={browseFocusMode}
            statuses={notebookStatuses}
            readOnly={!canWrite}
            canDelete={canWrite}
            confirmDelete={remote}
            notes={displayedNotes}
            loading={listResult.loading}
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
          <CardView strip={docked && dockHeight < CARD_TWO_ROW_HEIGHT} focusMode={browseFocusMode} statuses={notebookStatuses} readOnly={!canWrite} canDelete={canWrite} confirmDelete={remote} notes={displayedNotes} loading={listResult.loading} uncommitted={listResult.uncommitted} hasFolderEntries={immediateSubfolders.length > 0 || Boolean(folderIndex)} onOpenNote={note => void openFromBrowse(note)} onDeleteNote={handleDeleteNote} onMoveNote={moveNoteAction} onNewNote={() => openNewNote()} onUpdateNoteStatus={handleUpdateNoteStatus} tagActions={noteTagActions} />
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
                  <React.Suspense fallback={<LoadingStatus className='p-8'>{t('screen.loading')}</LoadingStatus>}>
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
                    <SettingsModal config={config} branch={branch} repoRoot={remote ? sourceId.replace(/^(github|gitlab):/, '') : repoRoot} local={!remote} canWrite={canWrite} revision={revision} onRevision={setRevision} accountSettings={<AgentAccessSettings local={!remote} />} onRefreshWorkspace={refreshWorkspace} currentTheme={currentTheme} onSelectTheme={handleSelectTheme} />
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
                // The draft lives in this browser, so discarding it is a local delete. Reading the remote
                // only refreshes an open editor, and a draft is often blocked precisely because that read
                // fails, which used to leave the draft undiscardable.
                const latest = entry.base ? await readNote(file.path).catch(() => null) : null;
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
