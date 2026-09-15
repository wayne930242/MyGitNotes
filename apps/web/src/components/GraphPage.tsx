import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Scan, ListChecks, PanelTopOpen, PanelTopClose, Focus, Save, LayoutGrid, Maximize2, PanelsTopLeft, Pencil, Plus, Minus, X } from 'lucide-react';
import ForceGraph2D from 'react-force-graph-2d';
import { buildNoteGraph, insertNoteLink, type NoteGraphNode } from '@mygitnotes/core/note-graph';
import { filterNotes, selectFilteredGraph } from '@mygitnotes/core/note-filters';
import { isNoteHidden } from '@mygitnotes/core/note-status';
import { ScreenPageSchema, screenRowNotePaths, type ScreenRow, type GraphLayout } from '@mygitnotes/core/screen-page';
import type { NoteItem, NotebookConfig, FolderItem } from '../lib/types.js';
import type { FilterControls } from '../lib/filter-controls.js';
import type { ScreenController } from '../lib/use-screen-page.js';
import type { GraphEditing } from '../lib/use-graph-editing.js';
import { arrangeGraphLayout, graphLaneViewport } from '../lib/graph-layout.js';
import { useWorkspaceLinks } from './WorkspaceLinks.js';
import { useTranslation } from '../lib/i18n/index.js';
import { GRAPH_APPEARANCE_KEY, graphColorGroup, graphColorGroups, readGraphAppearance, type GraphAppearance } from '../lib/graph-colors.js';
import { GraphControls } from './graph/GraphControls.js';
import { GraphFilters } from './GraphFilters.js';
import { GraphNoteCard } from './graph/GraphNoteCard.js';
import { GraphTool } from './graph/GraphTool.js';
import { ScreenEditRow } from './ScreenDialogs.js';
import { useGraphMinimap } from './graph/useGraphMinimap.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import './graph/graph-editing.css';

type LayoutNode = GraphLayout['nodes'][number];
type Node = NoteGraphNode & { x?: number; y?: number; fx?: number; fy?: number };
export interface GraphPageProps {
  notebooks: NotebookConfig[]; notes: NoteItem[]; filters?: FilterControls;
  onOpenNote: (note: NoteItem) => void; screen?: ScreenController; lane?: ScreenRow; editing?: GraphEditing;
  folders?: FolderItem[];
}

