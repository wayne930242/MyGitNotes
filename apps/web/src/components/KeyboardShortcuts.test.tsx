// @vitest-environment jsdom
import { createElement, type ReactNode, useState } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { KeyboardShortcuts, type ShortcutSurfaceMode } from './KeyboardShortcuts.js';
import { setNoteQueryScope } from '../lib/use-note-queries.js';

const REVISION = 'a'.repeat(40);
let client: QueryClient;
let openedNotes: string[];

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  openedNotes = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setNoteQueryScope({ sourceId: '', revision: '', drafts: {} });
});

const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);

const Harness = () => {
  const [mode, setMode] = useState<ShortcutSurfaceMode | null>(null);
  return createElement(KeyboardShortcuts, {
    mode,
    onModeChange: setMode,
    activeTab: 'notes',
    canCreateNote: true,
    selectedNotebookId: 'life',
    onNavigate: () => {},
    onCreateNote: () => {},
    onFocusSearch: () => {},
    onOpenNote: note => {
      openedNotes.push(note.path);
    },
  });
};

const openPalette = async () => {
  fireEvent.keyDown(document, { key: '/', code: 'Slash', altKey: true });
  return waitFor(() => document.querySelector<HTMLInputElement>('.keyboard-shortcuts-panel input')!);
};

it('defaults to note search: typing without a prefix never shows the command list', async () => {
  render(createElement(Harness), { wrapper });
  const input = await openPalette();
  fireEvent.change(input, { target: { value: 'notes' } });
  expect(document.querySelector('[data-command-id="notes"]')).toBeNull();
});

it('a leading > reaches the unchanged command list', async () => {
  render(createElement(Harness), { wrapper });
  const input = await openPalette();
  fireEvent.change(input, { target: { value: '>notes' } });
  await waitFor(() => expect(document.querySelector('[data-command-id="notes"]')).not.toBeNull());
});

it('a leading / also reaches the command list', async () => {
  render(createElement(Harness), { wrapper });
  const input = await openPalette();
  fireEvent.change(input, { target: { value: '/notes' } });
  await waitFor(() => expect(document.querySelector('[data-command-id="notes"]')).not.toBeNull());
});

it('shows a loading status instead of "no matching notes" while note candidates are still loading', async () => {
  let answer: (response: Response) => void = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      new Promise<Response>(resolve => {
        answer = resolve;
      })
    ),
  );
  setNoteQueryScope({ sourceId: 'github:me/notes', revision: REVISION, drafts: {} });
  render(createElement(Harness), { wrapper });
  await openPalette();
  await waitFor(() => expect(document.querySelector('.keyboard-shortcuts-empty')).toHaveTextContent('Loading notes'));
  answer(new Response(JSON.stringify({ revision: REVISION, total: 1, nextCursor: null, notes: [{ id: 'notes/life/plan.md', path: 'notes/life/plan.md', notebookId: 'life', title: 'Weekend plan', tags: [], metadata: {} }] }), { headers: { 'Content-Type': 'application/json' } }));
  await waitFor(() => expect(document.querySelector('[data-command-id="notes/life/plan.md"]')).not.toBeNull());
  expect(document.querySelector('.keyboard-shortcuts-empty')).toBeNull();
});

it('searches notes by title and path, opening the selected one on Enter the same way a click would', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, total: 1, nextCursor: null, notes: [{ id: 'notes/life/plan.md', path: 'notes/life/plan.md', notebookId: 'life', title: 'Weekend plan', tags: [], metadata: {} }] }), { headers: { 'Content-Type': 'application/json' } })));
  setNoteQueryScope({ sourceId: 'github:me/notes', revision: REVISION, drafts: {} });
  render(createElement(Harness), { wrapper });
  const input = await openPalette();
  fireEvent.change(input, { target: { value: 'plan' } });
  await waitFor(() => expect(document.querySelector('[data-command-id="notes/life/plan.md"]')).not.toBeNull());
  fireEvent.keyDown(document, { key: 'Enter' });
  await waitFor(() => expect(openedNotes).toEqual(['notes/life/plan.md']));
});

it('never opens a note or runs a command while an IME composition is active', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, total: 1, nextCursor: null, notes: [{ id: 'notes/life/plan.md', path: 'notes/life/plan.md', notebookId: 'life', title: 'Weekend plan', tags: [], metadata: {} }] }), { headers: { 'Content-Type': 'application/json' } })));
  setNoteQueryScope({ sourceId: 'github:me/notes', revision: REVISION, drafts: {} });
  render(createElement(Harness), { wrapper });
  const input = await openPalette();
  fireEvent.change(input, { target: { value: 'plan' } });
  await waitFor(() => expect(document.querySelector('[data-command-id="notes/life/plan.md"]')).not.toBeNull());
  fireEvent.keyDown(document, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
  expect(openedNotes).toEqual([]);
  expect(document.querySelector('.keyboard-shortcuts-panel')).not.toBeNull();
});

it('uses a valid option id for a note path containing spaces', async () => {
  const path = 'notes/life/weekend plan.md';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, total: 1, nextCursor: null, notes: [{ id: path, path, notebookId: 'life', title: 'Weekend plan', tags: [], metadata: {} }] }), { headers: { 'Content-Type': 'application/json' } })));
  setNoteQueryScope({ sourceId: 'github:me/notes', revision: REVISION, drafts: {} });
  render(createElement(Harness), { wrapper });
  const input = await openPalette();
  fireEvent.change(input, { target: { value: 'plan' } });
  await waitFor(() => expect(document.querySelector(`[data-command-id="${path}"]`)).not.toBeNull());
  const option = document.querySelector(`[data-command-id="${path}"]`)!;
  expect(option.id).not.toMatch(/\s/);
  expect(input.getAttribute('aria-activedescendant')).toBe(option.id);
});

it('reopening right after a normal close resets the query and focuses the input', async () => {
  render(createElement(Harness), { wrapper });
  const input = await openPalette();
  fireEvent.change(input, { target: { value: '>notes' } });
  fireEvent.keyDown(document, { key: 'Enter' });
  await waitFor(() => expect(document.querySelector('.keyboard-shortcuts-panel')).toBeNull());

  const input2 = await openPalette();
  expect(input2.value).toBe('');
  await waitFor(() => expect(document.activeElement).toBe(input2));
});

it('reopening before the previous close has been picked up by the listener still opens with a reset query', async () => {
  render(createElement(Harness), { wrapper });
  const input = await openPalette();
  fireEvent.change(input, { target: { value: '>notes' } });

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
  render(createElement(Harness), { wrapper });
  const input = await openPalette();
  fireEvent.keyDown(input, { key: 'N', shiftKey: true });
  fireEvent.change(input, { target: { value: 'N' } });
  expect(document.querySelector('.keyboard-shortcuts-panel')).not.toBeNull();
  expect(input.value).toBe('N');
});
