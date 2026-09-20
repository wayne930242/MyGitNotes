import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { GraphLayout } from '@mygitnotes/core/screen-page';
import type { GraphGesture, Node } from './types.js';
import type { useGraphData } from './useGraphData.js';
import type { useGraphNoteSessions } from './useGraphNoteSessions.js';

interface GraphInteractionOptions {
  container: RefObject<HTMLDivElement>;
  fg: MutableRefObject<any>;
  graphData: ReturnType<typeof useGraphData>['graphData'];
  transform: { x: number; y: number; k: number; };
  expanded: Set<string>;
  setSelected: Dispatch<SetStateAction<string[]>>;
  setGesture: Dispatch<SetStateAction<GraphGesture | null>>;
  additive: (event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; }) => boolean;
  maximized: string | null;
  freeze: () => void;
  setCardDragging: Dispatch<SetStateAction<boolean>>;
  currentLayout: () => GraphLayout;
  persistLayout: (next: GraphLayout) => void;
  setLayout: Dispatch<SetStateAction<GraphLayout>>;
  reflow: (next: GraphLayout, topology?: boolean) => GraphLayout;
  sessions: ReturnType<typeof useGraphNoteSessions>['sessions'];
  link: ReturnType<typeof useGraphNoteSessions>['link'];
}

export function createGraphInteractions({ container, fg, graphData, transform, expanded, setSelected, setGesture, additive, maximized, freeze, setCardDragging, currentLayout, persistLayout, setLayout, reflow, sessions, link }: GraphInteractionOptions) {
  const point = (event: { clientX: number; clientY: number; }) => {
    const box = container.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const selectBox = (start: { x: number; y: number; }, end: { x: number; y: number; }, add: boolean) => {
    const paths = graphData.nodes.filter(node => {
      const x = (node.x || 0) * transform.k + transform.x, y = (node.y || 0) * transform.k + transform.y;
      return x >= Math.min(start.x, end.x) && x <= Math.max(start.x, end.x) && y >= Math.min(start.y, end.y) && y <= Math.max(start.y, end.y);
    }).map(n => n.id);
    setSelected(previous => add ? [...new Set([...previous, ...paths])] : paths);
  };
  // A modifier drag on empty canvas draws a box that adds the enclosed notes; on a node it still drags the node.
  const startBox = (event: React.PointerEvent) => {
    if (event.button !== 0 || !additive(event) || (event.target as Element).tagName !== 'CANVAS') return;
    const start = point(event), cursor = fg.current?.screen2GraphCoords(start.x, start.y);
    if (!cursor || (graphData.nodes as Node[]).some(node => !expanded.has(node.id) && node.x !== undefined && Math.hypot(node.x - cursor.x, node.y! - cursor.y) < 12)) return;
    const move = (e: PointerEvent) => setGesture({ kind: 'box', start, end: point(e) });
    const finish = (e: PointerEvent) => {
      cancel();
      if (Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) >= 5) selectBox(start, point(e), true);
    };
    const cancel = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      setGesture(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
  };
  const drag = (event: React.PointerEvent, path: string, kind: 'move' | 'resize') => {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || maximized) return;
    event.preventDefault();
    event.stopPropagation();
    freeze();
    setCardDragging(true);
    const initial = currentLayout(), saved = initial.nodes.find(node => node.path === path)!;
    let draggedLayout = initial;
    const start = point(event), k = transform.k;
    const move = (e: PointerEvent) => {
      const p = point(e), dx = (p.x - start.x) / k, dy = (p.y - start.y) / k;
      draggedLayout = { nodes: initial.nodes.map(node => node.path === path ? { ...node, pinned: true, ...(kind === 'move' ? { x: saved.x + dx, y: saved.y + dy } : { width: Math.max(240, Math.min(1600, (saved.width || 360) + dx)), height: Math.max(180, Math.min(1400, (saved.height || 300) + dy)) }) } : node) };
      setLayout(draggedLayout);
    };
    const end = () => {
      setCardDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      persistLayout(kind === 'resize' ? reflow(draggedLayout) : draggedLayout);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  const startLink = (event: React.PointerEvent, source: string) => {
    if (sessions.get(source)?.locked !== false || event.button !== 0) return;
    event.stopPropagation();
    const start = point(event);
    freeze();
    setGesture({ kind: 'link', start, end: start, source });
    const move = (e: PointerEvent) => setGesture({ kind: 'link', start, end: point(e), source });
    const finish = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      setGesture(null);
      if (Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 5) return;
      const element = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-graph-note]');
      let target = element?.getAttribute('data-graph-note');
      if (!target) {
        const p = point(e);
        const nearest = (graphData.nodes as Node[]).find(n => n.x !== undefined && Math.hypot(n.x * transform.k + transform.x - p.x, n.y! * transform.k + transform.y - p.y) < 18);
        target = nearest?.id;
      }
      const node = graphData.nodes.find(n => n.id === target);
      if (node) link(source, { path: node.id, title: node.title });
    };
    const cancel = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      setGesture(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
  };
  return { point, selectBox, startBox, drag, startLink };
}
