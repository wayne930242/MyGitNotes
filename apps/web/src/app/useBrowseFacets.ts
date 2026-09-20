import { noteQueryStatuses } from '@mygitnotes/core/note-query';
import { parseWorkspaceRoute } from '../lib/routes.js';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useNoteFacets } from '../lib/use-note-queries.js';
import { useTagWorkspaceOperations } from '../app/useTagWorkspaceOperations.js';
import { mergeNotebookFacets, queryNotebookIds } from '../lib/note-facets.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  showHidden: boolean;
  config: WorkspaceState['config'];
  scopeNotebookId: string;
  selectedFolders: string[];
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
  route: ReturnType<typeof parseWorkspaceRoute>;
  canWrite: WorkspaceState['canWrite'];
  previewTagUsage: ReturnType<typeof useTagWorkspaceOperations>['previewTagUsage'];
  handleRenameTag: ReturnType<typeof useTagWorkspaceOperations>['handleRenameTag'];
  handleMergeTag: ReturnType<typeof useTagWorkspaceOperations>['handleMergeTag'];
  handleDeleteTag: ReturnType<typeof useTagWorkspaceOperations>['handleDeleteTag'];
}

export function useBrowseFacets({ showHidden, config, scopeNotebookId, selectedFolders, selectedNotebookId, route, canWrite, previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag }: Params) {
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

  return { facetsQuery, notebookFacets, notebookStatuses, newNoteStatuses, selectedTags, workspaceTagNames, noteTagActions, searchQuery, viewMode, folderless };
}
