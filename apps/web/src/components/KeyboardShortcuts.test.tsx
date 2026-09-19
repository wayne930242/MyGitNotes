// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { KeyboardShortcuts, type ShortcutSurfaceMode } from './KeyboardShortcuts.js';

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => cleanup());

const Harness = () => {
  const [mode, setMode] = useState<ShortcutSurfaceMode | null>(null);
  return createElement(KeyboardShortcuts, { mode, onModeChange: setMode, activeTab: 'notes', canCreateNote: true, onNavigate: () => {}, onCreateNote: () => {}, onFocusSearch: () => {} });
};

const openPalette = async () => {
  fireEvent.keyDown(document, { key: '/', code: 'Slash', altKey: true });
  return waitFor(() => document.querySelector<HTMLInputElement>('.keyboard-shortcuts-panel input')!);
};

it('reopening right after a normal close resets the query and focuses the input', async () => {
  render(createElement(Harness));
  const input = await openPalette();
  fireEvent.change(input, { target: { value: 'notes' } });
  fireEvent.keyDown(document, { key: 'Enter' });
  await waitFor(() => expect(document.querySelector('.keyboard-shortcuts-panel')).toBeNull());

  const input2 = await openPalette();
  expect(input2.value).toBe('');
  await waitFor(() => expect(document.activeElement).toBe(input2));
});

it('reopening before the previous close has been picked up by the listener still opens with a reset query', async () => {
  render(createElement(Harness));
  const input = await openPalette();
  fireEvent.change(input, { target: { value: 'notes' } });

  // Dispatch the closing Enter and the reopening Alt+/ inside one batch, so the keydown
  // listener's closure has not yet been re-registered with mode=null when Alt+/ fires -
  // this is what the real repro looks like when the two key presses land only a few
  // milliseconds apart in a real browser.
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', altKey: true, bubbles: true, cancelable: true }));
  });

  const input2 = await waitFor(() => document.querySelector<HTMLInputElement>('.keyboard-shortcuts-panel input')!);
  expect(input2.value).toBe('');
  await waitFor(() => expect(document.activeElement).toBe(input2));
});

it('typing a command name that starts with an accelerator letter reaches the query instead of firing the accelerator', async () => {
  render(createElement(Harness));
  const input = await openPalette();
  fireEvent.keyDown(input, { key: 'N', shiftKey: true });
  fireEvent.change(input, { target: { value: 'N' } });
  expect(document.querySelector('.keyboard-shortcuts-panel')).not.toBeNull();
  expect(input.value).toBe('N');
});
