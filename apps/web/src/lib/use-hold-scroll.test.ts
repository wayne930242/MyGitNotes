// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HOLD_DELAY_MS, holdScrollSpeed, useHoldScroll } from './use-hold-scroll.js';

const scrollBy = vi.fn();
const scroller = { clientWidth: 500, scrollBy } as unknown as HTMLElement;
const press = { button: 0, pointerId: 1, currentTarget: { setPointerCapture() {} } } as unknown as PointerEvent<HTMLButtonElement>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  // Frames on the fake clock, so the speed follows simulated time.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 16) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  scrollBy.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function button(direction: -1 | 1 = 1) {
  return renderHook(() => useHoldScroll({ current: scroller })).result.current(direction);
}

it('pages by most of the visible width on a click', () => {
  const props = button(-1);
  act(() => {
    props.onPointerDown?.(press);
    props.onPointerUp?.(press);
    props.onClick?.({} as never);
  });
  vi.advanceTimersByTime(HOLD_DELAY_MS * 3);
  expect(scrollBy).toHaveBeenCalledTimes(1);
  expect(scrollBy).toHaveBeenCalledWith({ left: -400, behavior: 'smooth' });
});

it('pages on a keyboard click, which has no pointer press', () => {
  const props = button();
  act(() => props.onClick?.({} as never));
  expect(scrollBy).toHaveBeenCalledWith({ left: 400, behavior: 'smooth' });
});

it('scrolls continuously while held and does not page on release', () => {
  const props = button();
  act(() => props.onPointerDown?.(press));
  act(() => void vi.advanceTimersByTime(HOLD_DELAY_MS + 1000));
  const steps = scrollBy.mock.calls.map(([options]) => (options as { left: number; }).left);
  expect(steps.length).toBeGreaterThan(10);
  expect(steps.every(left => left >= 0)).toBe(true);
  expect(steps.at(-1)).toBeGreaterThan(steps[1]);
  act(() => {
    props.onPointerUp?.(press);
    props.onClick?.({} as never);
  });
  const count = scrollBy.mock.calls.length;
  vi.advanceTimersByTime(1000);
  expect(scrollBy).toHaveBeenCalledTimes(count);
  expect(scrollBy.mock.calls.some(([options]) => (options as { behavior: string; }).behavior === 'smooth')).toBe(false);
});

it('stops when the pointer capture is lost', () => {
  const props = button();
  act(() => props.onPointerDown?.(press));
  act(() => void vi.advanceTimersByTime(HOLD_DELAY_MS + 200));
  act(() => props.onLostPointerCapture?.(press));
  const count = scrollBy.mock.calls.length;
  vi.advanceTimersByTime(1000);
  expect(scrollBy).toHaveBeenCalledTimes(count);
});

it('speeds up from a slow start to a capped top speed', () => {
  expect(holdScrollSpeed(0)).toBe(600);
  expect(holdScrollSpeed(750)).toBeGreaterThan(600);
  expect(holdScrollSpeed(1500)).toBe(3000);
  expect(holdScrollSpeed(10_000)).toBe(3000);
});
