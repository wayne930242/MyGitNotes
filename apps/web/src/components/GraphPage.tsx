import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { buildNoteGraph, NoteGraphNode, NoteGraphLink } from '@github-notes/core/note-graph';
import type { NoteItem, NotebookConfig } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Select } from './Select.js';
import { RotateCcw, Filter, Eye, EyeOff, Search, X, Maximize2 } from 'lucide-react';
import { renderNote } from '../lib/markdown.js';

const nodeRadius = (node: NoteGraphNode) => 3.5 + Math.min(5, Math.sqrt(node.inDegree || 0) * 1.5);
type PositionedNode = NoteGraphNode & { x?: number; y?: number };

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
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const minimapTransform = useRef({ x: 0, y: 0, scale: 1 });
  const minimapViewport = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const minimapGesture = useRef<{
    pointerId: number; startX: number; startY: number; inside: boolean; moved: boolean;
    centerX: number; centerY: number; scale: number; offsetX: number; offsetY: number;
  } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);

  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showOrphans, setShowOrphans] = useState(true);
  const [hoverNode, setHoverNode] = useState<NoteGraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const previewCloseRef = useRef<HTMLButtonElement>(null);
  const previewNote = notes.find(note => note.path === previewPath);
  const previewHtml = useMemo(() => previewNote ? renderNote(previewNote.content, previewNote.path) : '', [previewNote?.content, previewNote?.path]);
  useEffect(() => { if (previewPath) previewCloseRef.current?.focus({ preventScroll: true }); }, [previewPath]);

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

  useEffect(() => {
    if (previewPath && !graphData.nodes.some(node => node.id === previewPath)) setPreviewPath(null);
  }, [graphData.nodes, previewPath]);

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
      let color = '#7895b5';
      if (n.status === 'done') color = '#7fa58d';
      else if (n.status === 'archived') color = '#94a3b8';
      else if (n.status === 'inbox') color = '#a799be';
      else if (n.status === 'working') color = '#c5a16b';

      const radius = nodeRadius(n);

      ctx.save();
      ctx.globalAlpha = isDimmed ? 0.25 : 1.0;

      // Outer glow for hovered
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 4 / globalScale, 0, 2 * Math.PI, false);
        ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(120, 149, 181, 0.16)';
        ctx.fill();
      }

      // Main circle
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = color;
      ctx.fill();

      // Border stroke
      ctx.lineWidth = 1.5 / globalScale;
      ctx.strokeStyle = isDark ? '#1e293b' : '#ffffff';
      ctx.stroke();

      ctx.restore();
    },
    [hoverNode, neighbors, isDark]
  );

  // Lay labels out after the nodes, in screen-sized units, with priority for focus.
  const paintLabels = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const nodes = (graphData.nodes as PositionedNode[]).filter(
      (n): n is PositionedNode & { x: number; y: number } => n.x !== undefined && n.y !== undefined
    );
    type Box = { x: number; y: number; w: number; h: number };
    const occupied: Box[] = nodes.map(n => {
      const r = nodeRadius(n) + 5 / scale;
      return { x: n.x - r, y: n.y - r, w: r * 2, h: r * 2 };
    });
    const priority = (n: NoteGraphNode) => hoverNode?.id === n.id ? 1e6 : neighbors.has(n.id) ? 1e5 : n.inDegree || 0;
    const sorted = [...nodes].sort((a, b) => priority(b) - priority(a) || a.id.localeCompare(b.id));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const n of sorted) {
      if (hoverNode && !neighbors.has(n.id)) continue;
      if (!hoverNode && scale < 0.8 && !n.inDegree) continue;
      const focused = hoverNode?.id === n.id;
      ctx.font = `${focused ? 600 : 400} ${12 / scale}px system-ui, -apple-system, sans-serif`;
      const lines: string[] = [];
      let line = '';
      // Tokenize words and individual CJK characters for natural mixed-language wrapping.
      for (const token of n.title.match(/[a-zA-Z0-9_.-]+|\s+|[^\s]/gu) || []) {
        if (line && ctx.measureText(line + token).width > 168 / scale) {
          lines.push(line.trim());
          line = token.trimStart();
        } else line += token;
      }
      if (line) lines.push(line.trim());
      const visible = lines.slice(0, focused ? 4 : 2);
      if (lines.length > visible.length) visible[visible.length - 1] += '…';
      // Bound even a single long filename to the available label width.
      for (let i = 0; i < visible.length; i++) {
        while (ctx.measureText(visible[i]).width > 176 / scale && visible[i].length > 1) {
          visible[i] = visible[i].replace(/…$/, '').slice(0, -1) + '…';
        }
      }
      const w = Math.max(...visible.map(l => ctx.measureText(l).width), 0) + 12 / scale;
      const h = (visible.length * 17 + 6) / scale;
      const gap = nodeRadius(n) + 9 / scale;
      const candidates: Box[] = [
        { x: n.x - w / 2, y: n.y + gap, w, h },
        { x: n.x - w / 2, y: n.y - gap - h, w, h },
        { x: n.x + gap, y: n.y - h / 2, w, h },
        { x: n.x - gap - w, y: n.y - h / 2, w, h },
      ];
      const box = candidates.find(b => !occupied.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y));
      if (!box) continue;
      occupied.push(box);
      ctx.fillStyle = isDark ? 'rgba(15,23,42,0.9)' : 'rgba(248,250,252,0.94)';
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, w, h, 4 / scale);
      ctx.fill();
      ctx.fillStyle = isDark ? focused ? '#f1f5f9' : '#cbd5e1' : focused ? '#334155' : '#64748b';
      visible.forEach((text, i) => ctx.fillText(text, box.x + w / 2, box.y + (11.5 + i * 17) / scale));
    }
    ctx.restore();
  }, [graphData.nodes, hoverNode, neighbors, isDark]);

  const paintMinimap = useCallback(() => {
    const canvas = minimapRef.current;
    const ctx = canvas?.getContext('2d');
    const graph = fgRef.current;
    if (!canvas || !ctx || !graph) return;
    const width = 176;
    const height = 112;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    minimapViewport.current = null;
    const nodes = (graphData.nodes as PositionedNode[]).filter(
      (n): n is PositionedNode & { x: number; y: number } => n.x !== undefined && n.y !== undefined
    );
    if (!nodes.length) return;
    const left = Math.min(...nodes.map(n => n.x)) - 20;
    const top = Math.min(...nodes.map(n => n.y)) - 20;
    const right = Math.max(...nodes.map(n => n.x)) + 20;
    const bottom = Math.max(...nodes.map(n => n.y)) + 20;
    const scale = Math.min((width - 24) / (right - left), (height - 24) / (bottom - top));
    const x = (width - (right - left) * scale) / 2 - left * scale;
    const y = (height - (bottom - top) * scale) / 2 - top * scale;
    minimapTransform.current = { x, y, scale };
    const byId = new Map(nodes.map(n => [n.id, n]));
    ctx.strokeStyle = isDark ? '#475569' : '#d1d9e2';
    ctx.lineWidth = 0.75;
    for (const link of graphData.links) {
      const source = typeof link.source === 'object' ? link.source as PositionedNode : byId.get(link.source);
      const target = typeof link.target === 'object' ? link.target as PositionedNode : byId.get(link.target);
      if (source?.x === undefined || source.y === undefined || target?.x === undefined || target.y === undefined) continue;
      ctx.beginPath();
      ctx.moveTo(source.x * scale + x, source.y * scale + y);
      ctx.lineTo(target.x * scale + x, target.y * scale + y);
      ctx.stroke();
    }
    for (const n of nodes) {
      ctx.beginPath();
      ctx.arc(n.x * scale + x, n.y * scale + y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = hoverNode?.id === n.id ? '#6366f1' : '#8a9eab';
      ctx.fill();
    }
    const start = graph.screen2GraphCoords(0, 0);
    const end = graph.screen2GraphCoords(dimensions.width, dimensions.height);
    const vx = Math.max(1, start.x * scale + x);
    const vy = Math.max(1, start.y * scale + y);
    const vw = Math.max(0, Math.min(width - 1, end.x * scale + x) - vx);
    const vh = Math.max(0, Math.min(height - 1, end.y * scale + y) - vy);
    minimapViewport.current = { x: vx, y: vy, w: vw, h: vh };
    ctx.fillStyle = 'rgba(120,149,181,0.08)';
    ctx.strokeStyle = isDark ? '#94adc7' : '#8b9fb5';
    ctx.lineWidth = 1;
    ctx.fillRect(vx, vy, vw, vh);
    ctx.strokeRect(vx, vy, vw, vh);
  }, [graphData, dimensions, hoverNode, isDark]);

  const handleResetZoom = useCallback(() => {
    const graph = fgRef.current;
    const bounds = graph?.getGraphBbox();
    if (!bounds) return;
    const padding = Math.min(110, dimensions.width * 0.2, dimensions.height * 0.2);
    const scale = Math.min(2.4,
      (dimensions.width - padding * 2) / Math.max(1, bounds.x[1] - bounds.x[0]),
      (dimensions.height - padding * 2) / Math.max(1, bounds.y[1] - bounds.y[0]));
    graph.centerAt((bounds.x[0] + bounds.x[1]) / 2, (bounds.y[0] + bounds.y[1]) / 2, 400);
    graph.zoom(scale, 400);
  }, [dimensions]);

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
            onRenderFramePost={(ctx, scale) => { paintLabels(ctx, scale); paintMinimap(); }}
            nodeVal={(node) => Math.pow(nodeRadius(node as NoteGraphNode) / 4, 2)}
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
              if (!hoverNode) {
                return isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)';
              }
              const isConnected = sourceId === hoverNode.id || targetId === hoverNode.id;
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
              if (hoverNode && (sourceId === hoverNode.id || targetId === hoverNode.id)) {
                return 1.2;
              }
              return 0.6;
            }}
            linkDirectionalArrowLength={2.5}
            linkDirectionalArrowRelPos={0.8}
            onNodeHover={(node) => setHoverNode((node as NoteGraphNode) || null)}
            onNodeClick={(node) => {
              const n = node as NoteGraphNode;
              const target = notes.find((item) => item.path === n.id);
              if (target) setPreviewPath(target.path);
            }}
            onBackgroundClick={() => { setHoverNode(null); setPreviewPath(null); }}
            cooldownTicks={100}
            onEngineStop={handleResetZoom}
          />
        )}
      </div>
      {previewNote && (
        <aside
          aria-label={t('graph.preview')}
          onMouseEnter={() => setHoverNode(null)}
          className="absolute top-20 left-4 z-20 flex max-h-[calc(100%-6rem)] w-80 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-xl shadow-slate-900/10 backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95"
          onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setPreviewPath(null); } }}
        >
          <header className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-[10px] text-slate-400">{t('graph.preview')}</p>
              <h2 className="text-sm font-medium leading-6 text-slate-800 dark:text-slate-100 break-words">{previewNote.title}</h2>
            </div>
            <button ref={previewCloseRef} type="button" className="ui-icon-button shrink-0" aria-label={t('common.close')} onClick={() => setPreviewPath(null)}><X size={15} /></button>
          </header>
          <div className="min-h-0 overflow-y-auto px-4 py-3">
            <div className="prose-custom screen-markdown" data-markdown-view dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
            <span className="truncate text-[11px] text-slate-400">{notebooks.find(nb => nb.id === previewNote.notebookId)?.title}</span>
            <button type="button" className="ui-button shrink-0" onClick={() => onOpenNote(previewNote)}><Maximize2 size={13} />{t('graph.openEditor')}</button>
          </footer>
        </aside>
      )}
      <button
        type="button"
        aria-label={t('graph.minimap')}
        title={t('graph.minimapHint')}
        onMouseEnter={() => setHoverNode(null)}
        className="absolute bottom-4 right-4 overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        onClick={(event) => {
          if (!fgRef.current || !graphData.nodes.length) return;
          if (event.detail === 0) handleResetZoom();
        }}
      >
        <canvas
          ref={minimapRef}
          style={{ width: 176, height: 112, touchAction: 'none' }}
          aria-hidden="true"
          className="block cursor-crosshair"
          onPointerDown={event => {
            if (event.button !== 0 || !event.isPrimary || !fgRef.current || !minimapViewport.current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const px = event.clientX - rect.left;
            const py = event.clientY - rect.top;
            const box = minimapViewport.current;
            const inside = px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h;
            const center = fgRef.current.centerAt();
            const transform = minimapTransform.current;
            minimapGesture.current = {
              pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
              inside, moved: false, centerX: center.x, centerY: center.y,
              scale: transform.scale, offsetX: transform.x, offsetY: transform.y,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.style.cursor = inside ? 'grabbing' : 'crosshair';
          }}
          onPointerMove={event => {
            const gesture = minimapGesture.current;
            if (gesture) {
              if (gesture.pointerId !== event.pointerId) return;
              const dx = event.clientX - gesture.startX;
              const dy = event.clientY - gesture.startY;
              if (Math.hypot(dx, dy) > 3) gesture.moved = true;
              if (gesture.inside && gesture.moved) {
                fgRef.current?.centerAt(gesture.centerX + dx / gesture.scale, gesture.centerY + dy / gesture.scale, 0);
              }
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            const px = event.clientX - rect.left, py = event.clientY - rect.top;
            const box = minimapViewport.current;
            event.currentTarget.style.cursor = box && px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h ? 'grab' : 'crosshair';
          }}
          onPointerUp={event => {
            const gesture = minimapGesture.current;
            if (!gesture || gesture.pointerId !== event.pointerId) return;
            minimapGesture.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
            event.currentTarget.style.cursor = gesture.inside ? 'grab' : 'crosshair';
            if (!gesture.inside && !gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) <= 3) {
              const rect = event.currentTarget.getBoundingClientRect();
              fgRef.current?.centerAt(
                (event.clientX - rect.left - gesture.offsetX) / gesture.scale,
                (event.clientY - rect.top - gesture.offsetY) / gesture.scale, 300);
            }
          }}
          onPointerCancel={() => { minimapGesture.current = null; }}
          onLostPointerCapture={event => { minimapGesture.current = null; event.currentTarget.style.cursor = 'crosshair'; }}
        />
        <span className="block pb-2 text-[10px] text-slate-500 dark:text-slate-400">{t('graph.minimap')}</span>
      </button>
    </div>
  );
}
