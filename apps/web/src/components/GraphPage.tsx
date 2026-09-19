import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Scan, ListChecks, PanelTopOpen, PanelTopClose, Focus, Save, LayoutGrid, Maximize2, PanelsTopLeft, Pencil, Plus, Minus, X } from 'lucide-react';
import ForceGraph2D from 'react-force-graph-2d';
import { insertNoteLink, type NoteGraphNode } from '@mygitnotes/core/note-graph';
import { selectFilteredGraph } from '@mygitnotes/core/note-filters';
import { ScreenPageSchema, type ScreenRow, type GraphLayout } from '@mygitnotes/core/screen-page';
import type { NoteQuery } from '@mygitnotes/core/note-query';
import type { NotebookConfig, FolderItem } from '../lib/types.js';
import { useNoteGraph, useNotePaths } from '../lib/use-note-queries.js';
import { overlayGraphDrafts } from '../lib/draft-overlay.js';
import { useLanePaths } from '../lib/screen-queries.js';
import type { FilterControls } from '../lib/filter-controls.js';
import type { ScreenController } from '../lib/use-screen-page.js';
import { useNoteEditing } from '../lib/note-editing.js';
import { arrangeGraphLayout, graphLaneViewport } from '../lib/graph-layout.js';
import { optimizeGraphLayout } from '../lib/graph-topology-layout.js';
import { initializeGraphLayout } from '../lib/graph-initial-layout.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { NoteEditorHandle, NoteEditorSession } from './NoteEditor.js';
import { GRAPH_APPEARANCE_KEY, graphColorGroup, graphColorGroups, readGraphAppearance, type GraphAppearance } from '../lib/graph-colors.js';
import { GraphControls } from './graph/GraphControls.js';
import { GraphFilters } from './GraphFilters.js';
import { GraphNoteCard } from './graph/GraphNoteCard.js';
import { GraphTool } from './graph/GraphTool.js';
import { ScreenEditRow } from './ScreenDialogs.js';
import { useGraphMinimap } from './graph/useGraphMinimap.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { themeColor, tokenAlpha } from '../lib/theme-color.js';
import './graph/graph-editing.css';

type LayoutNode = GraphLayout['nodes'][number];
type Node = NoteGraphNode & { x?: number; y?: number; fx?: number; fy?: number };
export interface GraphPageProps {
  notebooks: NotebookConfig[]; filters?: FilterControls;
  screen?: ScreenController; lane?: ScreenRow;
  folders?: FolderItem[];
}

