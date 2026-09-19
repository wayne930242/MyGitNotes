import { useEffect, useRef } from 'react';

export function useSidebarSwipe(enabled: boolean, open: boolean, onChange: (open: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const suppressClickUntil = useRef(0);
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    let gesture: { panel: HTMLElement; x: number; y: number; dx: number; dragging: boolean; } | null = null;
    const reset = () => {
      gesture?.panel.classList.remove('is-dragging');
      gesture?.panel.style.removeProperty('--sidebar-drag');
      gesture = null;
    };
    const start = (event: TouchEvent) => {
      // A fresh touch is an intentional interaction, not the drag's compatibility click.
      suppressClickUntil.current = 0;
      if (!window.matchMedia('(max-width: 1100px)').matches || event.touches.length !== 1) return;
      if ((event.target as Element).closest('input, textarea, select, [role="combobox"], [contenteditable="true"]')) return;
      // The drawer mounts only in the narrow layout, so it is looked up when a gesture starts.
      const panel = root.querySelector<HTMLElement>('[data-responsive-sidebar]');
      if (!panel) return;
      const touch = event.touches[0];
      const bounds = root.getBoundingClientRect();
      if (!open && touch.clientX - bounds.left > bounds.width / 2) return;
      gesture = { panel, x: touch.clientX, y: touch.clientY, dx: 0, dragging: false };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1) {
        reset();
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (!gesture.dragging) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          reset();
          return;
        }
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if ((open && dx > 0) || (!open && dx < 0)) {
          reset();
          return;
        }
        gesture.dragging = true;
        gesture.panel.classList.add('is-dragging');
      }
      event.preventDefault();
      gesture.dx = dx;
      const width = gesture.panel.getBoundingClientRect().width;
      const offset = Math.max(-width, Math.min(0, (open ? 0 : -width) + dx));
      gesture.panel.style.setProperty('--sidebar-drag', `${offset}px`);
    };
    const end = () => {
      if (gesture?.dragging) {
        suppressClickUntil.current = performance.now() + 400;
        if (Math.abs(gesture.dx) >= 64) onChange(!open);
      }
      reset();
    };
    const cancel = () => {
      if (gesture?.dragging) suppressClickUntil.current = performance.now() + 400;
      reset();
    };
    const click = (event: MouseEvent) => {
      if (performance.now() < suppressClickUntil.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', cancel);
    root.addEventListener('click', click, true);
    return () => {
      reset();
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchmove', move);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', cancel);
      root.removeEventListener('click', click, true);
    };
  }, [enabled, open, onChange]);
  return ref;
}
