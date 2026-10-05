// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { MarkdownEditor } from './MarkdownEditor.js';
import { formatKeymap } from './live-markdown/format-commands.js';

afterEach(cleanup);

function SourceEditor({ initial, toolbarSlot }: { initial: string; toolbarSlot?: HTMLElement | null; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { content, path: 'notes/a.md', mode: 'raw', readOnly: false, onChange: setContent, ariaLabel: 'Note content', toolbarSlot });
}

const renderSource = (initial: string, toolbarSlot?: HTMLElement | null) => render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(SourceEditor, { initial, toolbarSlot })));

it('toggles bold, italic and underline on the source selection with Ctrl+B, Ctrl+I and Ctrl+U', async () => {
  renderSource('a word b');
  const textarea = screen.getByLabelText<HTMLTextAreaElement>('Note content');
  textarea.setSelectionRange(2, 6);

  fireEvent.keyDown(textarea, { key: 'b', ctrlKey: true });
  expect(textarea.value).toBe('a **word** b');
  await waitFor(() => expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([4, 8]));

  fireEvent.keyDown(textarea, { key: 'b', ctrlKey: true });
  expect(textarea.value).toBe('a word b');
  await waitFor(() => expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 6]));

  fireEvent.keyDown(textarea, { key: 'i', ctrlKey: true });
  expect(textarea.value).toBe('a *word* b');
  await waitFor(() => expect(textarea.selectionStart).toBe(3));

  fireEvent.keyDown(textarea, { key: 'u', ctrlKey: true });
  expect(textarea.value).toBe('a *<u>word</u>* b');
});

it('leaves other Ctrl shortcuts to the browser', () => {
  renderSource('a word b');
  const textarea = screen.getByLabelText<HTMLTextAreaElement>('Note content');
  textarea.setSelectionRange(2, 6);
  fireEvent.keyDown(textarea, { key: 'b', ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(textarea, { key: 'k', ctrlKey: true });
  expect(textarea.value).toBe('a word b');
});

it('formats from the toolbar it renders into the slot, with the insert actions beside it', () => {
  const slot = document.createElement('div');
  document.body.append(slot);
  renderSource('title', slot);
  const textarea = screen.getByLabelText<HTMLTextAreaElement>('Note content');
  textarea.setSelectionRange(1, 1);

  const toolbar = screen.getByRole('toolbar', { name: 'Formatting toolbar' });
  expect(slot).toContainElement(toolbar);
  for (const name of ['Insert note link', 'Insert table', 'Insert block']) expect(toolbar).toContainElement(screen.getByRole('button', { name }));
  fireEvent.click(screen.getByRole('button', { name: 'Heading 2' }));
  expect(textarea.value).toBe('## title');
  slot.remove();
});

it('renders no toolbar when the slot is null', () => {
  renderSource('title', null);
  expect(screen.queryByRole('toolbar')).toBeNull();
});

it('binds Mod-b, Mod-i and Mod-u in the live editor ahead of the default keymap', () => {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'a word b', selection: EditorSelection.range(2, 6), extensions: [formatKeymap] }) });
  const press = (key: string) => runScopeHandlers(view, new KeyboardEvent('keydown', { key, ctrlKey: true }), 'editor');

  expect(press('u')).toBe(true);
  expect(view.state.doc.toString()).toBe('a <u>word</u> b');
  expect(press('u')).toBe(true);
  expect(view.state.doc.toString()).toBe('a word b');
  press('b');
  press('i');
  expect(view.state.doc.toString()).toBe('a ***word*** b');
  view.destroy();
});

it('keeps the source selection and scroll when the note is rewritten elsewhere, following lines added above them', () => {
  const lines = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`);
  const content = lines.join('\n');
  const onChange = vi.fn();
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <MarkdownEditor content={content} path='notes/a.md' mode='raw' readOnly={false} onChange={onChange} ariaLabel='Source' toolbarSlot={null} />
    </QueryClientProvider>,
  );
  const textarea = screen.getByLabelText<HTMLTextAreaElement>('Source');
  const at = content.indexOf('line 60');
  textarea.setSelectionRange(at, at + 'line 60'.length);
  textarea.scrollTop = 900;
  fireEvent.scroll(textarea);
  fireEvent.select(textarea);
  // An agent adds a line near the top, above the visible text.
  const rewritten = ['line 1', 'added by Pi', ...lines.slice(1)].join('\n');
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <MarkdownEditor content={rewritten} path='notes/a.md' mode='raw' readOnly={false} onChange={onChange} ariaLabel='Source' toolbarSlot={null} />
    </QueryClientProvider>,
  );
  expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('line 60');
  expect(textarea.scrollTop).toBe(900 + 22.75);
  expect(onChange).not.toHaveBeenCalled();
});
