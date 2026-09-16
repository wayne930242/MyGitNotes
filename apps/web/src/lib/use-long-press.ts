import { useState, useRef, useEffect, useCallback } from 'react';
import type { MouseEvent, TouchEvent } from 'react';

export const LONG_PRESS_MS = 500;
export const MOVE_CANCEL_X_PX = 10;
export const MOVE_CANCEL_Y_PX = 8;

export function shouldCancelLongPress(start: { x: number; y: number }, current: { x: number; y: number }): boolean {
  return Math.abs(current.x - start.x) > MOVE_CANCEL_X_PX || Math.abs(current.y - start.y) > MOVE_CANCEL_Y_PX;
}

/**
 * Detects a touch long-press on an element, without hijacking the plain-tap
 * click that still needs to fire for a short touch. The returned `onClick`
 * wraps the element's normal click handler and swallows the one synthetic
 * click a browser sends right after a long-press-triggered touch ends.
 *
 * Provides `isPressing` state for haptic-free visual feedback, suppresses
 * iOS/Android context menus via `onContextMenu`, and cancels immediately
 * if scrolling begins anywhere in the scroll container.
 */
export function useLongPress(onLongPress: () => void, enabled: boolean) {
  const [isPressing, setIsPressing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const suppressTimer = useRef<ReturnType<typeof setTimeout>>();
  const start = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
    start.current = null;
    setIsPressing(false);
  }, []);

  useEffect(() => {
    if (!isPressing) return;
    const onScroll = () => clear();
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => { window.removeEventListener('scroll', onScroll, { capture: true }); };
  }, [isPressing, clear]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (suppressTimer.current) clearTimeout(suppressTimer.current);
  }, []);

  const onTouchStart = (event: TouchEvent) => {
    if (!enabled) return;
    if (event.touches.length !== 1) {
      clear();
      return;
    }
    if (suppressTimer.current) {
      clearTimeout(suppressTimer.current);
      suppressTimer.current = undefined;
    }
    suppressClick.current = false;
    const touch = event.touches[0];
    start.current = { x: touch.clientX, y: touch.clientY };
    setIsPressing(true);
    timer.current = setTimeout(() => {
      suppressClick.current = true;
      setIsPressing(false);

      const swallowSyntheticClick = (e: globalThis.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        cleanupSwallow();
      };
      const cleanupSwallow = () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('click', swallowSyntheticClick, true);
        }
        suppressClick.current = false;
        if (suppressTimer.current) {
          clearTimeout(suppressTimer.current);
          suppressTimer.current = undefined;
        }
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('click', swallowSyntheticClick, true);
      }
      if (suppressTimer.current) clearTimeout(suppressTimer.current);
      suppressTimer.current = setTimeout(cleanupSwallow, 400);

      onLongPress();
    }, LONG_PRESS_MS);
  };

  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      clear();
      return;
    }
    if (!start.current) return;
    const touch = event.touches[0];
    if (!touch) return;
    if (shouldCancelLongPress(start.current, { x: touch.clientX, y: touch.clientY })) {
      clear();
    }
  };

  const onTouchEnd = () => clear();

  const onTouchCancel = () => {
    clear();
    if (suppressTimer.current) {
      clearTimeout(suppressTimer.current);
      suppressTimer.current = undefined;
    }
    suppressClick.current = false;
  };

  const onClick = (handler: (event: MouseEvent) => void) => (event: MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      if (suppressTimer.current) {
        clearTimeout(suppressTimer.current);
        suppressTimer.current = undefined;
      }
      event.preventDefault();
      return;
    }
    handler(event);
  };

  const onContextMenu = (event: MouseEvent) => {
    if (suppressClick.current || isPressing) {
      event.preventDefault();
    }
  };

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onClick, onContextMenu, isPressing };
}

