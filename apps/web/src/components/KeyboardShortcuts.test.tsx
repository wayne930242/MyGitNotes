// @vitest-environment jsdom
import { createElement, type ReactNode, useState } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { KeyboardShortcuts, type ShortcutSurfaceMode } from './KeyboardShortcuts.js';
import { setNoteQueryScope } from '../lib/use-note-queries.js';
import { useAppCommands } from '../app/useAppCommands.js';
import { useTranslation } from '../lib/i18n/index.js';
import { KeyboardRoot } from '../lib/keyboard/KeyboardDispatcher.js';
import { KEYMAP } from '../lib/keyboard/keymap.js';

const REVISION = 'a'.repeat(40);
let client: QueryClient;
let openedNotes: string[];

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  openedNotes = [];
  navigatedTo = [];
  searchedList = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setNoteQueryScope({ sourceId: '', revisions: {}, repositories: {}, drafts: {} });
});

const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);

let navigatedTo: string[];
let searchedList: number;

const Surface = ({ noteEditorOpen }: { noteEditorOpen: boolean; }) => {
  const [mode, setMode] = useState<ShortcutSurfaceMode | null>(null);
  const { t } = useTranslation();
  useAppCommands({
    t,
    activeTab: 'notes',
    setActiveTab: tab => {
      navigatedTo.push(tab);
    },
    canCreateNote: true,
    createNote: () => {},
    focusNoteSearch: () => {
      searchedList += 1;
    },
    noteEditorOpen,
    pageCommands: [],
  });
  return createElement(KeyboardShortcuts, {
    mode,
    onModeChange: setMode,
    selectedNotebookId: 'life',
    onOpenNote: note => {
      openedNotes.push(note.path);
    },
  });
};

const Harness = ({ noteEditorOpen = false }: { noteEditorOpen?: boolean; }) => createElement(KeyboardRoot, null, createElement(Surface, { noteEditorOpen }));

const openPalette = async () => {
  fireEvent.keyDown(document, { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true });
  return waitFor(() => document.querySelector<HTMLInputElement>('.keyboard-shortcuts-panel input')!);
};

it('defaults to note search: typing without a prefix never shows the command list', async () => {
  render(createElement(Harness), { wrapper });
  const input = await openPalette();
  fireEvent.change(input, { target: { value: 'notes' } });
  expect(document.querySelector('[data-command-id="nav.notes"]')).toBeNull();
});

it('a leading > reaches the unchanged command list', async () => {
  render(createElement(Harness), { wrapper });
  const input = await openPalette();
  fireEvent.change(input, { target: { value: '>notes' } });
  await waitFor(() => expect(document.querySelector('[data-command-id="nav.notes"]')).not.toBeNull());
});

it('a leading / also reaches the command list', async () => {
  render(createElement(Harness), { wrapper });
  const input = await openPalette();
  fireEvent.change(input, { target: { value: '/notes' } });
  await waitFor(() => expect(document.querySelector('[data-command-id="nav.notes"]')).not.toBeNull());
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
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
  render(createElement(Harness), { wrapper });
  await openPalette();
  await waitFor(() => expect(document.querySelector('.keyboard-shortcuts-empty')).toHaveTextContent('Loading notes'));
  answer(new Response(JSON.stringify({ revision: REVISION, total: 1, nextCursor: null, notes: [{ id: 'notes/life/plan.md', path: 'notes/life/plan.md', notebookId: 'life', title: 'Weekend plan', tags: [], metadata: {} }] }), { headers: { 'Content-Type': 'application/json' } }));
  await waitFor(() => expect(document.querySelector('[data-command-id="notes/life/plan.md"]')).not.toBeNull());
  expect(document.querySelector('.keyboard-shortcuts-empty')).toBeNull();
});

it('searches notes by title and path, opening the selected one on Enter the same way a click would', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, total: 1, nextCursor: null, notes: [{ id: 'notes/life/plan.md', path: 'notes/life/plan.md', notebookId: 'life', title: 'Weekend plan', tags: [], metadata: {} }] }), { headers: { 'Content-Type': 'application/json' } })));
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
  render(createElement(Harness), { wrapper });
  const input = await openPalette();
  fireEvent.change(input, { target: { value: 'plan' } });
  await waitFor(() => expect(document.querySelector('[data-command-id="notes/life/plan.md"]')).not.toBeNull());
  fireEvent.keyDown(document, { key: 'Enter' });
  await waitFor(() => expect(openedNotes).toEqual(['notes/life/plan.md']));
});

