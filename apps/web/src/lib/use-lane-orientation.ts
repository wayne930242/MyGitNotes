import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * Under this width of the compilation itself (a zoom frame or a Focus pane, never the viewport) a lane lists its cards top to bottom.
 * The container query in workspace.css (`@container compilation (width < 560px)`) switches the layout at the same width;
 * change them together.
 */
export const LANE_VERTICAL_BELOW = 560;
/** The element that owns the `compilation` container in workspace.css. */
const LANE_CONTAINER = '.compilation-view';

export type LaneOrientation = 'horizontal' | 'vertical';

export function laneOrientation(width: number): LaneOrientation {
  return width < LANE_VERTICAL_BELOW ? 'vertical' : 'horizontal';
}

/**
 * The orientation CSS gives the lane inside `hostRef`, measured on the compilation view that contains it.
 * CSS alone decides the layout, so the first paint is never wrong; this only picks the behavior that goes with it
 * (sorting strategy, scroll buttons, Alt+wheel). A lane outside a compilation view stays horizontal, as CSS leaves it.
 */
export function useLaneOrientation(hostRef: RefObject<HTMLElement | null>): LaneOrientation {
  const [orientation, setOrientation] = useState<LaneOrientation>('horizontal');
  useLayoutEffect(() => {
    const container = hostRef.current?.closest<HTMLElement>(LANE_CONTAINER);
    if (!container) return;
    const apply = (width: number) => setOrientation(laneOrientation(width));
    apply(Number.parseFloat(getComputedStyle(container).width));
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1];
      if (entry) apply(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [hostRef]);
  return orientation;
}
