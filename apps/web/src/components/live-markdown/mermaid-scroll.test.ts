// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sourceTopAfterEnter } from './mermaid-scroll.js';

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
