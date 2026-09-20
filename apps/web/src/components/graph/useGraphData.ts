import { useCallback, useMemo } from 'react';
import type { NoteGraphNode } from '@mygitnotes/core/note-graph';
import { selectFilteredGraph } from '@mygitnotes/core/note-filters';
import { type GraphLayout, type ScreenRow } from '@mygitnotes/core/screen-page';
import type { NoteQuery } from '@mygitnotes/core/note-query';
import { useNoteGraph, useNotePaths } from '../../lib/use-note-queries.js';
import { overlayGraphDrafts } from '../../lib/draft-overlay.js';
import { useLanePaths } from '../../lib/screen-queries.js';
import { initializeGraphLayout } from '../../lib/graph-initial-layout.js';
import { type GraphAppearance, graphColorGroup, graphColorGroups } from '../../lib/graph-colors.js';
import { themeColor } from '../../lib/theme-color.js';
import type { MutableRefObject } from 'react';
import type { GraphPageProps, LayoutNode } from './types.js';
import type { useGraphNoteSessions } from './useGraphNoteSessions.js';
export function useGraphData({ notebooks, filters, lane, activeLane, rows, laneIds, laneKey, showOutside, sessions, only, layout, showOrphans, positions, appearance }: Pick<GraphPageProps, 'notebooks' | 'filters' | 'lane'> & { activeLane?: ScreenRow; rows: ScreenRow[]; laneIds: string[]; laneKey: string; showOutside: boolean; sessions: ReturnType<typeof useGraphNoteSessions>['sessions']; only: string[] | null; layout: GraphLayout; showOrphans: boolean; positions: MutableRefObject<Map<string, LayoutNode>>; appearance: GraphAppearance; }) {
  const graphSource = useNoteGraph();
  const scopeNotebook = activeLane?.notebookId || filters?.value.notebookId || 'all';
  /* eslint-disable react-hooks/exhaustive-deps -- Explicit lane, filter, viewport and layout keys control canvas work; object identity alone must not reset it. */
  const filterQuery = useMemo<Partial<NoteQuery>>(() => (filters ? { notebookId: scopeNotebook, folders: filters.value.folders, descendants: filters.value.descendants, tags: filters.value.tags, tagMode: filters.value.tagMode, status: filters.value.status, showHidden: filters.value.showHidden, q: filters.value.q } : { notebookId: scopeNotebook, showHidden: false }), [filters?.value, scopeNotebook]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const matchingPaths = useNotePaths(filterQuery);
  const visiblePaths = useNotePaths(filters?.value.showHidden ? null : { notebookId: scopeNotebook, showHidden: false });
  /* eslint-disable react-hooks/exhaustive-deps -- Explicit lane, filter, viewport and layout keys control canvas work; object identity alone must not reset it. */
  const shownLanes = useMemo(() => [...rows.filter(row => laneIds.includes(row.id)), ...(lane ? [lane] : [])], [rows, laneKey, lane]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const lanePaths = useLanePaths(shownLanes);
  const editingDrafts = useMemo(() =>
    [...sessions].flatMap(([path, session]) => {
      const node = graphSource.graph?.nodes.find(node => node.id === path);
      return session.dirty && node ? [{ path, notebookId: node.notebookId, title: session.title || node.title, status: node.status, tags: node.tags, content: session.content }] : [];
    }), [sessions, graphSource.graph]);
  const graph = useMemo(() => (graphSource.graph ? overlayGraphDrafts(graphSource.graph, editingDrafts) : { nodes: [], links: [] }), [graphSource.graph, editingDrafts]);
  /* eslint-disable react-hooks/exhaustive-deps -- Explicit lane, filter, viewport and layout keys control canvas work; object identity alone must not reset it. */
  const matching = useMemo(() => {
    let matches = matchingPaths.paths;
    if (laneIds.length && !showOutside) {
      const included = new Set(shownLanes.flatMap(row => lanePaths.paths.get(row.id) || []));
      matches = matches.filter(path => included.has(path));
    }
    if (only) matches = matches.filter(path => only.includes(path));
    return matches;
  }, [matchingPaths.paths, laneKey, shownLanes, only, showOutside, lanePaths.paths]);
  /* eslint-enable react-hooks/exhaustive-deps */
  /* eslint-disable react-hooks/exhaustive-deps -- Explicit lane, filter, viewport and layout keys control canvas work; object identity alone must not reset it. */
  const laneMembers = useMemo(() => new Set(rows.filter(row => laneIds.includes(row.id)).flatMap(row => lanePaths.paths.get(row.id) || [])), [rows, laneKey, lanePaths.paths]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const expanded = useMemo(() => new Set(layout.nodes.filter(node => node.expanded).map(node => node.path)), [layout]);
  /* eslint-disable react/refs -- The force-graph adapter keeps imperative graph state and current layout in refs for canvas callbacks. */
  /* eslint-disable react-hooks/exhaustive-deps -- Explicit lane, filter, viewport and layout keys control canvas work; object identity alone must not reset it. */
  const graphData = useMemo(() => {
    const eligible = new Set(filters?.value.showHidden ? graph.nodes.map(node => node.id) : visiblePaths.paths);
    const nodes = graph.nodes.filter(node => eligible.has(node.id) && (!activeLane || node.notebookId === activeLane.notebookId));
    const ids = new Set(nodes.map(node => node.id));
    const full = { nodes, links: graph.links.filter(link => ids.has(link.source) && ids.has(link.target)) };
    const graphResult = selectFilteredGraph(full, new Set(matching), filters?.neighbors || false);
    const graph2 = graphResult;
    const connected = new Set(graph2.links.flatMap(link => [link.source, link.target]));
    const visible = graph2.nodes.filter(node => showOrphans || connected.has(node.id));
    const saved = new Map([...positions.current, ...layout.nodes.map(node => [node.path, node] as const)]);
    const initial = initializeGraphLayout({ nodes: visible, links: graph2.links }, { nodes: [...saved.values()] });
    const initialized = new Map(initial.nodes.map(node => [node.path, node]));
    for (const node of initial.nodes) positions.current.set(node.path, node);
    return {
      links: graph2.links,
      nodes: visible.map(node => {
        const position = initialized.get(node.id)!;
        return { ...node, x: position.x, y: position.y, fx: position.x, fy: position.y };
      }),
    };
  }, [graph, matching, visiblePaths.paths, layout, showOrphans, filters?.neighbors, filters?.value.showHidden, activeLane?.notebookId]);
  /* eslint-enable react-hooks/exhaustive-deps */
  /* eslint-enable react/refs */
  const colors = useMemo(() => graphColorGroups(graphData.nodes, notebooks, appearance), [graphData, notebooks, appearance]);
  const nodeColor = useCallback((node: NoteGraphNode) => themeColor(colors.find(group => group.key === graphColorGroup(node, notebooks, appearance.mode).key)?.color || 'var(--color-muted)'), [colors, notebooks, appearance]);

  return { graphSource, scopeNotebook, filterQuery, matchingPaths, visiblePaths, shownLanes, lanePaths, editingDrafts, graph, matching, laneMembers, expanded, graphData, colors, nodeColor };
}
