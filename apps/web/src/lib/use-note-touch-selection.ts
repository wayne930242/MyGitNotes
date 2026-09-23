import { useEffect, useRef } from 'react';
import type { MouseEvent, TouchEvent } from 'react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { LONG_PRESS_MS, shouldCancelLongPress } from './use-long-press.js';

/** Long-press a browse note to start selection, following FolderTree's touch convention. */
export function useNoteTouchSelection(onToggleSelect?: (note: NoteListItem) => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const start = useRef<{ x: number; y: number; }>();
  const suppressedPath = useRef<string>();
  const suppressionTimer = useRef<ReturnType<typeof setTimeout>>();
  const swallowClick = useRef<(event: globalThis.MouseEvent) => void>();

  const clearSuppression = () => {
    if (swallowClick.current) window.removeEventListener('click', swallowClick.current, true);
    swallowClick.current = undefined;
    suppressedPath.current = undefined;
    if (suppressionTimer.current) clearTimeout(suppressionTimer.current);
    suppressionTimer.current = undefined;
  };

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    start.current = undefined;
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (suppressionTimer.current) clearTimeout(suppressionTimer.current);
    if (swallowClick.current) window.removeEventListener('click', swallowClick.current, true);
  }, []);

  const onTouchStart = (note: NoteListItem, event: TouchEvent) => {
    cancel();
    if (!onToggleSelect || event.touches.length !== 1 || (event.target as Element).closest('button, input, select, a')) return;
    const touch = event.touches[0];
    start.current = { x: touch.clientX, y: touch.clientY };
    timer.current = setTimeout(() => {
      onToggleSelect(note);
      clearSuppression();
      suppressedPath.current = note.path;
      swallowClick.current = event => {
        event.preventDefault();
        event.stopPropagation();
        clearSuppression();
      };
      window.addEventListener('click', swallowClick.current, true);
      suppressionTimer.current = setTimeout(clearSuppression, 500);
      timer.current = undefined;
    }, LONG_PRESS_MS);
  };

  const onTouchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!touch || !start.current || shouldCancelLongPress(start.current, { x: touch.clientX, y: touch.clientY })) cancel();
  };

  const consumeClick = (note: NoteListItem) => {
    if (suppressedPath.current !== note.path) return false;
    clearSuppression();
    return true;
  };

  const onContextMenu = (event: MouseEvent) => {
    if (timer.current || suppressedPath.current) event.preventDefault();
  };

  return { onTouchStart, onTouchMove, onTouchEnd: cancel, onTouchCancel: cancel, consumeClick, onContextMenu };
}