it('never opens a note or runs a command while an IME composition is active', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, total: 1, nextCursor: null, notes: [{ id: 'notes/life/plan.md', path: 'notes/life/plan.md', notebookId: 'life', title: 'Weekend plan', tags: [], metadata: {} }] }), { headers: { 'Content-Type': 'application/json' } })));
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
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
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
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

  // Dispatch the closing Enter and the reopening Ctrl+Shift+F inside one batch, so the keydown
  // listener's closure has not yet been re-registered with mode=null when Ctrl+Shift+F fires -
  // this is what the real repro looks like when the two key presses land only a few
  // milliseconds apart in a real browser.
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
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

const openCommandPalette = async () => {
  fireEvent.keyDown(document, { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true });
  return waitFor(() => document.querySelector<HTMLInputElement>('.keyboard-shortcuts-panel input')!);
};

it('Ctrl+Shift+P opens the palette in command mode with > already typed', async () => {
  render(createElement(Harness), { wrapper });
  const input = await openCommandPalette();
  expect(input.value).toBe('>');
  await waitFor(() => expect(document.querySelector('[data-command-id="nav.notes"]')).not.toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(input));
});

it('Ctrl+Shift+P while the palette is in note mode switches it to command mode', async () => {
  render(createElement(Harness), { wrapper });
  const input = await openPalette();
  fireEvent.change(input, { target: { value: 'plan' } });
  fireEvent.keyDown(document, { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(input.value).toBe('>'));
});

it('the header button still opens note search after Ctrl+Shift+P was used', async () => {
  render(createElement(Harness), { wrapper });
  await openCommandPalette();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(document.querySelector('.keyboard-shortcuts-panel')).toBeNull());
  const input = await openPalette();
  expect(input.value).toBe('');
});

it('Alt+/ no longer opens the palette', () => {
  render(createElement(Harness), { wrapper });
  const event = new KeyboardEvent('keydown', { key: '/', code: 'Slash', altKey: true, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  expect(document.querySelector('.keyboard-shortcuts-panel')).toBeNull();
  expect(event.defaultPrevented).toBe(false);
});

it('inside the note editor both Ctrl+Shift+P and Ctrl+Shift+F open the palette', async () => {
  render(createElement(Harness, { noteEditorOpen: true }), { wrapper });
  const input = await openCommandPalette();
  expect(input.value).toBe('>');
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(document.querySelector('.keyboard-shortcuts-panel')).toBeNull());
  const notes = await openPalette();
  expect(notes.value).toBe('');
});

it('Ctrl+Shift+F while the palette is in command mode switches it to note search', async () => {
  render(createElement(Harness), { wrapper });
  const input = await openCommandPalette();
  fireEvent.keyDown(document, { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(input.value).toBe(''));
});

it('each command row shows the id you can type and what the command does', async () => {
  render(createElement(Harness), { wrapper });
  await openCommandPalette();
  const row = await waitFor(() => document.querySelector('[data-command-id="note.new"]')!);
  expect(row).toHaveTextContent('note.new');
  expect(row.querySelector('.keyboard-shortcuts-description')?.textContent).toBeTruthy();
});

it('commands are also found by their description', async () => {
  render(createElement(Harness), { wrapper });
  const input = await openCommandPalette();
  fireEvent.change(input, { target: { value: '>current notebook' } });
  await waitFor(() => expect(document.querySelector('[data-command-id="note.new"]')).not.toBeNull());
});

it('inside the note editor, commands that leave the note are unavailable and notes still open', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, total: 1, nextCursor: null, notes: [{ id: 'notes/life/plan.md', path: 'notes/life/plan.md', notebookId: 'life', title: 'Weekend plan', tags: [], metadata: {} }] }), { headers: { 'Content-Type': 'application/json' } })));
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
  render(createElement(Harness, { noteEditorOpen: true }), { wrapper });
  const input = await openCommandPalette();
  await waitFor(() => expect(document.querySelector('[data-command-id="nav.settings"]')).toBeDisabled());
  expect(document.querySelector('[data-command-id="help.open"]')).not.toBeDisabled();
  fireEvent.change(input, { target: { value: 'plan' } });
  await waitFor(() => expect(document.querySelector('[data-command-id="notes/life/plan.md"]')).not.toBeNull());
  fireEvent.keyDown(document, { key: 'Enter' });
  await waitFor(() => expect(openedNotes).toEqual(['notes/life/plan.md']));
});

