import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useGraphPainting } from './useGraphPainting.js';

describe('focused graph painting', () => {
  it('draws every connected title even when nodes overlap at low zoom', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => ({
      id: String(i), title: `Title ${i}`, notebookId: 'test', tags: [], inDegree: 0, outDegree: 0, val: 1, x: 0, y: 0,
    }));
    let paint: ReturnType<typeof useGraphPainting> | undefined;
    function Probe() {
      paint = useGraphPainting({ nodes, hoverNode: nodes[0], focusNodeId: '0', neighbors: new Set(nodes.map(n => n.id)), isDark: false, nodeColor: () => '#7895b5' });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    const fillText = vi.fn();
    const context = {
      save() {}, restore() {}, beginPath() {}, roundRect() {}, fill() {},
      measureText: (text: string) => ({ width: text.length * 6 }), fillText,
    } as unknown as CanvasRenderingContext2D;
    paint!.paintLabels(context, 0.1);
    expect(fillText.mock.calls.map(call => call[0])).toEqual(nodes.map(n => n.title));
  });

  it('adds a ring only to the persistently selected node', () => {
    const node = { id: 'a', title: 'A', notebookId: 'test', tags: [], x: 0, y: 0, inDegree: 0, outDegree: 0, val: 1 };
    let paint: ReturnType<typeof useGraphPainting> | undefined;
    function Probe() {
      paint = useGraphPainting({ nodes: [node], hoverNode: node, focusNodeId: 'a', neighbors: new Set(['a']), isDark: false, nodeColor: () => '#7895b5' });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    const stroke = vi.fn();
    const context = { save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke } as unknown as CanvasRenderingContext2D;
    paint!.paintNode(node, context, 1);
    expect(stroke).toHaveBeenCalledTimes(2);
  });
});