export function GraphPage({ notebooks, filters, screen, lane, folders = [] }: GraphPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const laneIds = lane ? [lane.id] : params.getAll('lanes');
  const laneKey = laneIds.join(',');
  const activeLane = lane || (laneIds.length === 1 ? screen?.page.rows.find(row => row.id === laneIds[0]) : undefined);
  const showOutside = !lane && params.get('laneScope') === 'all';
  const [lanePanel, setLanePanel] = useState(false), [editLane, setEditLane] = useState(false);
  const [saveLayoutRequested, setSaveLayoutRequested] = useState(false);
  const [closing, setClosing] = useState<Set<string>>(() => new Set());
  const closeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    setClosing(new Set());
    return () => { closeTimers.current.forEach(clearTimeout); closeTimers.current.clear(); };
  }, [laneKey]);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();
  const container = useRef<HTMLDivElement>(null), controls = useRef<HTMLDivElement>(null);
  const fg = useRef<any>();
  const [cardDragging, setCardDragging] = useState(false);
  const [laneGeometry, setLaneGeometry] = useState<GraphLayout>({ nodes: [] });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [transform, setTransform] = useState({ x: 400, y: 300, k: 1 });
  const [, redraw] = useState(0);
  const [selected, setSelected] = useState<string[]>([]), [only, setOnly] = useState<string[] | null>(null);
  const [layout, setLayout] = useState<GraphLayout>(activeLane?.graph || { nodes: [] });
  const [showOrphans, setShowOrphans] = useState(true), [boxMode, setBoxMode] = useState(false);
  const [maximized, setMaximized] = useState<string | null>(null), [hover, setHover] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false), [name, setName] = useState(''), [notice, setNotice] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [appearance, setAppearance] = useState(readGraphAppearance), [appearanceError, setAppearanceError] = useState(false);
  const positions = useRef(new Map<string, LayoutNode>()), carets = useRef(new Map<string, number>());
  const fitted = useRef(false), interacted = useRef(false);
  const [gesture, setGesture] = useState<{ kind: 'box' | 'link'; start: { x: number; y: number }; end: { x: number; y: number }; source?: string } | null>(null);
  const rows = screen?.page.rows || [];
  const graphNotebook = filters?.value.notebookId;
  const laneRows = graphNotebook && graphNotebook !== 'all' ? rows.filter(row => row.notebookId === graphNotebook) : rows;
  const latest = useRef({ screen, layout }); latest.current = { screen, layout };
  useLayoutEffect(() => {
    setLayout(activeLane?.graph || { nodes: [] }); setSelected([]); setOnly(null); setMaximized(null);
    positions.current.clear(); fitted.current = false; interacted.current = false;
  }, [laneKey]);
  useLayoutEffect(() => { if (activeLane?.graph && JSON.stringify(activeLane.graph) !== JSON.stringify(latest.current.layout)) setLayout(activeLane.graph); }, [activeLane?.graph]);
  useEffect(() => {
    const host = container.current; if (!host) return;
    const measure = () => setSize({ width: host.clientWidth || 800, height: host.clientHeight || 600 });
    measure(); const observer = new ResizeObserver(measure); observer.observe(host); return () => observer.disconnect();
  }, []);
  // The filter bar grows as it wraps or gains filter chips; the tools below it follow its height.
  useEffect(() => {
    const host = container.current, bar = controls.current; if (!host || !bar) return;
    const measure = () => host.style.setProperty('--graph-controls-height', `${bar.offsetHeight}px`);
    measure(); const observer = new ResizeObserver(measure); observer.observe(bar); return () => observer.disconnect();
  }, [lane]);
  // A lane belongs to one notebook, so the graph showing it follows that notebook.
  useEffect(() => {
    if (lane || !activeLane || !filters || graphNotebook === activeLane.notebookId) return;
    const next = new URLSearchParams(params); next.set('notebook', activeLane.notebookId); setParams(next, { replace: true });
  }, [lane, activeLane?.notebookId, graphNotebook]);
  // Expanded cards host the notes' editors; their sessions drive the pending edges and link insertion.
  const editing = useNoteEditing();
  const [sessions, setSessions] = useState(() => new Map<string, NoteEditorSession>());
  const updateSession = (path: string, session: NoteEditorSession | null) => setSessions(previous => {
    const next = new Map(previous); if (session) next.set(path, session); else next.delete(path); return next;
  });
  const handles = useRef(new Map<string, NoteEditorHandle>()), editorRefs = useRef(new Map<string, (handle: NoteEditorHandle | null) => void>());
  const editorRef = (path: string) => {
    let ref = editorRefs.current.get(path);
    if (!ref) { ref = handle => { if (handle) handles.current.set(path, handle); else handles.current.delete(path); }; editorRefs.current.set(path, ref); }
    return ref;
  };
  // Nodes and links come from the server; the filter, the visible set and lane membership are
  // path queries, and unsaved drafts are laid over the answer.
  const graphSource = useNoteGraph();
  const scopeNotebook = activeLane?.notebookId || filters?.value.notebookId || 'all';
  const filterQuery = useMemo<Partial<NoteQuery>>(() => (filters ? {
    notebookId: scopeNotebook, folders: filters.value.folders, descendants: filters.value.descendants,
    tags: filters.value.tags, tagMode: filters.value.tagMode, status: filters.value.status,
    showHidden: filters.value.showHidden, q: filters.value.q,
  } : { notebookId: scopeNotebook, showHidden: false }), [filters?.value, scopeNotebook]);
  const matchingPaths = useNotePaths(filterQuery);
  const visiblePaths = useNotePaths(filters?.value.showHidden ? null : { notebookId: scopeNotebook, showHidden: false });
  const shownLanes = useMemo(() => [...rows.filter(row => laneIds.includes(row.id)), ...(lane ? [lane] : [])], [rows, laneKey, lane]);
  const lanePaths = useLanePaths(shownLanes);
  const editingDrafts = useMemo(() => [...sessions].flatMap(([path, session]) => {
    const node = graphSource.graph?.nodes.find(node => node.id === path);
    return session.dirty && node ? [{ path, notebookId: node.notebookId, title: session.title || node.title, status: node.status, tags: node.tags, content: session.content }] : [];
  }), [sessions, graphSource.graph]);
  const graph = useMemo(
    () => (graphSource.graph ? overlayGraphDrafts(graphSource.graph, editingDrafts) : { nodes: [], links: [] }),
    [graphSource.graph, editingDrafts],
  );
  const matching = useMemo(() => {
    let matches = matchingPaths.paths;
    if (laneIds.length && !showOutside) {
      const included = new Set(shownLanes.flatMap(row => lanePaths.paths.get(row.id) || []));
      matches = matches.filter(path => included.has(path));
    }
    if (only) matches = matches.filter(path => only.includes(path));
    return matches;
  }, [matchingPaths.paths, laneKey, shownLanes, only, showOutside, lanePaths.paths]);
  const laneMembers = useMemo(() => new Set(rows.filter(row => laneIds.includes(row.id)).flatMap(row => lanePaths.paths.get(row.id) || [])), [rows, laneKey, lanePaths.paths]);
  const expanded = useMemo(() => new Set(layout.nodes.filter(node => node.expanded).map(node => node.path)), [layout]);
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
    return { links: graph2.links, nodes: visible.map(node => {
      const position = initialized.get(node.id)!;
      return { ...node, x: position.x, y: position.y, fx: position.x, fy: position.y };
    }) };
  }, [graph, matching, visiblePaths.paths, layout, showOrphans, filters?.neighbors, filters?.value.showHidden, activeLane?.notebookId]);
  const colors = useMemo(() => graphColorGroups(graphData.nodes, notebooks, appearance), [graphData, notebooks, appearance]);
  const nodeColor = useCallback((node: NoteGraphNode) => themeColor(colors.find(group => group.key === graphColorGroup(node, notebooks, appearance.mode).key)?.color || 'var(--color-muted)'), [colors, notebooks, appearance]);
  const changeAppearance = (value: GraphAppearance) => { setAppearance(value); try { localStorage.setItem(GRAPH_APPEARANCE_KEY, JSON.stringify(value)); setAppearanceError(false); } catch { setAppearanceError(true); } };
  const isDark = document.documentElement.classList.contains('dark');
  const currentLayout = (): GraphLayout => {
    const merged = new Map(latest.current.layout.nodes.map(node => [node.path, node]));
    for (const node of graphData.nodes as Node[]) if (node.x !== undefined && node.y !== undefined) merged.set(node.id, { ...merged.get(node.id), path: node.id, x: node.x, y: node.y });
    return { nodes: [...merged.values()] };
  };
  const persistLayout = (next: GraphLayout) => {
    setLayout(next);
    const controller = latest.current.screen;
    if (activeLane && controller?.writable) controller.change({ ...controller.page, rows: controller.page.rows.map(row => row.id === activeLane.id ? { ...row, graph: next } : row) });
  };
  useEffect(() => {
    if (!saveLayoutRequested || !screen || screen.saving) return;
    setSaveLayoutRequested(false);
    void screen.save();
  }, [saveLayoutRequested, screen?.saving, screen?.page, screen?.save]);
  const freeze = () => { interacted.current = true; for (const node of graphData.nodes as Node[]) { node.fx = node.x; node.fy = node.y; } };
  const reflow = (next: GraphLayout, topology = false) => {
    const visible = new Set(graphData.nodes.map(node => node.id));
    const visibleLayout = { nodes: next.nodes.filter(node => visible.has(node.path)) };
    const arranged = topology ? optimizeGraphLayout(visibleLayout, graphData.links) : arrangeGraphLayout(visibleLayout, { compact: true });
    const byPath = new Map(arranged.nodes.map(node => [node.path, node]));
    return { nodes: next.nodes.map(node => byPath.get(node.path) || node) };
  };
  const finishClosing = (path: string) => {
    clearTimeout(closeTimers.current.get(path)); closeTimers.current.delete(path);
    setClosing(previous => { const next = new Set(previous); next.delete(path); return next; });
    setMaximized(previous => previous === path ? null : previous);
  };
  // Collapsing unmounts the card's editor, so its pending edits are saved first and a failed save keeps the card open.
  const setExpanded = async (paths: string[], value: boolean) => {
    if (!value && !await editing.flushEditors(paths)) return;
    freeze(); const next = currentLayout();
    for (const path of paths) {
      clearTimeout(closeTimers.current.get(path)); closeTimers.current.delete(path);
      if (!value && expanded.has(path) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setClosing(previous => new Set(previous).add(path));
        // Animation completion owns unmounting. The longer fallback only handles
        // cancelled animations (for example, changing reduced-motion settings).
        closeTimers.current.set(path, setTimeout(() => finishClosing(path), 1500));
      } else setClosing(previous => { const next = new Set(previous); next.delete(path); return next; });
      let node = next.nodes.find(node => node.path === path);
      if (!node) { node = { path, x: 0, y: 0 }; next.nodes.push(node); }
      node.expanded = value; node.width ||= 360; node.height ||= 300;
    }
    const arranged = value ? reflow(next) : next;
    persistLayout(arranged);
    if (!value && maximized && paths.includes(maximized) && !closeTimers.current.has(maximized)) setMaximized(null);
    if (value && !lane) requestAnimationFrame(() => fitView(arranged));
  };
  const additive = (event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => Boolean(event.shiftKey || event.ctrlKey || event.metaKey);
  const select = (path: string, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => setSelected(previous => additive(event) ? previous.includes(path) ? previous.filter(id => id !== path) : [...previous, path] : [path]);
  const fitView = (next: GraphLayout) => {
    if (!fg.current) return;
    const visible = new Set(graphData.nodes.map(node => node.id));
    if (lane) {
      const view = graphLaneViewport({ nodes: next.nodes.filter(node => visible.has(node.path)) }, size.width);
      const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250;
      fg.current.centerAt(view.x, view.y, duration); fg.current.zoom(view.zoom, duration); return;
    }
    const bounds = next.nodes.filter(node => visible.has(node.path)).map(node => ({ x: node.x, y: node.y, w: node.expanded ? node.width || 360 : 32, h: node.expanded ? node.height || 300 : 32 }));
    if (!bounds.length) return;
    const left = Math.min(...bounds.map(n => n.x - n.w / 2)), right = Math.max(...bounds.map(n => n.x + n.w / 2));
    const top = Math.min(...bounds.map(n => n.y - n.h / 2)), bottom = Math.max(...bounds.map(n => n.y + n.h / 2));
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250;
    fg.current.centerAt((left + right) / 2, (top + bottom) / 2, duration);
    fg.current.zoom(Math.min(1.4, Math.max(.1, Math.min((size.width - 120) / (right - left), (size.height - 180) / (bottom - top)))), duration);
  };
  const resetView = () => fitView(currentLayout());
  const captureLaneGeometry = () => {
    if (!lane) return;
    const visible = new Set(graphData.nodes.map(node => node.id));
    setLaneGeometry({ nodes: currentLayout().nodes.filter(node => visible.has(node.path)).map(node => ({ ...node, expanded: node.expanded || closing.has(node.path) })) });
  };
  const laneViewport = graphLaneViewport(laneGeometry, size.width);
  useEffect(() => {
    if (!lane || cardDragging) return;
    // Wait for pointer movement to settle; resizing the canvas during a drag
    // would move the camera beneath the pointer.
    const timer = setTimeout(captureLaneGeometry, 200);
    return () => clearTimeout(timer);
  }, [lane, layout, closing, graphData, cardDragging]);
  useEffect(() => {
    if (!lane || !fg.current) return;
    const timer = setTimeout(() => {
      const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250;
      fg.current.centerAt(laneViewport.x, laneViewport.y, duration);
      fg.current.zoom(laneViewport.zoom, duration);
    }, 30);
    return () => clearTimeout(timer);
  }, [laneViewport.height, laneViewport.x, laneViewport.y, laneViewport.zoom, size.width, size.height, Boolean(lane)]);
  const { paintMinimap, minimap } = useGraphMinimap({ graphRef: fg, graphData, dimensions: size, isDark, nodeColor, onClearHover: () => setHover(null), onReset: resetView, onNavigate: () => { interacted.current = true; } });
  useEffect(() => {
    if (!graphData.nodes.length || fitted.current || interacted.current) return;
    const timer = setTimeout(() => { if (!interacted.current) { resetView(); fitted.current = true; } }, 100);
    return () => clearTimeout(timer);
  }, [graphData.nodes.length, size.width, size.height, laneKey]);
  const frameSignature = useRef('');
  const frame = () => {
    paintMinimap(); if (!fg.current) return;
    for (const node of graphData.nodes as Node[]) if (node.x !== undefined && node.y !== undefined) positions.current.set(node.id, { path: node.id, x: node.x, y: node.y });
    const origin = fg.current.graph2ScreenCoords(0, 0), k = fg.current.zoom();
    const signature = `${origin.x},${origin.y},${k}:` + graphData.nodes.filter(n => expanded.has(n.id)).map(n => `${n.x},${n.y}`).join(';');
    if (frameSignature.current !== signature) { frameSignature.current = signature; setTransform({ ...origin, k }); redraw(v => v + 1); }
  };
  const point = (event: { clientX: number; clientY: number }) => { const box = container.current!.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top }; };
  const selectBox = (start: { x: number; y: number }, end: { x: number; y: number }, add: boolean) => {
    const paths = graphData.nodes.filter(node => { const x=(node.x||0)*transform.k+transform.x,y=(node.y||0)*transform.k+transform.y; return x>=Math.min(start.x,end.x)&&x<=Math.max(start.x,end.x)&&y>=Math.min(start.y,end.y)&&y<=Math.max(start.y,end.y); }).map(n=>n.id);
    setSelected(previous => add ? [...new Set([...previous,...paths])] : paths);
  };
  // A modifier drag on empty canvas draws a box that adds the enclosed notes; on a node it still drags the node.
  const startBox = (event: React.PointerEvent) => {
    if (event.button !== 0 || !additive(event) || (event.target as Element).tagName !== 'CANVAS') return;
    const start = point(event), cursor = fg.current?.screen2GraphCoords(start.x, start.y);
    if (!cursor || (graphData.nodes as Node[]).some(node => !expanded.has(node.id) && node.x !== undefined && Math.hypot(node.x - cursor.x, node.y! - cursor.y) < 12)) return;
    const move = (e: PointerEvent) => setGesture({ kind: 'box', start, end: point(e) });
    const finish = (e: PointerEvent) => { cancel(); if (Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) >= 5) selectBox(start, point(e), true); };
    const cancel = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); setGesture(null); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel);
  };
  const link = (source: string, target: { path: string; title: string }) => {
    const session = sessions.get(source), handle = handles.current.get(source); if (!session || session.locked || !handle) return;
    const result = insertNoteLink(session.content, source, target.path, target.title, carets.current.get(source));
    if (result.content === session.content) { setNotice(t('graph.linkExists')); return; }
    const at = result.position - (result.content.length - session.content.length);
    handle.insert(result.content.slice(at, result.position), at); carets.current.set(source, result.position); setNotice(t('graph.linkAdded'));
  };
  const drag = (event: React.PointerEvent, path: string, kind: 'move' | 'resize') => {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || maximized) return;
    event.preventDefault(); event.stopPropagation(); freeze(); setCardDragging(true);
    const initial = currentLayout(), saved = initial.nodes.find(node => node.path === path)!;
    let draggedLayout = initial;
    const start = point(event), k = transform.k;
    const move = (e: PointerEvent) => {
      const p = point(e), dx = (p.x - start.x) / k, dy = (p.y - start.y) / k;
      draggedLayout = { nodes: initial.nodes.map(node => node.path === path ? { ...node, pinned: true, ...(kind === 'move' ? { x: saved.x + dx, y: saved.y + dy } : { width: Math.max(240, Math.min(1600, (saved.width || 360) + dx)), height: Math.max(180, Math.min(1400, (saved.height || 300) + dy)) }) } : node) };
      setLayout(draggedLayout);
    };
    const end = () => { setCardDragging(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); persistLayout(kind === 'resize' ? reflow(draggedLayout) : draggedLayout); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  };
  const startLink = (event: React.PointerEvent, source: string) => {
    if (sessions.get(source)?.locked !== false || event.button !== 0) return;
    event.stopPropagation(); const start = point(event); freeze();
    setGesture({ kind: 'link', start, end: start, source });
    const move = (e: PointerEvent) => setGesture({ kind: 'link', start, end: point(e), source });
    const finish = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); setGesture(null);
      if (Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 5) return;
      const element = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-graph-note]');
      let target = element?.getAttribute('data-graph-note');
      if (!target) { const p = point(e); const nearest = (graphData.nodes as Node[]).find(n => n.x !== undefined && Math.hypot(n.x * transform.k + transform.x - p.x, n.y! * transform.k + transform.y - p.y) < 18); target = nearest?.id; }
      const node = graphData.nodes.find(n => n.id === target); if (node) link(source, { path: node.id, title: node.title });
    };
    const cancel = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); setGesture(null); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel);
  };
  const graphLoading = graphSource.loading || matchingPaths.loading || visiblePaths.loading || lanePaths.loading;
  const visibleSelected = selected.filter(path => graphData.nodes.some(node => node.id === path));
  const selectLane = (id: string) => { const next = new URLSearchParams(params); next.delete('lanes'); next.delete('laneScope'); if (id) next.set('lanes', id); setParams(next); };
  const changeMembership = (add: boolean) => {
    if (!screen?.writable || activeLane?.kind !== 'custom') return;
    const selectedSet = new Set(visibleSelected);
    const items = add ? [...activeLane.items, ...graphData.nodes.filter(node => selectedSet.has(node.id) && !activeLane.items.some(item => item.kind === 'note' && item.path === node.id && item.notebookId === node.notebookId)).map(node => ({ id: crypto.randomUUID(), kind: 'note' as const, path: node.id, notebookId: node.notebookId }))]
      : activeLane.items.filter(item => item.kind !== 'note' || !selectedSet.has(item.path));
    screen.change({ ...screen.page, rows: screen.page.rows.map(row => row.id === activeLane.id ? { ...activeLane, items } : row) });
  };
  const openFullGraph = async () => { if (await editing.flushEditors()) navigate(`/graph?notebook=${encodeURIComponent(lane!.notebookId)}&lanes=${encodeURIComponent(lane!.id)}`); };
  const hoveredNode = graphData.nodes.find(node => node.id === hover && !expanded.has(node.id) && !closing.has(node.id));
  const selectedNotebooks = new Set(visibleSelected.map(path => graphData.nodes.find(node => node.id === path)?.notebookId));
  const saveNotebook = selectedNotebooks.size === 1 ? [...selectedNotebooks][0] : undefined;
  const saveLane = () => {
    if (!screen?.writable || !name.trim() || !saveNotebook) return;
    const id = crypto.randomUUID(), current = currentLayout();
    const row: ScreenRow = { id, kind: 'custom', name: name.trim(), view: 'graph', notebookId: saveNotebook, items: visibleSelected.map(path => ({ id: crypto.randomUUID(), kind: 'note', notebookId: saveNotebook, path })), graph: { nodes: current.nodes.filter(n => visibleSelected.includes(n.path)) } };
    const next = ScreenPageSchema.safeParse({ ...screen.page, rows: [...screen.page.rows, row] });
    if (!next.success) { setNotice(t('screen.limit')); return; }
    screen.change(next.data); setSaveOpen(false); setNotice(t('graph.laneCreated'));
  };
  const filtersElement = filters ? <GraphFilters {...filters} count={matching.length} showOrphans={showOrphans} onToggleOrphans={() => setShowOrphans(v => !v)} extraCount={laneIds.length}>
    <fieldset><legend>{t('graph.lanes')}</legend>{[...new Set([...laneRows.map(row => row.id), ...laneIds])].map(id => <label className="filter-check" key={id}><input type="checkbox" checked={laneIds.includes(id)} onChange={() => { const next = new URLSearchParams(params); next.delete('lanes'); (laneIds.includes(id) ? laneIds.filter(v => v !== id) : [...laneIds, id]).forEach(value => next.append('lanes', value)); setParams(next); }} />{rows.find(row => row.id === id)?.name || t('screen.laneMissing')}</label>)}</fieldset>
  </GraphFilters> : null;

  return <div ref={container} style={lane ? { height: laneViewport.height } : undefined} data-selected-count={visibleSelected.length} tabIndex={0} aria-label={t('graph.canvasHelp')} className={`graph-page-container graph-editing-surface ${lane ? 'graph-in-lane' : ''}`} onDoubleClickCapture={event => {
    if ((event.target as Element).tagName !== 'CANVAS') return;
    const box = container.current!.getBoundingClientRect();
    const cursor = fg.current?.screen2GraphCoords(event.clientX - box.left, event.clientY - box.top);
    const node = cursor && (graphData.nodes as Node[]).find(node => node.x !== undefined && Math.hypot(node.x - cursor.x, node.y! - cursor.y) < 12 / fg.current.zoom());
    if (node && !expanded.has(node.id) && !closing.has(node.id)) setExpanded([node.id], true);
  }} onKeyDown={event => {
    if (event.key !== 'Enter' || !visibleSelected.length || (event.target as Element).closest('button,input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
    event.preventDefault(); setExpanded(visibleSelected, !visibleSelected.every(path => expanded.has(path)));
  }} onWheelCapture={() => { interacted.current = true; }} onPointerDownCapture={event => { if ((event.target as Element).tagName === 'CANVAS') { interacted.current = true; container.current?.focus({ preventScroll: true }); } startBox(event); }}>
    {!lane && <GraphControls controlsRef={controls} filterPanel={filtersElement} appearance={appearance} onAppearanceChange={changeAppearance} visibleColorGroups={colors} appearanceSaveError={appearanceError} />}
    {!lane && <div className="graph-selection-toolbar" role="toolbar" aria-label={t('graph.tools')}>
      <GraphTool label={t('graph.boxSelect')} pressed={boxMode} onClick={() => setBoxMode(v => !v)}><Scan size={18} /></GraphTool>
      <GraphTool label={`${t('graph.selectNotes')} (${visibleSelected.length})`} pressed={pickerOpen} onClick={() => { setPickerOpen(v => !v); setLanePanel(false); }}><ListChecks size={18} /><small>{visibleSelected.length || ''}</small></GraphTool>
      <GraphTool label={t('graph.expand')} disabled={!visibleSelected.length} onClick={() => setExpanded(visibleSelected, true)}><PanelTopOpen size={18} /></GraphTool>
      <GraphTool label={t('graph.collapse')} disabled={!visibleSelected.length} onClick={() => setExpanded(visibleSelected, false)}><PanelTopClose size={18} /></GraphTool>
      <GraphTool label={t(only ? 'graph.showAll' : 'graph.onlySelected')} pressed={Boolean(only)} disabled={!visibleSelected.length && !only} onClick={() => setOnly(only ? null : visibleSelected)}><Focus size={18} /></GraphTool>
      <GraphTool label={t('graph.saveLane')} disabled={!saveNotebook || !screen?.writable} onClick={() => { setName(''); setSaveOpen(true); }}><Save size={18} /></GraphTool>
      <GraphTool label={t('graph.arrange')} onClick={() => {
        freeze();
        const arranged = reflow(currentLayout(), true); persistLayout(arranged); requestAnimationFrame(() => fitView(arranged));
      }}><LayoutGrid size={18} /></GraphTool>
      <GraphTool label={t('graph.chooseLane')} pressed={lanePanel || Boolean(activeLane)} onClick={() => { setLanePanel(v => !v); setPickerOpen(false); }}><PanelsTopLeft size={18} /></GraphTool>
      {activeLane && <GraphTool label={t('screen.editRow')} disabled={!screen?.writable} onClick={() => setEditLane(true)}><Pencil size={18} /></GraphTool>}
    </div>}
    {lane && <div className="graph-fullscreen-tool"><GraphTool label={t('graph.openLaneGraph')} onClick={() => void openFullGraph()}><Maximize2 size={18} /></GraphTool></div>}
    {!lane && lanePanel && <section className="graph-lane-panel" aria-label={t('graph.chooseLane')}>
      <header><strong>{activeLane?.name || t('graph.lanes')}</strong><button aria-label={t(activeLane ? 'graph.minimizeLane' : 'common.close')} title={t(activeLane ? 'graph.minimizeLane' : 'common.close')} onClick={() => setLanePanel(false)}>{activeLane ? <Minus size={16} /> : <X size={16} />}</button></header>
      <select aria-label={t('graph.chooseLane')} value={activeLane?.id || ''} onChange={event => selectLane(event.target.value)}><option value="">{t('graph.allLanes')}</option>{laneRows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      {activeLane && <><label><input type="checkbox" checked={showOutside} onChange={event => { const next = new URLSearchParams(params); event.target.checked ? next.set('laneScope', 'all') : next.delete('laneScope'); setParams(next); }} />{t('graph.showOutsideLane')}</label>
        {showOutside && <p>{t('graph.outsideLaneHint')}</p>}
        <button className="ui-button" disabled={!screen?.writable} title={t('screen.editRow')} onClick={() => setEditLane(true)}><Pencil size={14} />{t('screen.editRow')}</button>
        <button className="ui-button graph-save-lane" disabled={!screen?.writable || screen.saving || Boolean(screen.error)} title={t('graph.saveLayoutHint')} onClick={() => { freeze(); persistLayout(currentLayout()); setSaveLayoutRequested(true); }}><Save size={14} />{t(screen?.saving ? 'editor.saving' : 'graph.saveCurrentLane')}</button>
        <p className="graph-save-hint">{t('graph.saveLayoutHint')}</p>
        {activeLane.kind === 'custom' ? <div className="graph-lane-membership"><button className="ui-button" disabled={!screen?.writable || !visibleSelected.some(path => !laneMembers.has(path))} onClick={() => changeMembership(true)}><Plus size={14} />{t('graph.addToLane')}</button><button className="ui-button" disabled={!screen?.writable || !visibleSelected.some(path => laneMembers.has(path))} onClick={() => changeMembership(false)}><Minus size={14} />{t('graph.removeFromLane')}</button></div> : <p>{t('graph.dynamicLaneHint')}</p>}
      </>}
      {screen?.error && <p role="alert">{screen.error}</p>}
    </section>}
    {!lane && !lanePanel && activeLane && <button type="button" className="graph-lane-label" aria-expanded={false} title={t('graph.chooseLane')} onClick={() => { setLanePanel(true); setPickerOpen(false); }}>{activeLane.name}</button>}
    {editLane && activeLane && screen && <ScreenEditRow row={activeLane} notebooks={notebooks} assets={[]} folders={folders} selectedNotebookId={filters?.value.notebookId === 'all' ? notebooks[0]?.id || '' : filters?.value.notebookId || notebooks[0]?.id || ''} disabled={!screen.writable} onClose={() => setEditLane(false)} onApply={row => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id === row.id ? row : value) })} onRemove={() => { screen.change({ ...screen.page, rows: screen.page.rows.filter(row => row.id !== activeLane.id) }); selectLane(''); }} />}
    {pickerOpen && <div className="graph-note-selector" style={activeLane ? { top: 'calc(var(--graph-tools-top) + 44px)' } : undefined}>{graphData.nodes.map(node => <label key={node.id}><input type="checkbox" checked={selected.includes(node.id)} onChange={() => select(node.id, { shiftKey: true })} />{node.title}</label>)}</div>}
    {notice && <div role="status" className="graph-notice" onClick={() => setNotice('')}>{notice}</div>}
    <ForceGraph2D ref={fg} width={size.width} height={size.height} graphData={graphData} nodeId="id" cooldownTicks={1}
      onRenderFramePost={frame} onEngineStop={() => { captureLaneGeometry(); if (graphData.nodes.length && !fitted.current && !interacted.current) { fitted.current = true; resetView(); } }}
      onNodeDragEnd={node => { freeze(); const next = currentLayout(); const saved = next.nodes.find(n => n.path === node.id); if (saved) saved.pinned = true; persistLayout(next); }}
      onNodeClick={(node, event) => select(node.id, event)} onNodeHover={node => { clearTimeout(hoverTimer.current); if (node) setHover(node.id); else hoverTimer.current = setTimeout(() => setHover(null), 250); }}
      onBackgroundClick={() => setSelected([])} enablePanInteraction={event => !additive(event)}
      nodeCanvasObject={(node: Node, ctx, scale) => {
        if (expanded.has(node.id) || closing.has(node.id)) return;
        const x = node.x || 0, y = node.y || 0, radius = selected.includes(node.id) ? 9 : 6;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = nodeColor(node); ctx.globalAlpha = showOutside && laneIds.length && !laneMembers.has(node.id) ? .25 : node.external ? .4 : 1; ctx.fill();
        if (selected.includes(node.id)) { ctx.strokeStyle = themeColor('var(--color-text)'); ctx.lineWidth = 2 / scale; ctx.stroke(); }
        ctx.font = `${12 / scale}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = themeColor('var(--color-muted)');
        ctx.fillText(node.title, x, y + radius + 15 / scale); ctx.globalAlpha = 1;
      }} nodePointerAreaPaint={(node: Node, color, ctx) => { if (expanded.has(node.id)) return; ctx.beginPath(); ctx.arc(node.x || 0, node.y || 0, 12, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }}
      linkCanvasObjectMode={() => 'replace'} linkCanvasObject={(edge: any, ctx, scale) => {
        const a = edge.source as Node, b = edge.target as Node; if (a.x === undefined || b.x === undefined) return;
        const end = (from: Node, to: Node) => { const card = layout.nodes.find(n => n.path === from.id && n.expanded); const dx = to.x! - from.x!, dy = to.y! - from.y!; const factor = card ? Math.min((card.width || 360) / 2 / (Math.abs(dx) || 1e-9), (card.height || 300) / 2 / (Math.abs(dy) || 1e-9)) : 8 / Math.max(1, Math.hypot(dx, dy)); return { x: from.x! + dx * Math.min(.49, factor), y: from.y! + dy * Math.min(.49, factor) }; };
        const start = end(a,b), stop = end(b,a), angle = Math.atan2(stop.y-start.y, stop.x-start.x);
        const pending = sessions.get(a.id)?.dirty;
        ctx.strokeStyle = themeColor(tokenAlpha('muted', 55)); ctx.lineWidth = (hover === a.id || hover === b.id ? 2 : 1) / scale; ctx.setLineDash(pending ? [5/scale,4/scale] : []);
        ctx.beginPath(); ctx.moveTo(start.x,start.y); ctx.lineTo(stop.x,stop.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(stop.x,stop.y); ctx.lineTo(stop.x-Math.cos(angle-.45)*8/scale,stop.y-Math.sin(angle-.45)*8/scale); ctx.moveTo(stop.x,stop.y); ctx.lineTo(stop.x-Math.cos(angle+.45)*8/scale,stop.y-Math.sin(angle+.45)*8/scale); ctx.stroke();
      }} />
    {graphData.nodes.filter(node => expanded.has(node.id) || closing.has(node.id)).map(node => {
      const card = layout.nodes.find(n => n.path === node.id)!;
      const large = maximized === node.id, w = card.width || 360, h = card.height || 300;
      return <div key={node.id} onAnimationEnd={event => {
        if (event.animationName === 'graph-note-exit' && closing.has(node.id) && (event.target as HTMLElement).classList.contains('graph-note-card')) finishClosing(node.id);
      }} className={`graph-card-position ${closing.has(node.id) ? 'is-closing' : ''} ${large ? 'is-maximized' : ''} ${showOutside && laneIds.length && !laneMembers.has(node.id) ? 'is-outside-lane' : ''}`} style={large ? { inset: 8, zIndex: 80 } : { left: (node.x || 0)*transform.k+transform.x-w*transform.k/2, top: (node.y || 0)*transform.k+transform.y-h*transform.k/2, width:w, height:h, transform:`scale(${transform.k})`, zIndex:selected.includes(node.id) ? 24 : 20 }}>
        <GraphNoteCard node={node} color={nodeColor(node)} session={sessions.get(node.id)} editorRef={editorRef(node.id)} onSession={session => updateSession(node.id, session)} selected={selected.includes(node.id)} maximized={large} onSelect={event => select(node.id,event)} onCaret={position => carets.current.set(node.id,position)}
          onMove={event => drag(event,node.id,'move')} onResize={event => drag(event,node.id,'resize')} onConnect={event => startLink(event,node.id)} onLink={target => link(node.id,target)} onCollapse={() => void setExpanded([node.id],false)} onMaximize={() => setMaximized(large ? null : node.id)} />
      </div>;
    })}
    {hoveredNode && <button className="ui-button graph-hover-expand" style={{ left: (hoveredNode.x || 0) * transform.k + transform.x + 14, top: (hoveredNode.y || 0) * transform.k + transform.y - 14 }} title={t('graph.expandEnter')} aria-label={`${t('graph.expand')}: ${hoveredNode.title}`} onMouseEnter={() => clearTimeout(hoverTimer.current)} onMouseLeave={() => setHover(null)} onClick={() => { setExpanded([hoveredNode.id], true); setHover(null); }}><PanelTopOpen size={16} /></button>}
    {boxMode && <div className="graph-box-layer" onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); const start = point(event); setGesture({ kind:'box',start,end:start }); }}
      onPointerMove={event => { if (gesture?.kind === 'box') setGesture({ ...gesture,end:point(event) }); }}
      onPointerCancel={() => setGesture(null)} onPointerUp={event => {
        if (gesture?.kind !== 'box') return;
        selectBox(gesture.start, point(event), additive(event)); setGesture(null); setBoxMode(false);
      }} />}
    {gesture && <svg className="graph-gesture" width={size.width} height={size.height}>{gesture.kind === 'box' ? <rect x={Math.min(gesture.start.x,gesture.end.x)} y={Math.min(gesture.start.y,gesture.end.y)} width={Math.abs(gesture.end.x-gesture.start.x)} height={Math.abs(gesture.end.y-gesture.start.y)} style={{ fill: tokenAlpha('primary', 20), stroke: 'var(--color-primary)' }} /> : <line x1={gesture.start.x} y1={gesture.start.y} x2={gesture.end.x} y2={gesture.end.y} style={{ stroke: 'var(--color-primary)' }} strokeWidth="2" />}</svg>}
    {(graphSource.error || matchingPaths.error || visiblePaths.error || lanePaths.error) && <div role="alert" className="graph-notice">{graphSource.error || matchingPaths.error || visiblePaths.error || lanePaths.error}</div>}
    {graphLoading && <p className="graph-empty" role="status">{t('notes.loading')}</p>}
    {!graphLoading && !graphData.nodes.length && <p className="graph-empty" role="status">{t('filters.graphEmpty')}</p>}
    <div className="graph-minimap-panel"><div className="graph-stats" role="status" data-filter-results={matching.length} data-graph-nodes={graphData.nodes.length} data-graph-links={graphData.links.length}>
      <button className="ui-icon-button" aria-label={t('graph.resetZoom')} title={t('graph.resetZoom')} onClick={resetView}>↺</button><span>{graphData.nodes.length} ●</span><span>{graphData.links.length} ↗</span></div>{minimap}</div>
    {saveOpen && <WorkspaceDialog title={t('graph.saveLane')} onClose={() => setSaveOpen(false)}><input className="ui-control" autoFocus aria-label={t('screen.rowName')} value={name} onChange={event=>setName(event.target.value)} maxLength={100} /><div className="workspace-dialog-actions"><button className="ui-button" disabled={!name.trim()} onClick={saveLane}>{t('graph.saveLane')}</button></div></WorkspaceDialog>}
  </div>;
}
