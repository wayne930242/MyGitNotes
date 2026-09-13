import { useEffect } from 'react';

type ElementRef = { readonly current: HTMLElement | null };

export function useAltWheelHorizontalScroll(targetRef: ElementRef, scrollerRef: ElementRef) {
  useEffect(() => {
    const target = targetRef.current;
    const scroller = scrollerRef.current;
    if (!target || !scroller) return;

    const wheel = (event: WheelEvent) => {
      if (!event.altKey || event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? scroller.clientWidth
          : 1;
      event.preventDefault();
      scroller.scrollLeft += event.deltaY * unit;
    };

    target.addEventListener('wheel', wheel, { passive: false });
    return () => target.removeEventListener('wheel', wheel);
  }, [scrollerRef, targetRef]);
}
