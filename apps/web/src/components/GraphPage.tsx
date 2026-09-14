import { filterNotes, selectFilteredGraph } from '@github-notes/core/note-filters';
import { isNoteHidden } from '@github-notes/core/note-status';
import { WorkspaceFilters, type WorkspaceFiltersProps } from './WorkspaceFilters.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { buildNoteGraph, NoteGraphNode, NoteGraphLink } from '@github-notes/core/note-graph';
import type { NoteItem, NotebookConfig } from '../lib/types.js';
import { GRAPH_APPEARANCE_KEY, graphColorGroup, graphColorGroups, readGraphAppearance, type GraphAppearance } from '../lib/graph-colors.js';

import { GraphControls } from './graph/GraphControls.js';
import { GraphPreview } from './graph/GraphPreview.js';
import { nodeRadius, useGraphPainting } from './graph/useGraphPainting.js';
import { useGraphMinimap } from './graph/useGraphMinimap.js';
import { graphFocus, toggleGraphFocus } from '../lib/graph-focus.js';
import { useGraphRelaxation } from './graph/useGraphRelaxation.js';
import { createInitialGraphFit } from '../lib/graph-initial-fit.js';

const nodeValue = (node: unknown) => Math.pow(nodeRadius(node as NoteGraphNode) / 4, 2);

export interface GraphPageProps {
  notebooks: NotebookConfig[];
  notes: NoteItem[];
  filters: WorkspaceFiltersProps;
  onOpenNote: (note: NoteItem) => void;
}

