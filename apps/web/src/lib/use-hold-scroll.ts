import { type ButtonHTMLAttributes, type PointerEvent, useEffect, useRef } from 'react';

interface ElementRef {
  readonly current: HTMLElement | null;
}
export type ScrollDirection = -1 | 1;

export const HOLD_DELAY_MS = 300;
const START_SPEED = 600;
const MAX_SPEED = 3000;
const RAMP_MS = 1500;

/** Scroll speed in px/s after holding for `elapsed` ms past the hold delay: eases from START_SPEED up to MAX_SPEED. */
export function holdScrollSpeed(elapsed: number) {
  const ramp = Math.min(1, Math.max(0, elapsed) / RAMP_MS);
  return START_SPEED + (MAX_SPEED - START_SPEED) * ramp * ramp;
}

/**
 * Arrow buttons for a horizontal strip, for people who don't know Alt+wheel: a click pages by most of the visible width,
 * and holding the button scrolls continuously, speeding up until it is released.
 */
export function useHoldScroll(scrollerRef: ElementRef) {
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; frame: number; } | null>(null);
  // Set when a hold scrolled, so the click that follows the release does not page as well.
  const held = useRef(false);

  const stop = () => {
    if (!hold.current) return;
    clearTimeout(hold.current.timer);
    cancelAnimationFrame(hold.current.frame);
    hold.current = null;
  };
  useEffect(() => stop, []);

  const start = (direction: ScrollDirection) => {
    stop();
    held.current = false;
    const timer = setTimeout(() => {
      held.current = true;
      let began: number | undefined;
      let last = 0;
      const step = (now: number) => {
        const scroller = scrollerRef.current;
        if (!scroller || !hold.current) return;
        if (began === undefined) began = last = now;
        scroller.scrollBy({ left: direction * holdScrollSpeed(now - began) * (now - last) / 1000, behavior: 'instant' });
        last = now;
        hold.current.frame = requestAnimationFrame(step);
      };
      if (hold.current) hold.current.frame = requestAnimationFrame(step);
    }, HOLD_DELAY_MS);
    hold.current = { timer, frame: 0 };
  };

  const page = (direction: ScrollDirection) => {
    const scroller = scrollerRef.current;
    scroller?.scrollBy({ left: direction * scroller.clientWidth * .8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };

  return (direction: ScrollDirection): ButtonHTMLAttributes<HTMLButtonElement> => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      // Capture keeps the release coming here even when the pointer drifts off the button.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      start(direction);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onLostPointerCapture: stop,
    onClick: () => {
      if (held.current) held.current = false;
      else page(direction);
    },
  });
}
