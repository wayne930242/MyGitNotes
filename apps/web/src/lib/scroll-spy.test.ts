// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { activeAnchor, measureHeadings, useScrollSpy } from './scroll-spy.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const headings = [{ anchor: 'a', top: -900 }, { anchor: 'b', top: -300 }, { anchor: 'c', top: 120 }, { anchor: 'd', top: 640 }];

it('highlights the last heading that passed the top quarter of the body', () => {
  expect(activeAnchor(headings, 800, false)).toBe('c');
  expect(activeAnchor(headings, 400, false)).toBe('b');
  expect(activeAnchor([{ anchor: 'a', top: 201 }, { anchor: 'b', top: 900 }], 800, false)).toBe('a');
  expect(activeAnchor([{ anchor: 'a', top: 200 }, { anchor: 'b', top: 201 }], 800, false)).toBe('a');
});

it('highlights the first heading before any has passed, and the last one at the end of the body', () => {
  expect(activeAnchor([{ anchor: 'a', top: 500 }, { anchor: 'b', top: 900 }], 800, false)).toBe('a');
  expect(activeAnchor(headings, 800, true)).toBe('d');
  expect(activeAnchor([], 800, true)).toBeNull();
});

const body = (metrics: { scrollTop: number; clientHeight: number; scrollHeight: number; }, tops: Record<string, number>) => {
  const root = document.createElement('div');
  document.body.append(root);
  root.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  for (const [key, value] of Object.entries(metrics)) Object.defineProperty(root, key, { value, configurable: true });
  for (const [anchor, top] of Object.entries(tops)) {
    const heading = document.createElement('h2');
    heading.dataset.bookAnchor = anchor;
    heading.getBoundingClientRect = () => ({ top: 100 + top }) as DOMRect;
    root.append(heading);
  }
  return root;
};

it('measures headings against the body\'s own top edge and detects its end only when it scrolls', () => {
  const scrolled = body({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 }, { a: -50, b: 40 });
  expect(measureHeadings(scrolled)).toEqual({ headings: [{ anchor: 'a', top: -50 }, { anchor: 'b', top: 40 }], atEnd: true });
  const middle = body({ scrollTop: 100, clientHeight: 100, scrollHeight: 1000 }, { a: 0 });
  expect(measureHeadings(middle).atEnd).toBe(false);
  const fits = body({ scrollTop: 0, clientHeight: 100, scrollHeight: 100 }, { a: 0 });
  expect(measureHeadings(fits).atEnd).toBe(false);
});

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

it('follows the body as it scrolls', () => {
  const tops = { a: 10, b: 400 };
  const root = body({ scrollTop: 0, clientHeight: 800, scrollHeight: 2000 }, tops);
  const { result } = renderHook(() => useScrollSpy(root, 'a,b'));
  expect(result.current).toBe('a');
  const [first, second] = [...root.children] as HTMLElement[];
  first.getBoundingClientRect = () => ({ top: 100 - 500 }) as DOMRect;
  second.getBoundingClientRect = () => ({ top: 100 + 100 }) as DOMRect;
  act(() => void root.dispatchEvent(new Event('scroll')));
  expect(result.current).toBe('b');
});

it('measures again when its headings change', () => {
  const root = body({ scrollTop: 0, clientHeight: 800, scrollHeight: 2000 }, { a: 10 });
  const { result, rerender } = renderHook(({ signature }) => useScrollSpy(root, signature), { initialProps: { signature: 'a' } });
  expect(result.current).toBe('a');
  const heading = document.createElement('h2');
  heading.dataset.bookAnchor = 'b';
  heading.getBoundingClientRect = () => ({ top: 100 + 50 }) as DOMRect;
  root.append(heading);
  rerender({ signature: 'a,b' });
  expect(result.current).toBe('b');
});

it('has nothing to follow without a body', () => {
  const { result } = renderHook(() => useScrollSpy(null, ''));
  expect(result.current).toBeNull();
});
