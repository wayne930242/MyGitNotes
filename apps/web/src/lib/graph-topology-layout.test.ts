import { expect, it } from 'vitest';
import { optimizeGraphLayout } from './graph-topology-layout.js';
import type { GraphLayout } from '@mygitnotes/core/screen-page';

const nodes = Array.from({ length: 8 }, (_, i) => ({ path: `${i}`, x: (i % 2) * 800, y: Math.floor(i / 2) * 300 }));
const links = [0, 4].flatMap(start => Array.from({ length: 4 }, (_, i) =>
  Array.from({ length: i }, (_, j) => ({ source: `${start + i}`, target: `${start + j}` }))).flat());
links.push({ source: '3', target: '4' });
it('brings two interleaved dense communities together without mutating inputs', () => {
  const input = { nodes }, before = structuredClone(input);
  const result = optimizeGraphLayout(input, links);
  const mean = (layout: typeof input) => links.slice(0, -1).reduce((sum, link) => {
    const a = layout.nodes.find(n => n.path === link.source)!, b = layout.nodes.find(n => n.path === link.target)!;
    return sum + Math.hypot(a.x - b.x, a.y - b.y);
  }, 0) / (links.length - 1);
  expect(mean(result)).toBeLessThan(mean(input) * .6);
  expect(input).toEqual(before);
  expect(result).toEqual(optimizeGraphLayout(input, links));
});
it('untangles a crossed path and preserves pinned positions', () => {
  const input = { nodes: [
    { path: 'a', x: 0, y: 0, pinned: true }, { path: 'b', x: 400, y: 400 },
    { path: 'c', x: 0, y: 400 }, { path: 'd', x: 400, y: 0 },
  ] };
  const result = optimizeGraphLayout(input, [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'd' }]);
  expect(result.nodes[0]).toEqual(input.nodes[0]);
  const [a,b,c,d] = result.nodes;
  const side = (p: typeof a, q: typeof a, r: typeof a) => (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  expect(side(a,b,c)*side(a,b,d)<0 && side(c,d,a)*side(c,d,b)<0).toBe(false);
});

it('respects full card bounds, coincident starts, and multiple fixed anchors', () => {
  const input: GraphLayout = { nodes: nodes.map((n, i) => ({ ...n, x: i === 7 ? 900 : 0, y: 0,
    expanded: true, width: 360 + i * 30, height: 300, pinned: i === 0 || i === 7 })) };
  const result = optimizeGraphLayout(input, links);
  for (const i of [0, 7]) expect(result.nodes[i]).toEqual(input.nodes[i]);
  for (let i = 0; i < result.nodes.length; i++) for (let j = i + 1; j < result.nodes.length; j++) {
    const a = result.nodes[i], b = result.nodes[j];
    expect(Math.abs(a.x - b.x) >= (a.width! + b.width!) / 2 + 23.5 || Math.abs(a.y - b.y) >= 323.5).toBe(true);
  }
  expect(result.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
});

it('accepts renderer endpoints, filters missing nodes, and ignores duplicate or reciprocal links', () => {
  const extra = [...links, { source: 'missing', target: '0' }, { source: '0', target: '0' },
    ...links.map(l => ({ source: l.target, target: l.source }))];
  expect(optimizeGraphLayout({ nodes }, extra)).toEqual(optimizeGraphLayout({ nodes }, links));
  const rendered = links.map(l => ({ source: { id: l.source }, target: { id: l.target } }));
  expect(optimizeGraphLayout({ nodes }, rendered as unknown as typeof links)).toEqual(optimizeGraphLayout({ nodes }, links));
});

it('handles empty graphs and retains isolated nodes and metadata', () => {
  expect(optimizeGraphLayout({ nodes: [] }, [])).toEqual({ nodes: [] });
  const input = { nodes: [{ path: 'only', x: 2, y: 3, pinned: true }] };
  expect(optimizeGraphLayout(input, [])).toEqual(input);
  const result = optimizeGraphLayout({ nodes: [...nodes, { path: 'orphan', x: 0, y: 0 }] }, links);
  expect(result.nodes.map(n => n.path)).toEqual([...nodes.map(n => n.path), 'orphan']);
  expect(result.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
});
