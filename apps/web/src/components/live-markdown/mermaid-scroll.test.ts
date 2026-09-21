// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { anchorMermaidSwap, holdTop, sourceTopAfterEnter } from './mermaid-scroll.js';

describe('sourceTopAfterEnter', () => {
  it('keeps the diagram top where it was when the source takes over', () => {
    expect(sourceTopAfterEnter({ top: 120, height: 300 }, 800)).toBe(120);
  });

  it('pulls a diagram top scrolled above the viewport back to the edge', () => {
    expect(sourceTopAfterEnter({ top: -400, height: 900 }, 800)).toBe(8);
  });

  it('keeps a diagram top near the viewport bottom far enough up to show source', () => {
    expect(sourceTopAfterEnter({ top: 780, height: 300 }, 800)).toBe(720);
  });

  it('leaves a diagram that is entirely out of view to the default anchoring', () => {
    expect(sourceTopAfterEnter({ top: 900, height: 300 }, 800)).toBeNull();
    expect(sourceTopAfterEnter({ top: -500, height: 300 }, 800)).toBeNull();
  });
});

describe('holdTop', () => {
  let queue: FrameRequestCallback[] = [];
  const views: EditorView[] = [];
  function setup() {
    queue = [];
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => { queue = []; });
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'a\nb\nc' }), dispatchTransactions: anchorMermaidSwap });
    views.push(view);
    const placements = vi.spyOn(view, 'dispatch');
    return { view, placements };
  }
  const frame = () => queue.splice(0).forEach(cb => cb(0));
  afterEach(() => {
    while (views.length) views.pop()!.destroy();
    vi.unstubAllGlobals();
  });

  it('re-places the line while nothing else happens', () => {
    const { view, placements } = setup();
    holdTop(view, 2, 8);
    frame();
    expect(placements.mock.calls.length).toBeGreaterThan(1);
  });

  it('ends when a later transaction moves the selection', () => {
    const { view, placements } = setup();
    holdTop(view, 2, 8);
    view.dispatch({ selection: { anchor: 4 } });
    const seen = placements.mock.calls.length;
    frame();
    frame();
    expect(placements.mock.calls.length).toBe(seen);
  });

  it('ends when the view is destroyed', () => {
    const { view, placements } = setup();
    holdTop(view, 2, 8);
    const seen = placements.mock.calls.length;
    view.destroy();
    frame();
    expect(placements.mock.calls.length).toBe(seen);
  });
});
