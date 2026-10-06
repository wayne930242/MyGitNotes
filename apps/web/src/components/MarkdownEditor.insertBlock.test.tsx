// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
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

it('inserts a block from the source toolbar with exactly one blank line on either side', async () => {
  mount('first\n\n\nsecond', 'raw');
  const textarea = screen.getByLabelText<HTMLTextAreaElement>('Note content');
  textarea.setSelectionRange(7, 7);
  await chooseInfoBlock();
  expect(textarea.value).toMatch(/^first\n\n:::info\n[^]*\n:::\n\nsecond$/);
});
