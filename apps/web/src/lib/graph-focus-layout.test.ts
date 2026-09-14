import { describe, expect, it } from 'vitest';
import type { NoteGraphNode, NoteGraphLink } from '@github-notes/core/note-graph';
import { expandGraphFocus } from './graph-focus-layout.js';

const data = {
  nodes: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, title: id, notebookId: 'test', tags: [], inDegree: 0, outDegree: 0, val: 1, x: 10 + i, y: 20 + i })),
  links: [{ source: 'a', target: 'b' }] as NoteGraphLink[],
};

describe('temporary local graph expansion', () => {
  it('keeps the center and unrelated nodes fixed while spreading direct neighbors', () => {
    const expanded = expandGraphFocus(data, 'a', new Set(['a', 'b', 'c']), 1);
    const nodes = expanded.nodes as (NoteGraphNode & { x: number; y: number; fx: number })[];
    expect(nodes[0]).toMatchObject({ x: 10, y: 20, fx: 10, fy: 20 });
    expect(nodes[3]).toMatchObject({ x: 13, y: 23 });
    expect(Math.hypot(nodes[1].x - 10, nodes[1].y - 20)).toBeGreaterThan(20);
    expect(nodes[1].x).not.toBe(10);
    expect(nodes[1].fx).toBe(nodes[1].x);
  });
  it('preserves original positions and restores the original graph when focus ends', () => {
    const before = JSON.stringify(data);
    const expanded = expandGraphFocus(data, 'a', new Set(['a', 'b']), 1);
    expect(expanded.nodes[0]).not.toBe(data.nodes[0]);
    expect(expanded.links[0]).not.toBe(data.links[0]);
    expect(JSON.stringify(data)).toBe(before);
    expect(expandGraphFocus(data, undefined, new Set(), 1)).toBe(data);
  });
  it('leaves already spacious neighbors exactly where they are', () => {
    const spacious = { ...data, nodes: data.nodes.map((node, i) => ({ ...node, x: i * 200, y: i * 130 })) };
    const expanded = expandGraphFocus(spacious, 'a', new Set(['a', 'b', 'c']), 1);
    expect(expanded.nodes.map(node => ({ x: (node as typeof spacious.nodes[number]).x, y: (node as typeof spacious.nodes[number]).y })))
      .toEqual(spacious.nodes.map(({ x, y }) => ({ x, y })));
  });
  it('preserves the original direction of a crowded pair rather than placing it on a ring', () => {
    const expanded = expandGraphFocus(data, 'a', new Set(['a', 'b']), 1);
    const b = expanded.nodes[1] as typeof data.nodes[number];
    expect(b.x).toBeGreaterThan(10);
    expect(b.y).toBeGreaterThan(20);
    expect((b.x - 10) / (b.y - 20)).toBeCloseTo(1);
  });
});