it('"Go to Graph" is a command and navigates to the Graph page', async () => {
  render(createElement(Harness), { wrapper });
  const input = await openCommandPalette();
  fireEvent.change(input, { target: { value: '>graph' } });
  await waitFor(() => expect(document.querySelector('[data-command-id="nav.graph"]')).not.toBeNull());
  fireEvent.keyDown(document, { key: 'Enter' });
  await waitFor(() => expect(navigatedTo).toEqual(['graph']));
});

it('"Search the note list" runs the toolbar search focus instead of a stale selector', async () => {
  render(createElement(Harness), { wrapper });
  const input = await openCommandPalette();
  fireEvent.change(input, { target: { value: '>search the note list' } });
  await waitFor(() => expect(document.querySelector('[data-command-id="note.searchList"]')).not.toBeNull());
  fireEvent.keyDown(document, { key: 'Enter' });
  await waitFor(() => expect(searchedList).toBe(1));
  expect(document.querySelector('.keyboard-shortcuts-panel')).toBeNull();
});

const pressHelp = (target: EventTarget) => {
  const event = new KeyboardEvent('keydown', { key: '/', code: 'Slash', ctrlKey: true, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

it('Ctrl+/ opens help inside the Markdown editor, but leaves it to the code-file editor', async () => {
  render(createElement(Harness), { wrapper });
  const markdown = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'cm-content', contentEditable: 'true' }));
  markdown.setAttribute('data-key-scope', 'markdown-editor');
  const code = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'cm-content', contentEditable: 'true' }));
  code.setAttribute('data-key-scope', 'code-editor');

  const inCode = pressHelp(code);
  expect(inCode.defaultPrevented).toBe(false);
  expect(document.querySelector('.keyboard-shortcuts-panel')).toBeNull();

  const inMarkdown = pressHelp(markdown);
  expect(inMarkdown.defaultPrevented).toBe(true);
  await waitFor(() => expect(document.querySelector('.keyboard-shortcuts-panel')).toHaveAttribute('data-mode', 'help'));
  markdown.remove();
  code.remove();
});

it('Ctrl+/ also opens help while a note is zoomed, and pressing it again closes help', async () => {
  render(createElement(Harness, { noteEditorOpen: true }), { wrapper });
  pressHelp(document.body);
  await waitFor(() => expect(document.querySelector('.keyboard-shortcuts-panel')).toHaveAttribute('data-mode', 'help'));
  pressHelp(document.body);
  await waitFor(() => expect(document.querySelector('.keyboard-shortcuts-panel')).toBeNull());
});

it('help lists every registry command, grouped, and its filter matches names and keys', async () => {
  render(createElement(Harness), { wrapper });
  pressHelp(document.body);
  const help = await waitFor(() => document.querySelector<HTMLElement>('.keyboard-shortcuts-panel[data-mode="help"]')!);
  const rows = () => [...help.querySelectorAll('[data-shortcut-id]')].map(row => row.getAttribute('data-shortcut-id'));
  // Every KEYMAP entry plus the palette-only commands registered here (seven of them: five pages, new note, note list search).
  expect(rows()).toHaveLength(KEYMAP.length + 7);
  expect(new Set(rows()).size).toBe(rows().length);
  expect(rows()).toEqual(expect.arrayContaining(['palette.notes', 'palette.commands', 'help.open', 'editor.leader', 'format.bold', 'nav.graph', 'note.searchList']));
  expect([...help.querySelectorAll('section h3')].map(heading => heading.textContent)).toEqual(expect.arrayContaining(['General', 'Go to', 'Quick open', 'Editor', 'Find', 'Outline', 'Table', 'Image viewer']));
  const filter = help.querySelector<HTMLInputElement>('input[type="search"]')!;
  fireEvent.change(filter, { target: { value: 'ctrl+shift+p' } });
  expect(rows()).toEqual(['palette.commands']);
  fireEvent.change(filter, { target: { value: 'graph' } });
  expect(rows()).toEqual(expect.arrayContaining(['nav.graph', 'graph.toggleExpand']));
  expect(rows()).not.toContain('palette.notes');
});
