import { useEffect } from 'react';

type ElementRef = { readonly current: HTMLElement | null; };

export function useAltWheelHorizontalScroll(targetRef: ElementRef, scrollerRef: ElementRef, nestedSelector?: string) {
  useEffect(() => {
    const target = targetRef.current;
    const scroller = scrollerRef.current;
    if (!target || !scroller) return;

    const wheel = (event: WheelEvent) => {
      if (event.defaultPrevented || !event.altKey || event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const activeScroller = nestedSelector ? event.target instanceof Element ? event.target.closest<HTMLElement>(nestedSelector) : null : scroller;
      if (!activeScroller || (nestedSelector && !target.contains(activeScroller))) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? activeScroller.clientWidth : 1;
      event.preventDefault();
      if (nestedSelector) event.stopPropagation();
      activeScroller.scrollLeft += event.deltaY * unit;
    };

    const capture = Boolean(nestedSelector);
    target.addEventListener('wheel', wheel, { passive: false, capture });
    return () => target.removeEventListener('wheel', wheel, capture);
  }, [scrollerRef, targetRef, nestedSelector]);
}
