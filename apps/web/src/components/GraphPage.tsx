import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { buildNoteGraph, NoteGraphNode, NoteGraphLink } from '@github-notes/core/note-graph';
import type { NoteItem, NotebookConfig } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Select } from './Select.js';
import { RotateCcw, Filter, Eye, EyeOff, Search } from 'lucide-react';

export interface GraphPageProps {
  notebooks: NotebookConfig[];
  notes: NoteItem[];
  selectedNotebookId: string;
  onSelectNotebook?: (id: string) => void;
  onOpenNote: (note: NoteItem) => void;
  showHidden?: boolean;
}

export function GraphPage({
  notebooks,
  notes,
  selectedNotebookId,
  onSelectNotebook,
  onOpenNote,
  showHidden = false,
}: GraphPageProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);

  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showOrphans, setShowOrphans] = useState(true);
  const [hoverNode, setHoverNode] = useState<NoteGraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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

  // Collect all unique tags for filter
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const note of notes) {
      if (note.tags) {
        for (const tag of note.tags) {
          if (tag) set.add(tag);
        }
      }
    }
    return Array.from(set).sort();
  }, [notes]);

  // Compute graph data
  const rawGraphData = useMemo(() => {
    return buildNoteGraph(notes, {
      notebookId: selectedNotebookId === 'all' ? null : selectedNotebookId,
      includeHidden: showHidden,
      tag: selectedTag || null,
    });
  }, [notes, selectedNotebookId, showHidden, selectedTag]);

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

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      nodes = nodes.filter((n) => n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q));
      const filteredIds = new Set(nodes.map((n) => n.id));
      links = links.filter((l) => {
        const sourceId = typeof l.source === 'object' ? (l.source as { id: string }).id : l.source;
        const targetId = typeof l.target === 'object' ? (l.target as { id: string }).id : l.target;
        return filteredIds.has(sourceId) && filteredIds.has(targetId);
      });
    }

    return { nodes, links };
  }, [rawGraphData, showOrphans, searchQuery]);

  // Compute neighbor set for hover highlight
  const neighbors = useMemo(() => {
    const set = new Set<string>();
    if (!hoverNode) return set;
    set.add(hoverNode.id);
    for (const link of graphData.links) {
      const sourceId = typeof link.source === 'object' ? (link.source as { id: string }).id : link.source;
      const targetId = typeof link.target === 'object' ? (link.target as { id: string }).id : link.target;
      if (sourceId === hoverNode.id) set.add(targetId);
      if (targetId === hoverNode.id) set.add(sourceId);
    }
    return set;
  }, [hoverNode, graphData.links]);

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  // Custom node rendering on Canvas
  const paintNode = useCallback(
    (node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as NoteGraphNode & { x?: number; y?: number };
      if (n.x === undefined || n.y === undefined) return;

      const isHovered = hoverNode?.id === n.id;
      const isNeighbor = neighbors.has(n.id);
      const isDimmed = hoverNode && !isHovered && !isNeighbor;

      // Color mapping by note status
      let color = '#3b82f6'; // blue default
      if (n.status === 'done') color = '#22c55e'; // green
      else if (n.status === 'archived') color = '#64748b'; // slate
      else if (n.status === 'inbox') color = '#a855f7'; // purple
      else if (n.status === 'working') color = '#f59e0b'; // amber

      const radius = Math.max(3.5, Math.min(18, 3.5 + (n.inDegree || 0) * 2));

      ctx.save();
      ctx.globalAlpha = isDimmed ? 0.15 : 1.0;

      // Outer glow for hovered
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 4, 0, 2 * Math.PI, false);
        ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.15)';
        ctx.fill();
      }

      // Main circle
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = color;
      ctx.fill();

      // Border stroke
      ctx.lineWidth = isHovered ? 2 : 1;
      ctx.strokeStyle = isHovered ? '#ffffff' : isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.2)';
      ctx.stroke();

      // Label text
      const showLabel = isHovered || isNeighbor || globalScale > 1.3 || (n.inDegree || 0) > 1;
      if (showLabel) {
        const label = n.title;
        const fontSize = Math.max(11 / globalScale, 3.5);
        ctx.font = `${isHovered ? 'bold ' : ''}${fontSize}px system-ui, -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = isDimmed
          ? 'transparent'
          : isDark
          ? isHovered
            ? '#ffffff'
            : '#cbd5e1'
          : isHovered
          ? '#0f172a'
          : '#334155';
        ctx.fillText(label, n.x, n.y + radius + 3);
      }

      ctx.restore();
    },
    [hoverNode, neighbors, isDark]
  );

  const handleResetZoom = useCallback(() => {
    if (fgRef.current) {
      fgRef.current.zoomToFit(400, 40);
    }
  }, []);

  return (
    <div className="graph-page-container relative w-full h-full flex flex-col bg-transparent overflow-hidden" ref={containerRef}>
      {/* Top Floating Controls */}
      <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto bg-white/80 dark:bg-slate-900/80 backdrop-blur-md p-1.5 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-sm text-xs">
          {/* Notebook selector if multiple */}
          {notebooks.length > 1 && onSelectNotebook && (
            <Select
              aria-label="Notebook"
              value={selectedNotebookId}
              onValueChange={onSelectNotebook}
              options={[
                { value: 'all', label: t('graph.allNotebooks') },
                ...notebooks.map((nb) => ({ value: nb.id, label: nb.title })),
              ]}
              className="h-7 text-xs px-2"
            />
          )}

          {/* Quick search input */}
          <div className="relative flex items-center">
            <Search size={12} className="text-slate-400 absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('header.searchPlaceholder')}
              className="h-7 text-xs pl-6 pr-2 bg-transparent border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 w-28 md:w-36"
            />
          </div>

          {/* Tag filter */}
          {allTags.length > 0 && (
            <div className="flex items-center gap-1">
              <Filter size={13} className="text-slate-400 shrink-0" />
              <Select
                aria-label={t('graph.filterTag')}
                value={selectedTag || 'all'}
                onValueChange={(val) => setSelectedTag(val === 'all' ? null : val)}
                options={[
                  { value: 'all', label: t('graph.allTags') },
                  ...allTags.map((tag) => ({ value: tag, label: `#${tag}` })),
                ]}
                className="h-7 text-xs px-2"
              />
            </div>
          )}

          {/* Toggle Unlinked */}
          <button
            type="button"
            onClick={() => setShowOrphans((prev) => !prev)}
            title={t('graph.showOrphans')}
            aria-pressed={showOrphans}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition ${
              showOrphans
                ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 font-medium'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {showOrphans ? <Eye size={13} /> : <EyeOff size={13} />}
            <span>{t('graph.showOrphans')}</span>
          </button>

          {/* Reset Zoom */}
          <button
            type="button"
            onClick={handleResetZoom}
            title={t('graph.resetZoom')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 transition"
          >
            <RotateCcw size={13} />
            <span>{t('graph.resetZoom')}</span>
          </button>
        </div>

        {/* Stats Pill */}
        <div className="pointer-events-auto bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-sm text-xs text-slate-500 dark:text-slate-400 flex items-center gap-3">
          <span>
            <strong className="text-slate-800 dark:text-slate-200">{graphData.nodes.length}</strong> {t('graph.nodes')}
          </span>
          <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
          <span>
            <strong className="text-slate-800 dark:text-slate-200">{graphData.links.length}</strong> {t('graph.links')}
          </span>
        </div>
      </div>

      {/* Force Graph Canvas */}
      <div className="flex-1 w-full h-full">
        {dimensions.width > 0 && dimensions.height > 0 && (
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={(node: unknown, color: string, ctx: CanvasRenderingContext2D) => {
              const n = node as NoteGraphNode & { x?: number; y?: number };
              if (n.x === undefined || n.y === undefined) return;
              const radius = Math.max(3.5, Math.min(18, 3.5 + (n.inDegree || 0) * 2)) + 4;
              ctx.beginPath();
              ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI, false);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            linkColor={(link: unknown) => {
              const l = link as NoteGraphLink;
              const sourceId = typeof l.source === 'object' ? (l.source as { id: string }).id : l.source;
              const targetId = typeof l.target === 'object' ? (l.target as { id: string }).id : l.target;
              if (!hoverNode) {
                return isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)';
              }
              const isConnected = sourceId === hoverNode.id || targetId === hoverNode.id;
              return isConnected
                ? isDark
                  ? '#60a5fa'
                  : '#2563eb'
                : isDark
                ? 'rgba(255, 255, 255, 0.03)'
                : 'rgba(0, 0, 0, 0.03)';
            }}
            linkWidth={(link: unknown) => {
              const l = link as NoteGraphLink;
              const sourceId = typeof l.source === 'object' ? (l.source as { id: string }).id : l.source;
              const targetId = typeof l.target === 'object' ? (l.target as { id: string }).id : l.target;
              if (hoverNode && (sourceId === hoverNode.id || targetId === hoverNode.id)) {
                return 2.5;
              }
              return 1;
            }}
            linkDirectionalArrowLength={3.5}
            linkDirectionalArrowRelPos={1}
            onNodeHover={(node) => setHoverNode((node as NoteGraphNode) || null)}
            onNodeClick={(node) => {
              const n = node as NoteGraphNode;
              const target = notes.find((item) => item.path === n.id);
              if (target) onOpenNote(target);
            }}
            onBackgroundClick={() => setHoverNode(null)}
            cooldownTicks={100}
            onEngineStop={() => {
              if (fgRef.current) {
                fgRef.current.zoomToFit(400, 50);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
