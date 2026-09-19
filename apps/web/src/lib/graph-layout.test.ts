import { expect, it } from 'vitest';
import { arrangeGraphLayout } from './graph-layout.js';
import type { GraphLayout } from '@mygitnotes/core/screen-page';

const size = (node: GraphLayout['nodes'][number]) => node.expanded ? [node.width || 360, node.height || 300] : [32, 32];
function expectSeparated(layout: GraphLayout) {
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i], b = layout.nodes[j], [aw, ah] = size(a), [bw, bh] = size(b);
      expect(Math.abs(a.x - b.x) >= (aw + bw) / 2 + 23.5 || Math.abs(a.y - b.y) >= (ah + bh) / 2 + 23.5).toBe(true);
    }
  }
}
it('separates expanded cards and the surrounding collapsed nodes in both dimensions', () => {
  const layout: GraphLayout = { nodes: [{ path: 'a.md', x: -30, y: -20, expanded: true, width: 500, height: 400 }, { path: 'b.md', x: 30, y: 20, expanded: true }, { path: 'c.md', x: -10, y: 25 }, { path: 'd.md', x: 35, y: -25 }] };
  const before = structuredClone(layout), result = arrangeGraphLayout(layout);
  expectSeparated(result);
  expect(result.nodes[2].x !== -10 || result.nodes[2].y !== 25).toBe(true);
  expect(result.nodes[0].x).toBeLessThan(result.nodes[1].x);
  expect(result.nodes[3].y).toBeLessThan(result.nodes[2].y);
  expect(layout).toEqual(before);
});
it('keeps manually pinned cards fixed while moving nearby nodes around their full size', () => {
  const result = arrangeGraphLayout({ nodes: [{ path: 'a.md', x: 0, y: 0, width: 800, height: 600, expanded: true, pinned: true }, { path: 'b.md', x: 100, y: 50 }, { path: 'c.md', x: -100, y: -50, expanded: true }] });
  expect(result.nodes[0]).toMatchObject({ x: 0, y: 0 });
  expectSeparated(result);
});
it('handles coincident nodes deterministically without non-finite coordinates', () => {
  const layout = { nodes: Array.from({ length: 12 }, (_, i) => ({ path: `${i}.md`, x: 0, y: 0, expanded: i < 4 })) };
  const result = arrangeGraphLayout(layout);
  expectSeparated(result);
  expect(result).toEqual(arrangeGraphLayout(layout));
  expect(result.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
});
it('leaves an already separated layout unchanged', () => {
  const layout = { nodes: [{ path: 'a.md', x: -500, y: 0, expanded: true }, { path: 'b.md', x: 500, y: 0 }] };
  expect(arrangeGraphLayout(layout)).toEqual(layout);
});
it('can compact spacing and align nearby card rows while preserving their left-right order', () => {
  const layout = { nodes: [{ path: 'a.md', x: -500, y: 0, expanded: true }, { path: 'b.md', x: 500, y: 25, expanded: true }] };
  const result = arrangeGraphLayout(layout, { compact: true });
  expect(result.nodes[1].x - result.nodes[0].x).toBeLessThan(1000);
  expect(result.nodes[1].x - result.nodes[0].x).toBeGreaterThan(380);
  expect(result.nodes[0].y).toBe(result.nodes[1].y);
});