export function GraphPage({ notebooks, notes, filters, onOpenNote, screen, lane, editing, folders = [] }: GraphPageProps) {
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
  const frozen = useRef(Boolean(activeLane?.graph)), fitted = useRef(false), interacted = useRef(false);
  const [gesture, setGesture] = useState<{ kind: 'box' | 'link'; start: { x: number; y: number }; end: { x: number; y: number }; source?: string } | null>(null);
  const rows = screen?.page.rows || [];
  const latest = useRef({ screen, layout }); latest.current = { screen, layout };
  useEffect(() => {
    setLayout(activeLane?.graph || { nodes: [] }); setSelected([]); setOnly(null); setMaximized(null);
    positions.current.clear(); frozen.current = Boolean(activeLane?.graph); fitted.current = false; interacted.current = false;
  }, [laneKey]);
  useEffect(() => { if (activeLane?.graph && JSON.stringify(activeLane.graph) !== JSON.stringify(latest.current.layout)) { setLayout(activeLane.graph); frozen.current = true; } }, [activeLane?.graph]);
  useEffect(() => {
    const host = container.current; if (!host) return;
    const measure = () => setSize({ width: host.clientWidth || 800, height: host.clientHeight || 600 });
    measure(); const observer = new ResizeObserver(measure); observer.observe(host); return () => observer.disconnect();
  }, []);
  const { registerBeforeNavigate } = useWorkspaceLinks();
  useEffect(() => registerBeforeNavigate(async () => { try { await editing?.store.flushAll(); return true; } catch (error) { setNotice((error as Error).message); return false; } }), [editing?.store, registerBeforeNavigate]);
  const effective = useMemo(() => notes.map(note => editing?.store.get(note).draft || note), [notes, editing?.version]);
  const matching = useMemo(() => {
    let matches = filters ? filterNotes(effective, filters.value) : effective.filter(note => !isNoteHidden({ ...note.metadata, status: note.status }));
    if (laneIds.length && !showOutside) {
      const included = new Set(rows.filter(row => laneIds.includes(row.id)).flatMap(row => screenRowNotePaths(row, effective)));
      if (lane) for (const path of screenRowNotePaths(lane, effective)) included.add(path);
      matches = matches.filter(note => included.has(note.path));
    }
    if (only) matches = matches.filter(note => only.includes(note.path));
    return matches;
  }, [effective, filters?.value, laneKey, rows, lane, only, showOutside]);
  const laneMembers = useMemo(() => new Set(rows.filter(row => laneIds.includes(row.id)).flatMap(row => screenRowNotePaths(row, effective))), [rows, laneKey, effective]);
  const expanded = useMemo(() => new Set(layout.nodes.filter(node => node.expanded).map(node => node.path)), [layout]);
  const graphData = useMemo(() => {
    const eligible = effective.filter(note => filters?.value.showHidden || !isNoteHidden({ ...note.metadata, status: note.status }));
    const full = buildNoteGraph(eligible, { includeHidden: true });
    const graph = selectFilteredGraph(full, new Set(matching.map(note => note.path)), filters?.neighbors || false);
    const connected = new Set(graph.links.flatMap(link => [link.source, link.target]));
    const saved = new Map(layout.nodes.map(node => [node.path, node]));
    return { links: graph.links, nodes: graph.nodes.filter(node => showOrphans || connected.has(node.id)).map(node => {
      const previous = saved.get(node.id) || positions.current.get(node.id);
      return { ...node, ...(previous ? { x: previous.x, y: previous.y, ...((frozen.current || previous.pinned || previous.expanded) ? { fx: previous.x, fy: previous.y } : {}) } : {}) };
    }) };
  }, [effective, matching, layout, showOrphans, filters?.neighbors, filters?.value.showHidden]);
  const colors = useMemo(() => graphColorGroups(graphData.nodes, notebooks, appearance), [graphData, notebooks, appearance]);
  const nodeColor = useCallback((node: NoteGraphNode) => colors.find(group => group.key === graphColorGroup(node, notebooks, appearance.mode).key)?.color || '#94a3b8', [colors, notebooks, appearance]);
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
  const freeze = () => { frozen.current = true; interacted.current = true; for (const node of graphData.nodes as Node[]) { node.fx = node.x; node.fy = node.y; } };
  const reflow = (next: GraphLayout) => {
    const visible = new Set(graphData.nodes.map(node => node.id));
    const arranged = arrangeGraphLayout({ nodes: next.nodes.filter(node => visible.has(node.path)) }, { compact: true });
    const byPath = new Map(arranged.nodes.map(node => [node.path, node]));
    return { nodes: next.nodes.map(node => byPath.get(node.path) || node) };
  };
  const finishClosing = (path: string) => {
    clearTimeout(closeTimers.current.get(path)); closeTimers.current.delete(path);
    setClosing(previous => { const next = new Set(previous); next.delete(path); return next; });
    setMaximized(previous => previous === path ? null : previous);
  };
  const setExpanded = (paths: string[], value: boolean) => {
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
  const select = (path: string, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => setSelected(previous => event.shiftKey || event.ctrlKey || event.metaKey ? previous.includes(path) ? previous.filter(id => id !== path) : [...previous, path] : [path]);
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
    if (!layout.nodes.length || fitted.current || interacted.current) return;
    const timer = setTimeout(() => { if (!interacted.current) { resetView(); fitted.current = true; } }, 100);
    return () => clearTimeout(timer);
  }, [layout.nodes.length, size.width, size.height, laneKey]);
  const frameSignature = useRef('');
  const frame = () => {
    paintMinimap(); if (!fg.current) return;
    for (const node of graphData.nodes as Node[]) if (node.x !== undefined && node.y !== undefined) positions.current.set(node.id, { path: node.id, x: node.x, y: node.y });
    const origin = fg.current.graph2ScreenCoords(0, 0), k = fg.current.zoom();
    const signature = `${origin.x},${origin.y},${k}:` + graphData.nodes.filter(n => expanded.has(n.id)).map(n => `${n.x},${n.y}`).join(';');
    if (frameSignature.current !== signature) { frameSignature.current = signature; setTransform({ ...origin, k }); redraw(v => v + 1); }
  };
  const point = (event: { clientX: number; clientY: number }) => { const box = container.current!.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top }; };
  const link = (source: string, target: NoteItem) => {
    const note = notes.find(note => note.path === source); if (!note || !editing?.writable) return;
    const draft = editing.store.get(note); if (draft.blocked) return;
    const result = insertNoteLink(draft.draft.content, source, target.path, target.title, carets.current.get(source));
    if (result.content === draft.draft.content) { setNotice(t('graph.linkExists')); return; }
    editing.store.edit(note, result.content); carets.current.set(source, result.position); setNotice(t('graph.linkAdded'));
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
    if (!editing?.writable || event.button !== 0) return;
    event.stopPropagation(); const start = point(event); freeze();
    setGesture({ kind: 'link', start, end: start, source });
    const move = (e: PointerEvent) => setGesture({ kind: 'link', start, end: point(e), source });
    const finish = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); setGesture(null);
      if (Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 5) return;
      const element = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-graph-note]');
      let target = element?.getAttribute('data-graph-note');
      if (!target) { const p = point(e); const nearest = (graphData.nodes as Node[]).find(n => n.x !== undefined && Math.hypot(n.x * transform.k + transform.x - p.x, n.y! * transform.k + transform.y - p.y) < 18); target = nearest?.id; }
      const note = notes.find(n => n.path === target); if (note) link(source, note);
    };
    const cancel = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); setGesture(null); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel);
  };
  const visibleSelected = selected.filter(path => graphData.nodes.some(node => node.id === path));
  const selectLane = (id: string) => { const next = new URLSearchParams(params); next.delete('lanes'); next.delete('laneScope'); if (id) next.set('lanes', id); setParams(next); };
  const changeMembership = (add: boolean) => {
    if (!screen?.writable || activeLane?.kind !== 'custom') return;
    const selectedSet = new Set(visibleSelected);
    const items = add ? [...activeLane.items, ...notes.filter(note => selectedSet.has(note.path) && !activeLane.items.some(item => item.kind === 'note' && item.path === note.path && item.notebookId === note.notebookId)).map(note => ({ id: crypto.randomUUID(), kind: 'note' as const, path: note.path, notebookId: note.notebookId }))]
      : activeLane.items.filter(item => item.kind !== 'note' || !selectedSet.has(item.path));
    screen.change({ ...screen.page, rows: screen.page.rows.map(row => row.id === activeLane.id ? { ...activeLane, items } : row) });
  };
  const openFullGraph = async () => { try { await editing?.store.flushAll(); navigate(`/graph?notebook=all&lanes=${encodeURIComponent(lane!.id)}`); } catch (error) { setNotice((error as Error).message); } };
  const hoveredNode = graphData.nodes.find(node => node.id === hover && !expanded.has(node.id) && !closing.has(node.id));
  const saveLane = () => {
    if (!screen?.writable || !name.trim() || !visibleSelected.length) return;
    const id = crypto.randomUUID(), current = currentLayout();
    const row: ScreenRow = { id, kind: 'custom', name: name.trim(), view: 'graph', items: visibleSelected.map(path => ({ id: crypto.randomUUID(), kind: 'note', notebookId: notes.find(n => n.path === path)!.notebookId, path })), graph: { nodes: current.nodes.filter(n => visibleSelected.includes(n.path)) } };
    const next = ScreenPageSchema.safeParse({ ...screen.page, rows: [...screen.page.rows, row] });
    if (!next.success) { setNotice(t('screen.limit')); return; }
    screen.change(next.data); setSaveOpen(false); setNotice(t('graph.laneCreated'));
  };
  const filtersElement = filters ? <GraphFilters {...filters} count={matching.length} showOrphans={showOrphans} onToggleOrphans={() => setShowOrphans(v => !v)} extraCount={laneIds.length}>
    <fieldset><legend>{t('graph.lanes')}</legend>{[...new Set([...rows.map(row => row.id), ...laneIds])].map(id => <label className="filter-check" key={id}><input type="checkbox" checked={laneIds.includes(id)} onChange={() => { const next = new URLSearchParams(params); next.delete('lanes'); (laneIds.includes(id) ? laneIds.filter(v => v !== id) : [...laneIds, id]).forEach(value => next.append('lanes', value)); setParams(next); }} />{rows.find(row => row.id === id)?.name || t('screen.laneMissing')}</label>)}</fieldset>
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
  }} onWheelCapture={() => { interacted.current = true; }} onPointerDownCapture={event => { if ((event.target as Element).tagName === 'CANVAS') { interacted.current = true; container.current?.focus({ preventScroll: true }); } }}>
    {!lane && <GraphControls controlsRef={controls} filterPanel={filtersElement} appearance={appearance} onAppearanceChange={changeAppearance} visibleColorGroups={colors} appearanceSaveError={appearanceError} />}
    {!lane && <div className="graph-selection-toolbar" role="toolbar" aria-label={t('graph.tools')}>
      <GraphTool label={t('graph.boxSelect')} pressed={boxMode} onClick={() => setBoxMode(v => !v)}><Scan size={18} /></GraphTool>
      <GraphTool label={`${t('graph.selectNotes')} (${visibleSelected.length})`} pressed={pickerOpen} onClick={() => { setPickerOpen(v => !v); setLanePanel(false); }}><ListChecks size={18} /><small>{visibleSelected.length || ''}</small></GraphTool>
      <GraphTool label={t('graph.expand')} disabled={!visibleSelected.length} onClick={() => setExpanded(visibleSelected, true)}><PanelTopOpen size={18} /></GraphTool>
      <GraphTool label={t('graph.collapse')} disabled={!visibleSelected.length} onClick={() => setExpanded(visibleSelected, false)}><PanelTopClose size={18} /></GraphTool>
      <GraphTool label={t(only ? 'graph.showAll' : 'graph.onlySelected')} pressed={Boolean(only)} disabled={!visibleSelected.length && !only} onClick={() => setOnly(only ? null : visibleSelected)}><Focus size={18} /></GraphTool>
      <GraphTool label={t('graph.saveLane')} disabled={!visibleSelected.length || !screen?.writable} onClick={() => { setName(''); setSaveOpen(true); }}><Save size={18} /></GraphTool>
      <GraphTool label={t('graph.arrange')} onClick={() => {
        freeze();
        const arranged = reflow(currentLayout()); persistLayout(arranged); requestAnimationFrame(() => fitView(arranged));
      }}><LayoutGrid size={18} /></GraphTool>
      <GraphTool label={t('graph.chooseLane')} pressed={lanePanel || Boolean(activeLane)} onClick={() => { setLanePanel(v => !v); setPickerOpen(false); }}><PanelsTopLeft size={18} /></GraphTool>
      {activeLane && <GraphTool label={t('screen.editRow')} disabled={!screen?.writable} onClick={() => setEditLane(true)}><Pencil size={18} /></GraphTool>}
    </div>}
    {lane && <div className="graph-fullscreen-tool"><GraphTool label={t('graph.openLaneGraph')} onClick={() => void openFullGraph()}><Maximize2 size={18} /></GraphTool></div>}
    {!lane && lanePanel && <section className="graph-lane-panel" aria-label={t('graph.chooseLane')}>
      <header><strong>{activeLane?.name || t('graph.lanes')}</strong><button aria-label={t(activeLane ? 'graph.minimizeLane' : 'common.close')} title={t(activeLane ? 'graph.minimizeLane' : 'common.close')} onClick={() => setLanePanel(false)}>{activeLane ? <Minus size={16} /> : <X size={16} />}</button></header>
      <select aria-label={t('graph.chooseLane')} value={activeLane?.id || ''} onChange={event => selectLane(event.target.value)}><option value="">{t('graph.allLanes')}</option>{rows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
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
    {editLane && activeLane && screen && <ScreenEditRow row={activeLane} notebooks={notebooks} notes={notes} assets={[]} folders={folders} selectedNotebookId={filters?.value.notebookId === 'all' ? notebooks[0]?.id || '' : filters?.value.notebookId || notebooks[0]?.id || ''} disabled={!screen.writable} onClose={() => setEditLane(false)} onApply={row => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id === row.id ? row : value) })} onRemove={() => { screen.change({ ...screen.page, rows: screen.page.rows.filter(row => row.id !== activeLane.id) }); selectLane(''); }} />}
    {pickerOpen && <div className="graph-note-selector" style={activeLane ? { top: 124 } : undefined}>{graphData.nodes.map(node => <label key={node.id}><input type="checkbox" checked={selected.includes(node.id)} onChange={() => select(node.id, { shiftKey: true })} />{node.title}</label>)}</div>}
    {notice && <div role="status" className="graph-notice" onClick={() => setNotice('')}>{notice}</div>}
    <ForceGraph2D ref={fg} width={size.width} height={size.height} graphData={graphData} nodeId="id" cooldownTicks={80}
      onRenderFramePost={frame} onEngineStop={() => { captureLaneGeometry(); if (!fitted.current && !interacted.current) { fitted.current = true; resetView(); } }}
      onNodeDragEnd={node => { freeze(); const next = currentLayout(); const saved = next.nodes.find(n => n.path === node.id); if (saved) saved.pinned = true; persistLayout(next); }}
      onNodeClick={(node, event) => select(node.id, event)} onNodeHover={node => { clearTimeout(hoverTimer.current); if (node) setHover(node.id); else hoverTimer.current = setTimeout(() => setHover(null), 250); }}
      onBackgroundClick={() => setSelected([])}
      nodeCanvasObject={(node: Node, ctx, scale) => {
        if (expanded.has(node.id) || closing.has(node.id)) return;
        const x = node.x || 0, y = node.y || 0, radius = selected.includes(node.id) ? 9 : 6;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = nodeColor(node); ctx.globalAlpha = showOutside && laneIds.length && !laneMembers.has(node.id) ? .25 : node.external ? .4 : 1; ctx.fill();
        if (selected.includes(node.id)) { ctx.strokeStyle = isDark ? '#fff' : '#222'; ctx.lineWidth = 2 / scale; ctx.stroke(); }
        ctx.font = `${12 / scale}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = isDark ? '#cbd5e1' : '#475569';
        ctx.fillText(node.title, x, y + radius + 15 / scale); ctx.globalAlpha = 1;
      }} nodePointerAreaPaint={(node: Node, color, ctx) => { if (expanded.has(node.id)) return; ctx.beginPath(); ctx.arc(node.x || 0, node.y || 0, 12, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }}
      linkCanvasObjectMode={() => 'replace'} linkCanvasObject={(edge: any, ctx, scale) => {
        const a = edge.source as Node, b = edge.target as Node; if (a.x === undefined || b.x === undefined) return;
        const end = (from: Node, to: Node) => { const card = layout.nodes.find(n => n.path === from.id && n.expanded); const dx = to.x! - from.x!, dy = to.y! - from.y!; const factor = card ? Math.min((card.width || 360) / 2 / (Math.abs(dx) || 1e-9), (card.height || 300) / 2 / (Math.abs(dy) || 1e-9)) : 8 / Math.max(1, Math.hypot(dx, dy)); return { x: from.x! + dx * Math.min(.49, factor), y: from.y! + dy * Math.min(.49, factor) }; };
        const start = end(a,b), stop = end(b,a), angle = Math.atan2(stop.y-start.y, stop.x-start.x);
        const pending = editing?.store.entries.get(a.id)?.dirty;
        ctx.strokeStyle = isDark ? '#64748b' : '#94a3b8'; ctx.lineWidth = (hover === a.id || hover === b.id ? 2 : 1) / scale; ctx.setLineDash(pending ? [5/scale,4/scale] : []);
        ctx.beginPath(); ctx.moveTo(start.x,start.y); ctx.lineTo(stop.x,stop.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(stop.x,stop.y); ctx.lineTo(stop.x-Math.cos(angle-.45)*8/scale,stop.y-Math.sin(angle-.45)*8/scale); ctx.moveTo(stop.x,stop.y); ctx.lineTo(stop.x-Math.cos(angle+.45)*8/scale,stop.y-Math.sin(angle+.45)*8/scale); ctx.stroke();
      }} />
    {graphData.nodes.filter(node => expanded.has(node.id) || closing.has(node.id)).map(node => {
      const card = layout.nodes.find(n => n.path === node.id)!, note = notes.find(n => n.path === node.id)!;
      const large = maximized === node.id, w = card.width || 360, h = card.height || 300;
      return <div key={node.id} onAnimationEnd={event => {
        if (event.animationName === 'graph-note-exit' && closing.has(node.id) && (event.target as HTMLElement).classList.contains('graph-note-card')) finishClosing(node.id);
      }} className={`graph-card-position ${closing.has(node.id) ? 'is-closing' : ''} ${large ? 'is-maximized' : ''} ${showOutside && laneIds.length && !laneMembers.has(node.id) ? 'is-outside-lane' : ''}`} style={large ? { inset: 8, zIndex: 80 } : { left: (node.x || 0)*transform.k+transform.x-w*transform.k/2, top: (node.y || 0)*transform.k+transform.y-h*transform.k/2, width:w, height:h, transform:`scale(${transform.k})`, zIndex:selected.includes(node.id) ? 24 : 20 }}>
        <GraphNoteCard note={note} notes={notes} color={nodeColor(node)} editing={editing} selected={selected.includes(node.id)} maximized={large} onSelect={event => select(node.id,event)} onCaret={position => carets.current.set(node.id,position)}
          onMove={event => drag(event,node.id,'move')} onResize={event => drag(event,node.id,'resize')} onConnect={event => startLink(event,node.id)} onLink={target => link(node.id,target)} onCollapse={() => setExpanded([node.id],false)} onMaximize={() => setMaximized(large ? null : node.id)} />
      </div>;
    })}
    {hoveredNode && <button className="ui-button graph-hover-expand" style={{ left: (hoveredNode.x || 0) * transform.k + transform.x + 14, top: (hoveredNode.y || 0) * transform.k + transform.y - 14 }} title={t('graph.expandEnter')} aria-label={`${t('graph.expand')}: ${hoveredNode.title}`} onMouseEnter={() => clearTimeout(hoverTimer.current)} onMouseLeave={() => setHover(null)} onClick={() => { setExpanded([hoveredNode.id], true); setHover(null); }}><PanelTopOpen size={16} /></button>}
    {boxMode && <div className="graph-box-layer" onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); const start = point(event); setGesture({ kind:'box',start,end:start }); }}
      onPointerMove={event => { if (gesture?.kind === 'box') setGesture({ ...gesture,end:point(event) }); }}
      onPointerCancel={() => setGesture(null)} onPointerUp={event => {
        if (gesture?.kind !== 'box') return;
        const end = point(event), { start } = gesture;
        const paths = graphData.nodes.filter(node => { const x=(node.x||0)*transform.k+transform.x,y=(node.y||0)*transform.k+transform.y; return x>=Math.min(start.x,end.x)&&x<=Math.max(start.x,end.x)&&y>=Math.min(start.y,end.y)&&y<=Math.max(start.y,end.y); }).map(n=>n.id);
        setSelected(event.shiftKey ? [...new Set([...selected,...paths])] : paths); setGesture(null); setBoxMode(false);
      }} />}
    {gesture && <svg className="graph-gesture" width={size.width} height={size.height}>{gesture.kind === 'box' ? <rect x={Math.min(gesture.start.x,gesture.end.x)} y={Math.min(gesture.start.y,gesture.end.y)} width={Math.abs(gesture.end.x-gesture.start.x)} height={Math.abs(gesture.end.y-gesture.start.y)} fill="#818cf833" stroke="#818cf8" /> : <line x1={gesture.start.x} y1={gesture.start.y} x2={gesture.end.x} y2={gesture.end.y} stroke="#818cf8" strokeWidth="2" />}</svg>}
    {!graphData.nodes.length && <p className="graph-empty" role="status">{t('filters.graphEmpty')}</p>}
    <div className="graph-minimap-panel"><div className="graph-stats" role="status" data-filter-results={matching.length} data-graph-nodes={graphData.nodes.length} data-graph-links={graphData.links.length}>
      <button className="ui-icon-button" aria-label={t('graph.resetZoom')} title={t('graph.resetZoom')} onClick={resetView}>↺</button><span>{graphData.nodes.length} ●</span><span>{graphData.links.length} ↗</span></div>{minimap}</div>
    {editing && [...editing.store.entries.values()].some(entry => entry.dirty && !graphData.nodes.some(node => node.id === entry.draft.path && expanded.has(node.id))) && <div className="graph-pending-notes">{[...editing.store.entries.values()].filter(entry => entry.dirty && !graphData.nodes.some(node => node.id === entry.draft.path && expanded.has(node.id))).map(entry => <button key={entry.draft.path} onClick={async () => { try { await editing.store.flushAll(); onOpenNote(entry.draft); } catch(error) { setNotice((error as Error).message); } }}>{entry.draft.title} · {t('graph.pending')}</button>)}</div>}
    {saveOpen && <WorkspaceDialog title={t('graph.saveLane')} onClose={() => setSaveOpen(false)}><input className="ui-control" autoFocus aria-label={t('screen.rowName')} value={name} onChange={event=>setName(event.target.value)} maxLength={100} /><div className="workspace-dialog-actions"><button className="ui-button" disabled={!name.trim()} onClick={saveLane}>{t('graph.saveLane')}</button></div></WorkspaceDialog>}
  </div>;
}
