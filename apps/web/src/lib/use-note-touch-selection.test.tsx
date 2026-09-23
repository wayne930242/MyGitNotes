// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { TouchEvent } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS } from './use-long-press.js';
import { useNoteTouchSelection } from './use-note-touch-selection.js';

const note = { path: 'notes/one.md' } as NoteListItem;
const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }], target: document.createElement('div') }) as unknown as TouchEvent;

afterEach(() => vi.useRealTimers());

it('starts selection after a held touch and consumes the following synthetic click', () => {
  vi.useFakeTimers();
  const select = vi.fn();
  const { result } = renderHook(() => useNoteTouchSelection(select));

  act(() => {
    result.current.onTouchStart(note, touch(10, 10));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    result.current.onTouchEnd();
  });

  expect(select).toHaveBeenCalledWith(note);
  expect(result.current.consumeClick(note)).toBe(true);
  expect(result.current.consumeClick(note)).toBe(false);
});

it('keeps scrolling a plain scroll by cancelling the held touch', () => {
  vi.useFakeTimers();
  const select = vi.fn();
  const { result } = renderHook(() => useNoteTouchSelection(select));

  act(() => {
    result.current.onTouchStart(note, touch(10, 10));
    result.current.onTouchMove(touch(30, 30));
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });

  expect(select).not.toHaveBeenCalled();
});

it('swallows the synthetic click even if the new toolbar moves another button under the finger', () => {
  vi.useFakeTimers();
  const select = vi.fn();
  const wrongAction = vi.fn();
  const button = document.createElement('button');
  button.addEventListener('click', wrongAction);
  document.body.append(button);
  const { result } = renderHook(() => useNoteTouchSelection(select));

  act(() => {
    result.current.onTouchStart(note, touch(10, 10));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    result.current.onTouchEnd();
  });
  button.click();

  expect(select).toHaveBeenCalledOnce();
  expect(wrongAction).not.toHaveBeenCalled();
  button.remove();
});
