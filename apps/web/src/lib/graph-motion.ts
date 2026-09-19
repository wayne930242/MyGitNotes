export const GRAPH_RELAX_DURATION = 850;

export function graphMotionProgress(elapsed: number, duration = GRAPH_RELAX_DURATION) {
  const t = Math.max(0, Math.min(1, elapsed / duration));
  return t * t * (3 - 2 * t);
}

export function interpolateGraphPosition(from: { x: number; y: number; }, to: { x: number; y: number; }, progress: number) {
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}
