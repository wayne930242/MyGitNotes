import { useRef } from 'react';
import type { MouseEvent, TouchEvent } from 'react';

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

/**
 * Detects a touch long-press on an element, without hijacking the plain-tap
 * click that still needs to fire for a short touch. The returned `onClick`
 * wraps the element's normal click handler and swallows the one synthetic
 * click a browser sends right after a long-press-triggered touch ends.
 */
export function useLongPress(onLongPress: () => void, enabled: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const start = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  const clear = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
    start.current = null;
  };

  const onTouchStart = (event: TouchEvent) => {
    if (!enabled || event.touches.length !== 1) return;
    const touch = event.touches[0];
    start.current = { x: touch.clientX, y: touch.clientY };
    timer.current = setTimeout(() => { suppressClick.current = true; onLongPress(); }, LONG_PRESS_MS);
  };
  const onTouchMove = (event: TouchEvent) => {
    if (!start.current) return;
    const touch = event.touches[0];
    if (!touch) return;
    if (Math.abs(touch.clientX - start.current.x) > MOVE_CANCEL_PX || Math.abs(touch.clientY - start.current.y) > MOVE_CANCEL_PX) clear();
  };
  const onTouchEnd = () => clear();
  const onTouchCancel = () => clear();
  const onClick = (handler: (event: MouseEvent) => void) => (event: MouseEvent) => {
    if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); return; }
    handler(event);
  };

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onClick };
}
