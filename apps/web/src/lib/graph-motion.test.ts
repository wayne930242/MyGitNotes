import { describe, expect, it } from 'vitest';
import { GRAPH_RELAX_DURATION, graphMotionProgress, interpolateGraphPosition } from './graph-motion.js';

describe('graph relaxation motion', () => {
  it('starts at the current position and smoothly reaches its destination', () => {
    const from = { x: 10, y: 20 }, to = { x: 110, y: 220 };
    expect(interpolateGraphPosition(from, to, graphMotionProgress(0))).toEqual(from);
    expect(interpolateGraphPosition(from, to, graphMotionProgress(GRAPH_RELAX_DURATION / 2))).toEqual({ x: 60, y: 120 });
    expect(interpolateGraphPosition(from, to, graphMotionProgress(GRAPH_RELAX_DURATION))).toEqual(to);
    expect(graphMotionProgress(10)).toBeLessThan(0.01);
  });
  it('can reverse from an interrupted position without jumping', () => {
    const from = { x: 0, y: 0 }, to = { x: 100, y: 100 };
    const current = interpolateGraphPosition(from, to, 0.4);
    expect(interpolateGraphPosition(current, from, graphMotionProgress(0))).toEqual(current);
    expect(interpolateGraphPosition(current, from, graphMotionProgress(GRAPH_RELAX_DURATION))).toEqual(from);
  });
});
