import { useQueryStates } from 'nuqs';
import { filterParsers, type FilterQuery, writeFilterQuery } from '../lib/filter-query.js';
import { legacyFolderPaths } from '@mygitnotes/core/note-filters';
import type { FilterControls } from '../lib/filter-controls.js';
import { useLocation, useNavigate } from 'react-router-dom';
import { legacyAllNotebooksRoute, notebookRoute, parseWorkspaceRoute, WorkspaceTab } from '../lib/routes.js';
import React, { useEffect, useRef, useState } from 'react';
import type { ViewMode } from '../lib/types.js';
import { useNoteEditorRegistry } from '../lib/note-editing.js';
import { type FileManagerHandle } from '../components/FileManager.js';
import { type AgentSystemHandle } from '../components/AgentSystemView.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  location: ReturnType<typeof useLocation>;
  queryState: FilterQuery;
  selectedFolders: string[];
  setFilterQuery: ReturnType<typeof useQueryStates<typeof filterParsers>>[1];
  navigate: ReturnType<typeof useNavigate>;
  route: ReturnType<typeof parseWorkspaceRoute>;
  activeTab: WorkspaceTab;
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
  folderRoot: string | undefined;
  viewMode: ViewMode;
  selectedFolder: string | null;
  config: WorkspaceState['config'];
  editorRegistry: ReturnType<typeof useNoteEditorRegistry>;
  fileManagerRef: React.RefObject<FileManagerHandle>;
  loading: WorkspaceState['loading'];
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
}

export function useWorkspaceNavigation({ location, queryState, selectedFolders, setFilterQuery, navigate, route, activeTab, selectedNotebookId, folderRoot, viewMode, selectedFolder, config, editorRegistry, fileManagerRef, loading, editorRoute }: Params) {
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

  return { changeFilters, clearFilters, changeAllNotebooks, setActiveTab, agentSystemRef, resourceNavigationBusy, setResourceNavigationBusy, notebookSwitchBusy, setSelectedNotebookId, setSelectedFolder, setViewMode };
}
