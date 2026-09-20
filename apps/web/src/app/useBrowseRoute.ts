import { type FilterQuery } from '../lib/filter-query.js';
import { legacyFolderPaths } from '@mygitnotes/core/note-filters';
import { useLocation } from 'react-router-dom';
import { noteReturnRoute, parseWorkspaceRoute } from '../lib/routes.js';
import React, { useEffect, useMemo } from 'react';
import { useSidebarSwipe } from '../lib/use-sidebar-swipe.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
  config: WorkspaceState['config'];
  location: ReturnType<typeof useLocation>;
  queryState: FilterQuery;
  setFolderReorder: React.Dispatch<React.SetStateAction<boolean>>;
  setFileMetadataOpen: React.Dispatch<React.SetStateAction<boolean>>;
  loading: WorkspaceState['loading'];
  loadError: WorkspaceState['loadError'];
  filtersOpen: boolean;
  setFiltersOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
}

export function useBrowseRoute({ editorRoute, config, location, queryState, setFolderReorder, setFileMetadataOpen, loading, loadError, filtersOpen, setFiltersOpen, selectedNotebookId }: Params) {
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

  return { editorNotebookId, returnTo, route, activeTab, sidebarGestureRef, selectedFolders, folderRoot, selectedFolder, scopeNotebookId, selectedStatus, showHidden };
}
