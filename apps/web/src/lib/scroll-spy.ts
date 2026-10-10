import { useEffect, useState } from 'react';

export interface SpyHeading {
  anchor: string;
  /** The heading's top edge relative to the top of the scrolling body. */
  top: number;
}

/**
 * The entry to highlight: the last heading that has passed the top quarter of the body, the first one before
 * any has, and the last one when the reader has reached the end of the body.
 */
export function activeAnchor(headings: readonly SpyHeading[], viewportHeight: number, atEnd: boolean): string | null {
  if (!headings.length) return null;
  if (atEnd) return headings[headings.length - 1].anchor;
  const line = viewportHeight / 4;
  let active = headings[0].anchor;
  for (const heading of headings) {
    if (heading.top > line) break;
    active = heading.anchor;
  }
  return active;
}

/** The headings of a book body in document order, measured against the body's top edge. */
export function measureHeadings(root: HTMLElement): { headings: SpyHeading[]; atEnd: boolean; } {
  const origin = root.getBoundingClientRect().top;
  const headings = [...root.querySelectorAll<HTMLElement>('[data-book-anchor]')].map(element => ({ anchor: element.dataset.bookAnchor!, top: element.getBoundingClientRect().top - origin }));
  // A body that fits without scrolling has no end to reach.
  const scrollable = root.scrollHeight > root.clientHeight + 1;
  return { headings, atEnd: scrollable && root.scrollTop + root.clientHeight >= root.scrollHeight - 1 };
}

/** Follows the scrolling of a book body and returns the anchor of the heading in view. `signature` changes when its headings do. */
export function useScrollSpy(root: HTMLElement | null, signature: string): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!root) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const { headings, atEnd } = measureHeadings(root);
      setActive(activeAnchor(headings, root.clientHeight, atEnd));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    root.addEventListener('scroll', schedule, { passive: true });
    // Images and editors change heights without a scroll; the content's size is watched along with the body's.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(root);
    for (const child of root.children) observer?.observe(child);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      root.removeEventListener('scroll', schedule);
      observer?.disconnect();
    };
  }, [root, signature]);
  return active;
}
