// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attachLineGutterGesture } from './line-gutter-gesture.js';

const LINE_HEIGHT = 20;
let gutter: HTMLElement;
let scroller: HTMLElement;
let cleanup: () => void;
let lineAtY: ReturnType<typeof vi.fn>;
let onCopy: ReturnType<typeof vi.fn>;
let onPreview: ReturnType<typeof vi.fn>;

function pointer(type: string, init: { y: number; target?: Element; pointerType?: string; }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 5, clientY: init.y, button: 0 });
  Object.assign(event, { pointerId: 1, pointerType: init.pointerType ?? 'touch' });
  (init.target ?? gutter).dispatchEvent(event);
}

beforeEach(() => {
  vi.useFakeTimers();
  gutter = document.createElement('div');
  gutter.innerHTML = '<span data-line="3">3</span><span data-line="4">4</span>';
  scroller = document.createElement('div');
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 100, width: 100, height: 200, x: 0, y: 0, toJSON: () => ({}) });
  document.body.append(gutter);
  lineAtY = vi.fn((y: number) => Math.floor(y / LINE_HEIGHT) + 1 + Math.floor(scroller.scrollTop / LINE_HEIGHT));
  onCopy = vi.fn();
  onPreview = vi.fn();
  cleanup = attachLineGutterGesture({
    gutter,
    scroller,
    lineFromTarget: target => Number((target.closest('[data-line]') as HTMLElement | null)?.dataset.line ?? NaN) || null,
    lineAtY,
    lineHeight: () => LINE_HEIGHT,
    onPreview,
    onCopy,
  });
});

afterEach(() => {
  cleanup();
  gutter.remove();
  vi.useRealTimers();
});

const row = (line: number) => gutter.querySelector(`[data-line="${line}"]`) as Element;

it('copies one line when a touch is held on a line number', () => {
  pointer('pointerdown', { y: 50, target: row(3) });
  vi.advanceTimersByTime(499);
  expect(onCopy).not.toHaveBeenCalled();
  vi.advanceTimersByTime(2);
  expect(onCopy).toHaveBeenCalledTimes(1);
  expect(onCopy).toHaveBeenCalledWith(3);
});

it('does not long-press copy once the touch has moved into a drag', () => {
  pointer('pointerdown', { y: 50, target: row(3) });
  pointer('pointermove', { y: 90 });
  vi.advanceTimersByTime(600);
  expect(onCopy).not.toHaveBeenCalled();
});

it('copies the dragged range on touch release', () => {
  pointer('pointerdown', { y: 50, target: row(3) });
  pointer('pointermove', { y: 110 });
  pointer('pointerup', { y: 110 });
  expect(onCopy).toHaveBeenCalledTimes(1);
  expect(onCopy).toHaveBeenCalledWith(3, 6);
  expect(onPreview).toHaveBeenLastCalledWith(null);
});

it('copies one line on a double tap', () => {
  for (let tap = 0; tap < 2; tap++) {
    pointer('pointerdown', { y: 50, target: row(3), pointerType: 'mouse' });
    pointer('pointerup', { y: 50, pointerType: 'mouse' });
  }
  expect(onCopy).toHaveBeenCalledTimes(1);
  expect(onCopy).toHaveBeenCalledWith(3);
});

it('scrolls the scroller while the pointer rests in its last two lines and extends the range', () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  pointer('pointerdown', { y: 50, target: row(3) });
  pointer('pointermove', { y: 190 });
  const before = scroller.scrollTop;
  for (let step = 0; step < 5; step++) frames.shift()?.(0);
  expect(scroller.scrollTop).toBeGreaterThan(before);
  pointer('pointerup', { y: 190 });
  const [first, last] = onCopy.mock.calls[0];
  expect(first).toBe(3);
  expect(last).toBeGreaterThan(10);
  vi.unstubAllGlobals();
});

it('does not scroll while the pointer stays above the last two lines', () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  pointer('pointerdown', { y: 50, target: row(3) });
  pointer('pointermove', { y: 100 });
  frames.shift()?.(0);
  expect(scroller.scrollTop).toBe(0);
  vi.unstubAllGlobals();
});
