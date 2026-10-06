// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { MarkdownEditor } from './MarkdownEditor.js';

beforeEach(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);
// One Radix menu opening per file: in jsdom a second toolbar menu in the same file does not open.

function Editor({ initial, mode }: { initial: string; mode: 'raw' | 'live'; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { content, path: 'notes/a.md', mode, readOnly: false, onChange: setContent, ariaLabel: 'Note content' });
}
const mount = (initial: string, mode: 'raw' | 'live') => render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(Editor, { initial, mode }))));
const chooseInfoBlock = async () => {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Insert block' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Info' }));
};

it('inserts a block from the live toolbar with exactly one blank line on either side', async () => {
  mount('first\nsecond', 'live');
  const view = EditorView.findFromDOM(await screen.findByRole('textbox', { name: 'Note content' }, { timeout: 5000 }))!;
  act(() => view.dispatch({ selection: { anchor: 6 } }));
  await chooseInfoBlock();
  const doc = view.state.doc.toString();
  expect(doc).toMatch(/^first\n\n:::info\n[^]*\n:::\n\nsecond$/);
  // The cursor waits on the blank line after the block.
  expect(doc.slice(view.state.selection.main.head)).toBe('\nsecond');
});