export function GraphPage({
  notebooks,
  notes,
  filters,
  onOpenNote,
}: GraphPageProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [previewTop, setPreviewTop] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);

  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [appearance, setAppearance] = useState(readGraphAppearance);
  const [appearanceSaveError, setAppearanceSaveError] = useState(false);
  const colorGroups = useMemo(() => graphColorGroups(notes.map(note => ({ id: note.path, notebookId: note.notebookId, status: note.status })), notebooks, appearance), [notes, notebooks, appearance]);
  const groupColors = useMemo(() => new Map(colorGroups.map(group => [group.key, group.color])), [colorGroups]);
  const nodeColor = useCallback((node: NoteGraphNode) => groupColors.get(graphColorGroup(node, notebooks, appearance.mode).key) || '#94a3b8', [groupColors, notebooks, appearance.mode]);
  const changeAppearance = (next: GraphAppearance) => {
    setAppearance(next);
    try { localStorage.setItem(GRAPH_APPEARANCE_KEY, JSON.stringify(next)); setAppearanceSaveError(false); }
    catch { setAppearanceSaveError(true); }
  };
  const [showOrphans, setShowOrphans] = useState(true);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const suppressedHoverId = useRef<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const previewNote = notes.find(note => note.path === previewPath);

  // Follow wrapped controls at every viewport size and browser zoom level.
  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const measure = () => setPreviewTop(controls.offsetTop + controls.offsetHeight + 12);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    return () => observer.disconnect();
  }, []);

  // Measure container dimensions
  useEffect(() => {
    if (!containerRef.current) return;
    const updateDimensions = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        if (clientWidth > 0 && clientHeight > 0) {
          setDimensions({ width: clientWidth, height: clientHeight });
        }
      }
    };
    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const rawGraphData = useMemo(() => {
    const eligible = notes.filter(note => filters.value.showHidden || !isNoteHidden({ ...note.metadata, status: note.status }));
    const graph = buildNoteGraph(eligible, { includeHidden: true });
    const matches = new Set(filterNotes(notes, filters.value).map(note => note.path));
    return selectFilteredGraph(graph, matches, filters.neighbors);
  }, [notes, filters.value, filters.neighbors]);

  // Filter orphans if disabled
  const graphData = useMemo(() => {
    let nodes = rawGraphData.nodes;
    let links = rawGraphData.links;

    if (!showOrphans) {
      const connectedIds = new Set<string>();
      for (const link of links) {
        const sourceId = typeof link.source === 'object' ? (link.source as { id: string }).id : link.source;
        const targetId = typeof link.target === 'object' ? (link.target as { id: string }).id : link.target;
        connectedIds.add(sourceId);
        connectedIds.add(targetId);
      }
      nodes = nodes.filter((n) => connectedIds.has(n.id));
    }

    return { nodes, links };
  }, [rawGraphData, showOrphans]);

  const visibleColorGroups = useMemo(() => {
    const keys = new Set(graphData.nodes.map(node => graphColorGroup(node, notebooks, appearance.mode).key));
    return colorGroups.filter(group => keys.has(group.key));
  }, [graphData.nodes, notebooks, appearance.mode, colorGroups]);

  useEffect(() => {
    if (previewPath && !graphData.nodes.some(node => node.id === previewPath)) setPreviewPath(null);
  }, [graphData.nodes, previewPath]);

  const transientHoverId = previewPath ? null : hoverId;
  const { selected: focusNode, highlighted: highlightedNode, neighbors } = useMemo(
    () => graphFocus(graphData.nodes, graphData.links, previewPath, graphData.nodes.find(node => node.id === transientHoverId) || null),
    [graphData.nodes, graphData.links, previewPath, transientHoverId],
  );

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const highlightedId = highlightedNode?.id;
  const { displayGraph, isAnimating } = useGraphRelaxation(graphData, highlightedId, neighbors, () => fgRef.current?.zoom() || 1);

  const handleResetZoom = useCallback(() => {
    const graph = fgRef.current;
    const bounds = graph?.getGraphBbox();
    if (!bounds || !graphData.nodes.length) return false;
    const padding = Math.min(110, dimensions.width * 0.2, dimensions.height * 0.2);
    const scale = Math.min(2.4,
      (dimensions.width - padding * 2) / Math.max(1, bounds.x[1] - bounds.x[0]),
      (dimensions.height - padding * 2) / Math.max(1, bounds.y[1] - bounds.y[0]));
    graph.centerAt((bounds.x[0] + bounds.x[1]) / 2, (bounds.y[0] + bounds.y[1]) / 2, 400);
    graph.zoom(scale, 400);
    return true;
  }, [dimensions, graphData.nodes.length]);

  const resetRef = useRef(handleResetZoom);
  resetRef.current = handleResetZoom;
  const [initialFit] = useState(() => createInitialGraphFit(() => resetRef.current()));
  const resetView = () => { initialFit.cancel(); handleResetZoom(); };
  const { paintNode, paintLabels } = useGraphPainting({ nodes: displayGraph.nodes, hoverNode: highlightedNode, focusNodeId: focusNode?.id, neighbors, isDark, nodeColor });
  const { paintMinimap, minimap } = useGraphMinimap({ graphRef: fgRef, graphData: displayGraph, dimensions, isDark, nodeColor, onClearHover: () => setHoverId(null), onReset: resetView, onNavigate: initialFit.cancel });

  return (
    <div className="graph-page-container relative w-full h-full flex flex-col bg-transparent overflow-hidden" ref={containerRef}>
      <GraphControls controlsRef={controlsRef} filterPanel={<WorkspaceFilters {...filters} compact />} appearance={appearance} onAppearanceChange={changeAppearance} visibleColorGroups={visibleColorGroups} appearanceSaveError={appearanceSaveError} showOrphans={showOrphans} onToggleOrphans={() => setShowOrphans(value => !value)} onReset={resetView} nodeCount={graphData.nodes.length} linkCount={graphData.links.length} matchingCount={filters.count} />

      {/* Force Graph Canvas */}
      <div className="flex-1 w-full h-full" onPointerDownCapture={initialFit.cancel} onWheelCapture={initialFit.cancel}>
        {dimensions.width > 0 && dimensions.height > 0 && (
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={displayGraph}
            autoPauseRedraw={!isAnimating}
            nodeCanvasObject={paintNode}
            onRenderFramePost={(ctx, scale) => { paintLabels(ctx, scale); paintMinimap(); }}
            nodeVal={nodeValue}
            nodePointerAreaPaint={(node: unknown, color: string, ctx: CanvasRenderingContext2D) => {
              const n = node as NoteGraphNode & { x?: number; y?: number };
              if (n.x === undefined || n.y === undefined) return;
              const radius = nodeRadius(n) + 2;
              ctx.beginPath();
              ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI, false);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            linkColor={(link: unknown) => {
              const l = link as NoteGraphLink;
              const sourceId = typeof l.source === 'object' ? (l.source as { id: string }).id : l.source;
              const targetId = typeof l.target === 'object' ? (l.target as { id: string }).id : l.target;
              if (!highlightedNode) {
                return isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)';
              }
              const isConnected = sourceId === highlightedNode.id || targetId === highlightedNode.id;
              return isConnected
                ? isDark
                  ? '#94adc7'
                  : '#8b9fb5'
                : isDark
                ? 'rgba(255, 255, 255, 0.03)'
                : 'rgba(0, 0, 0, 0.03)';
            }}
            linkWidth={(link: unknown) => {
              const l = link as NoteGraphLink;
              const sourceId = typeof l.source === 'object' ? (l.source as { id: string }).id : l.source;
              const targetId = typeof l.target === 'object' ? (l.target as { id: string }).id : l.target;
              if (highlightedNode && (sourceId === highlightedNode.id || targetId === highlightedNode.id)) {
                return 1.2;
              }
              return 0.6;
            }}
            linkDirectionalArrowLength={2.5}
            linkDirectionalArrowRelPos={0.8}
            onNodeHover={(node) => {
              const id = node ? (node as NoteGraphNode).id : null;
              if (id !== suppressedHoverId.current) suppressedHoverId.current = null;
              setHoverId(id === suppressedHoverId.current ? null : id);
            }}
            onNodeClick={(node) => {
              const n = node as NoteGraphNode;
              const target = notes.find((item) => item.path === n.id);
              if (target) {
                const next = toggleGraphFocus(previewPath, target.path);
                suppressedHoverId.current = next === null ? target.path : null;
                setHoverId(null);
                setPreviewPath(next);
              }
            }}
            onBackgroundClick={() => setHoverId(null)}
            cooldownTicks={100}
            onEngineStop={initialFit.onEngineStop}
            onNodeDrag={initialFit.cancel}
          />
        )}
      </div>
      {!graphData.nodes.length && <p role="status" className="absolute inset-x-4 top-1/2 text-center text-sm text-slate-500 pointer-events-none">{t('filters.graphEmpty')}</p>}
      {previewNote && <GraphPreview note={previewNote} notebookTitle={notebooks.find(nb => nb.id === previewNote.notebookId)?.title} top={previewTop} onClose={() => { setPreviewPath(null); setHoverId(null); }} onClearHover={() => setHoverId(null)} onOpenNote={onOpenNote} />}
      {minimap}

    </div>
  );
}
