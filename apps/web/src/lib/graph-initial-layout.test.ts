import { expect, it } from 'vitest';
import { initializeGraphLayout } from './graph-initial-layout.js';

const graph = {
  nodes: Array.from({ length: 6 }, (_, i) => ({ id: String(i), title: String(i), notebookId: 'a', tags: [], inDegree: 0, outDegree: 0, val: 3 })),
  links: [{ source: '0', target: '1' }, { source: '1', target: '2' }, { source: '3', target: '4' }, { source: '4', target: '5' }],
};
it('computes a separated, deterministic layout before the renderer starts', () => {
  const result = initializeGraphLayout(graph, { nodes: [] });
  expect(new Set(result.nodes.map(n => `${n.x},${n.y}`)).size).toBe(6);
  expect(result).toEqual(initializeGraphLayout(graph, { nodes: [] }));
  expect(result.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
});
it('keeps saved and cached coordinates when adding nodes without making them permanently pinned', () => {
  const known = { nodes: [{ path: '0', x: 200, y: 300, expanded: true, width: 600, height: 400 }] };
  const before = structuredClone(known);
  const result = initializeGraphLayout(graph, known);
  expect(result.nodes[0]).toEqual(known.nodes[0]);
  expect(result.nodes.slice(1).every(n => Math.abs(n.x - 200) >= 340 || Math.abs(n.y - 300) >= 240)).toBe(true);
  expect(result.nodes.some(n => n.pinned)).toBe(false);
  expect(known).toEqual(before);
});
it('restores exact positions through filtering and handles empty data', () => {
  const known = initializeGraphLayout(graph, { nodes: [] });
  expect(initializeGraphLayout({ ...graph, nodes: graph.nodes.slice(0, 2) }, known).nodes).toEqual(known.nodes.slice(0, 2));
  expect(initializeGraphLayout(graph, known)).toEqual(known);
  expect(initializeGraphLayout({ nodes: [], links: [] }, known)).toEqual({ nodes: [] });
});
