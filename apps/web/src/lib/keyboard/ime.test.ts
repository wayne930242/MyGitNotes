// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCompositionTracker, skipForComposition } from './ime.js';

let detach: () => void;
const tracker = createCompositionTracker();
beforeEach(() => {
  detach = tracker.attach(document);
});
afterEach(() => {
  detach();
  vi.useRealTimers();
});

const key = (init: KeyboardEventInit & { keyCode?: number; }) => new KeyboardEvent('keydown', init);

it('skips keys while the IME composes, by flag or by keyCode 229', () => {
  expect(skipForComposition(key({ key: 'Enter', isComposing: true }), tracker)).toBe(true);
  expect(skipForComposition(key({ key: 'Process', keyCode: 229 }), tracker)).toBe(true);
  expect(skipForComposition(key({ key: 'Enter' }), tracker)).toBe(false);
});

it('skips the Enter Safari sends right after compositionend, then lets Enter through again', () => {
  vi.useFakeTimers();
  document.dispatchEvent(new CompositionEvent('compositionend', { data: '資料' }));
  expect(skipForComposition(key({ key: 'Enter', isComposing: false }), tracker)).toBe(true);
  vi.runAllTimers();
  expect(skipForComposition(key({ key: 'Enter' }), tracker)).toBe(false);
});

it('stops the window after 100 ms even when the next task is late', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  document.dispatchEvent(new CompositionEvent('compositionend', { data: '中' }));
  vi.setSystemTime(Date.now() + 150);
  expect(skipForComposition(key({ key: 'Enter' }), tracker)).toBe(false);
});

it('never skips a Mod chord, which some IMEs report as 229', () => {
  expect(skipForComposition(key({ key: 'Process', code: 'KeyK', keyCode: 229, metaKey: true }), tracker)).toBe(false);
  expect(skipForComposition(key({ key: 'k', ctrlKey: true, isComposing: true }), tracker)).toBe(false);
});
