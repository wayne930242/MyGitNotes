import { createGraphInteractions } from './createGraphInteractions.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type GraphLayout, ScreenPageSchema, type ScreenRow } from '@mygitnotes/core/screen-page';
import { arrangeGraphLayout, graphLaneViewport } from '../../lib/graph-layout.js';
import { optimizeGraphLayout } from '../../lib/graph-topology-layout.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { GRAPH_APPEARANCE_KEY, type GraphAppearance, readGraphAppearance } from '../../lib/graph-colors.js';
import { useGraphMinimap } from './useGraphMinimap.js';
import { useGraphNoteSessions } from './useGraphNoteSessions.js';
import { useLaneSelection } from './useLaneSelection.js';
import type { GraphGesture, GraphPageProps, LayoutNode, Node } from './types.js';
import { useGraphData } from './useGraphData.js';
export function useGraphController({ notebooks, filters, screen, lane, folders = [] }: GraphPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { params, setParams, laneIds, laneKey, activeLane, showOutside, lanePanel, setLanePanel, editLane, setEditLane, rows, laneRows, selectLane } = useLaneSelection({ lane, screen, filters });
  const [saveLayoutRequested, setSaveLayoutRequested] = useState(false);
  const [closing, setClosing] = useState<Set<string>>(() => new Set());
  const closeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [closingLane, setClosingLane] = useState(laneKey);
  if (closingLane !== laneKey) {
    setClosingLane(laneKey);
    setClosing(new Set());
  }
  useEffect(() => {
    const timers = closeTimers.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
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
  const positions = useRef(new Map<string, LayoutNode>());
  const fitted = useRef(false), interacted = useRef(false);
  const [gesture, setGesture] = useState<GraphGesture | null>(null);
  const latest = useRef({ screen, layout });
  /* eslint-disable react/refs -- The force-graph adapter keeps imperative graph state and current layout in refs for canvas callbacks. */
  latest.current = { screen, layout };
  /* eslint-enable react/refs */
  /* eslint-disable react-hooks/exhaustive-deps -- Only lane identity resets selection and mutable canvas positions; graph snapshot updates have a separate layout synchronization effect. */
  useLayoutEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Canvas positions, fit flags and React layout must reset together in the layout phase before the new lane is painted. */
    setLayout(activeLane?.graph || { nodes: [] });
    /* eslint-enable react/set-state-in-effect */
    setSelected([]);
    setOnly(null);
    setMaximized(null);
    positions.current.clear();
    fitted.current = false;
    interacted.current = false;
  }, [laneKey]);
  /* eslint-enable react-hooks/exhaustive-deps */
  useLayoutEffect(() => {
    if (activeLane?.graph && JSON.stringify(activeLane.graph) !== JSON.stringify(latest.current.layout)) setLayout(activeLane.graph);
  }, [activeLane?.graph]);
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const measure = () => setSize({ width: host.clientWidth || 800, height: host.clientHeight || 600 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  // The filter bar grows as it wraps or gains filter chips; the tools below it follow its height.
  useEffect(() => {
    const host = container.current, bar = controls.current;
    if (!host || !bar) return;
    const measure = () => host.style.setProperty('--graph-controls-height', `${bar.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [lane]);
  // Expanded cards host the notes' editors; their sessions drive the pending edges and link insertion.
  const { editing, sessions, updateSession, editorRef, carets, link } = useGraphNoteSessions({ t, onNotice: setNotice });
  // Nodes and links come from the server; the filter, the visible set and lane membership are
  // path queries, and unsaved drafts are laid over the answer.
  const { graphSource, scopeNotebook, filterQuery, matchingPaths, visiblePaths, shownLanes, lanePaths, editingDrafts, graph, matching, laneMembers, expanded, graphData, colors, nodeColor } = useGraphData({ notebooks, filters, lane, activeLane, rows, laneIds, laneKey, showOutside, sessions, only, layout, showOrphans, positions, appearance });
  const changeAppearance = (value: GraphAppearance) => {
    setAppearance(value);
    try {
      localStorage.setItem(GRAPH_APPEARANCE_KEY, JSON.stringify(value));
      setAppearanceError(false);
    } catch {
      setAppearanceError(true);
    }
  };
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
  const saveLayout = screen?.save, layoutSaving = screen?.saving, layoutPage = screen?.page;

  useEffect(() => {
    if (!saveLayoutRequested || !saveLayout || layoutSaving) return;
    /* eslint-disable react/set-state-in-effect -- The queued save waits for the committed screen page and any current save; consuming it in the click handler would save the previous layout. */
    setSaveLayoutRequested(false);
    /* eslint-enable react/set-state-in-effect */
    void saveLayout();
  }, [saveLayoutRequested, layoutSaving, layoutPage, saveLayout]);

  const freeze = () => {
    interacted.current = true;
    for (const node of graphData.nodes as Node[]) {
      /* eslint-disable react/immutability -- Force-graph owns mutable simulation nodes; pinning writes its documented fx/fy coordinates. */
      node.fx = node.x;
      /* eslint-enable react/immutability */
      node.fy = node.y;
    }
  };
  const reflow = (next: GraphLayout, topology = false) => {
    const visible = new Set(graphData.nodes.map(node => node.id));
    const visibleLayout = { nodes: next.nodes.filter(node => visible.has(node.path)) };
    const arranged = topology ? optimizeGraphLayout(visibleLayout, graphData.links) : arrangeGraphLayout(visibleLayout, { compact: true });
    const byPath = new Map(arranged.nodes.map(node => [node.path, node]));
    return { nodes: next.nodes.map(node => byPath.get(node.path) || node) };
  };
  const finishClosing = (path: string) => {
    clearTimeout(closeTimers.current.get(path));
    closeTimers.current.delete(path);
    setClosing(previous => {
      const next = new Set(previous);
      next.delete(path);
      return next;
    });
    setMaximized(previous => previous === path ? null : previous);
  };
  // Collapsing unmounts the card's editor, so its pending edits are saved first and a failed save keeps the card open.
  const setExpanded = async (paths: string[], value: boolean) => {
    if (!value && !await editing.flushEditors(paths)) return;
    freeze();
    const next = currentLayout();
    for (const path of paths) {
      clearTimeout(closeTimers.current.get(path));
      closeTimers.current.delete(path);
      if (!value && expanded.has(path) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setClosing(previous => new Set(previous).add(path));
        // Animation completion owns unmounting. The longer fallback only handles
        // cancelled animations (for example, changing reduced-motion settings).
        closeTimers.current.set(path, setTimeout(() => finishClosing(path), 1500));
      } else {setClosing(previous => {
          const next = new Set(previous);
          next.delete(path);
          return next;
        });}
      let node = next.nodes.find(node => node.path === path);
      if (!node) {
        node = { path, x: 0, y: 0 };
        next.nodes.push(node);
      }
      node.expanded = value;
      node.width ||= 360;
      node.height ||= 300;
    }
    const arranged = value ? reflow(next) : next;
    persistLayout(arranged);
    if (!value && maximized && paths.includes(maximized) && !closeTimers.current.has(maximized)) setMaximized(null);
    if (value && !lane) requestAnimationFrame(() => fitView(arranged));
  };
  const additive = (event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; }) => Boolean(event.shiftKey || event.ctrlKey || event.metaKey);
  const select = (path: string, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; }) => setSelected(previous => additive(event) ? previous.includes(path) ? previous.filter(id => id !== path) : [...previous, path] : [path]);
  const fitView = (next: GraphLayout) => {
    if (!fg.current) return;
    const visible = new Set(graphData.nodes.map(node => node.id));
    if (lane) {
      const view = graphLaneViewport({ nodes: next.nodes.filter(node => visible.has(node.path)) }, size.width);
      const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250;
      fg.current.centerAt(view.x, view.y, duration);
      fg.current.zoom(view.zoom, duration);
      return;
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
  /* eslint-disable react-hooks/exhaustive-deps -- The 200 ms measurement reads current simulation coordinates after dragging settles; render-created helper identity must not restart the timer. */
  useEffect(() => {
    if (!lane || cardDragging) return;
    // Wait for pointer movement to settle; resizing the canvas during a drag
    // would move the camera beneath the pointer.
    const timer = setTimeout(captureLaneGeometry, 200);
    return () => clearTimeout(timer);
  }, [lane, layout, closing, graphData, cardDragging]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const isLane = Boolean(lane);
  const { x: viewportX, y: viewportY, zoom: viewportZoom, height: viewportHeight } = laneViewport;

  useEffect(() => {
    if (!isLane || !fg.current) return;
    const timer = setTimeout(() => {
      const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250;
      fg.current.centerAt(viewportX, viewportY, duration);
      fg.current.zoom(viewportZoom, duration);
    }, 30);
    return () => clearTimeout(timer);
  }, [viewportHeight, viewportX, viewportY, viewportZoom, size.width, size.height, isLane]);

  const { paintMinimap, minimap } = useGraphMinimap({
    graphRef: fg,
    graphData,
    dimensions: size,
    isDark,
    nodeColor,
    onClearHover: () => setHover(null),
    onReset: resetView,
    onNavigate: () => {
      interacted.current = true;
    },
  });
  /* eslint-disable react-hooks/exhaustive-deps -- Initial fit runs for node-count, viewport or lane changes; observing every layout/helper recreation would move the camera during interaction. */
  useEffect(() => {
    if (!graphData.nodes.length || fitted.current || interacted.current) return;
    const timer = setTimeout(() => {
      if (!interacted.current) {
        resetView();
        fitted.current = true;
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [graphData.nodes.length, size.width, size.height, laneKey]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const frameSignature = useRef('');
  const frame = () => {
    paintMinimap();
    if (!fg.current) return;
    for (const node of graphData.nodes as Node[]) if (node.x !== undefined && node.y !== undefined) positions.current.set(node.id, { path: node.id, x: node.x, y: node.y });
    const origin = fg.current.graph2ScreenCoords(0, 0), k = fg.current.zoom();
    const signature = `${origin.x},${origin.y},${k}:` + graphData.nodes.filter(n => expanded.has(n.id)).map(n => `${n.x},${n.y}`).join(';');
    if (frameSignature.current !== signature) {
      frameSignature.current = signature;
      setTransform({ ...origin, k });
      redraw(v => v + 1);
    }
  };
  const { point, selectBox, startBox, drag, startLink } = createGraphInteractions({ container, fg, graphData, transform, expanded, setSelected, setGesture, additive, maximized, freeze, setCardDragging, currentLayout, persistLayout, setLayout, reflow, sessions, link });
  const graphLoading = graphSource.loading || matchingPaths.loading || visiblePaths.loading || lanePaths.loading;
  const visibleSelected = selected.filter(path => graphData.nodes.some(node => node.id === path));
  const changeMembership = (add: boolean) => {
    if (!screen?.writable || activeLane?.kind !== 'custom') return;
    const selectedSet = new Set(visibleSelected);
    const items = add ? [...activeLane.items, ...graphData.nodes.filter(node => selectedSet.has(node.id) && !activeLane.items.some(item => item.kind === 'note' && item.path === node.id && item.notebookId === node.notebookId)).map(node => ({ id: crypto.randomUUID(), kind: 'note' as const, path: node.id, notebookId: node.notebookId }))] : activeLane.items.filter(item => item.kind !== 'note' || !selectedSet.has(item.path));
    screen.change({ ...screen.page, rows: screen.page.rows.map(row => row.id === activeLane.id ? { ...activeLane, items } : row) });
  };
  const openFullGraph = async () => {
    if (await editing.flushEditors()) navigate(`/graph?notebook=${encodeURIComponent(lane!.notebookId)}&lanes=${encodeURIComponent(lane!.id)}`);
  };
  const hoveredNode = graphData.nodes.find(node => node.id === hover && !expanded.has(node.id) && !closing.has(node.id));
  const selectedNotebooks = new Set(visibleSelected.map(path => graphData.nodes.find(node => node.id === path)?.notebookId));
  const saveNotebook = selectedNotebooks.size === 1 ? [...selectedNotebooks][0] : undefined;
  const saveLane = () => {
    if (!screen?.writable || !name.trim() || !saveNotebook) return;
    const id = crypto.randomUUID(), current = currentLayout();
    const row: ScreenRow = { id, kind: 'custom', name: name.trim(), view: 'graph', notebookId: saveNotebook, items: visibleSelected.map(path => ({ id: crypto.randomUUID(), kind: 'note', notebookId: saveNotebook, path })), graph: { nodes: current.nodes.filter(n => visibleSelected.includes(n.path)) } };
    const next = ScreenPageSchema.safeParse({ ...screen.page, rows: [...screen.page.rows, row] });
    if (!next.success) {
      setNotice(t('screen.limit'));
      return;
    }
    screen.change(next.data);
    setSaveOpen(false);
    setNotice(t('graph.laneCreated'));
  };

  const onDoubleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as Element).tagName !== 'CANVAS') return;
    const box = container.current!.getBoundingClientRect();
    const cursor = fg.current?.screen2GraphCoords(event.clientX - box.left, event.clientY - box.top);
    const node = cursor && (graphData.nodes as Node[]).find(node => node.x !== undefined && Math.hypot(node.x - cursor.x, node.y! - cursor.y) < 12 / fg.current.zoom());
    if (node && !expanded.has(node.id) && !closing.has(node.id)) setExpanded([node.id], true);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || !visibleSelected.length || (event.target as Element).closest('button,input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
    event.preventDefault();
    setExpanded(visibleSelected, !visibleSelected.every(path => expanded.has(path)));
  };
  const onWheelCapture = () => {
    interacted.current = true;
  };
  const onPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).tagName === 'CANVAS') {
      interacted.current = true;
      container.current?.focus({ preventScroll: true });
    }
    startBox(event);
  };
  const onEngineStop = () => {
    captureLaneGeometry();
    if (graphData.nodes.length && !fitted.current && !interacted.current) {
      fitted.current = true;
      resetView();
    }
  };
  const onNodeHover = (node: Node | null) => {
    clearTimeout(hoverTimer.current);
    if (node) setHover(node.id);
    else hoverTimer.current = setTimeout(() => setHover(null), 250);
  };
  return { onNodeHover, onEngineStop, onPointerDownCapture, onWheelCapture, onKeyDown, onDoubleClickCapture, notebooks, filters, screen, lane, folders, t, navigate, params, setParams, laneIds, laneKey, activeLane, showOutside, lanePanel, setLanePanel, editLane, setEditLane, rows, laneRows, selectLane, saveLayoutRequested, setSaveLayoutRequested, closing, setClosing, closeTimers, hoverTimer, container, controls, fg, cardDragging, setCardDragging, laneGeometry, setLaneGeometry, size, setSize, transform, setTransform, redraw, selected, setSelected, only, setOnly, layout, setLayout, showOrphans, setShowOrphans, boxMode, setBoxMode, maximized, setMaximized, hover, setHover, saveOpen, setSaveOpen, name, setName, notice, setNotice, pickerOpen, setPickerOpen, appearance, setAppearance, appearanceError, setAppearanceError, positions, fitted, interacted, gesture, setGesture, latest, editing, sessions, updateSession, editorRef, carets, link, graphSource, scopeNotebook, filterQuery, matchingPaths, visiblePaths, shownLanes, lanePaths, editingDrafts, graph, matching, laneMembers, expanded, graphData, colors, nodeColor, changeAppearance, isDark, currentLayout, persistLayout, freeze, reflow, finishClosing, setExpanded, additive, select, fitView, resetView, captureLaneGeometry, laneViewport, paintMinimap, minimap, frameSignature, frame, point, selectBox, startBox, drag, startLink, graphLoading, visibleSelected, changeMembership, openFullGraph, hoveredNode, selectedNotebooks, saveNotebook, saveLane };
}
