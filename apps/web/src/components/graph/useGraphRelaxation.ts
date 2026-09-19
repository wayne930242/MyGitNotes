import { useLayoutEffect, useRef, useState } from 'react';
import { expandGraphFocus, type GraphData, type PositionedNode } from '../../lib/graph-focus-layout.js';
import { GRAPH_RELAX_DURATION, graphMotionProgress, interpolateGraphPosition } from '../../lib/graph-motion.js';

const cloneGraph = (data: GraphData): GraphData => ({ nodes: data.nodes.map(node => ({ ...node })), links: data.links.map(link => ({ ...link, source: typeof link.source === 'object' ? (link.source as { id: string; }).id : link.source, target: typeof link.target === 'object' ? (link.target as { id: string; }).id : link.target })) });

export function useGraphRelaxation(data: GraphData, focusId: string | undefined, neighbors: Set<string>, zoom: () => number) {
  const [displayGraph, setDisplayGraph] = useState(data);
  const [isAnimating, setIsAnimating] = useState(false);
  const current = useRef(data);
  const source = useRef(data);
  const baseline = useRef<GraphData | null>(null);
  const readZoom = useRef(zoom);
  readZoom.current = zoom;

  useLayoutEffect(() => {
    if (source.current !== data) {
      source.current = data;
      baseline.current = null;
      current.current = data;
      setDisplayGraph(data);
    }
    if (!focusId && !baseline.current) {
      setIsAnimating(false);
      return;
    }
    if (!baseline.current) baseline.current = cloneGraph(current.current);
    const anchor = (current.current.nodes as PositionedNode[]).find(node => node.id === focusId);
    // Keep the node underneath the pointer still, including when switching focus mid-motion.
    const targetSource = anchor ? { ...baseline.current, nodes: baseline.current.nodes.map(node => node.id === focusId ? { ...node, x: anchor.x, y: anchor.y } : node) } : baseline.current;
    const target = expandGraphFocus(targetSource, focusId, neighbors, readZoom.current());
    const targets = new Map((target.nodes as PositionedNode[]).map(node => [node.id, node]));
    const next = cloneGraph(current.current);
    const tracks = (next.nodes as PositionedNode[]).flatMap(node => {
      const end = targets.get(node.id);
      if (node.x === undefined || node.y === undefined || end?.x === undefined || end.y === undefined) return [];
      node.fx = node.x;
      node.fy = node.y;
      return [{ node, from: { x: node.x, y: node.y }, to: { x: end.x, y: end.y } }];
    });
    current.current = next;
    setDisplayGraph(next);
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : GRAPH_RELAX_DURATION;
    const start = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = duration ? graphMotionProgress(now - start, duration) : 1;
      for (const { node, from, to } of tracks) {
        const position = interpolateGraphPosition(from, to, progress);
        node.x = node.fx = position.x;
        node.y = node.fy = position.y;
      }
      if (progress < 1) frame = requestAnimationFrame(animate);
      else setIsAnimating(false);
    };
    setIsAnimating(true);
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [data, focusId, neighbors]);

  return { displayGraph, isAnimating };
}
