// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { EditorView } from '@codemirror/view';
import { PanelProvider } from '../lib/panel-context.js';
import { OutlineActionsProvider, type OutlineInsertionRequest } from '../lib/outline-actions.js';
import { saveLocalDraft } from '../lib/storage.js';
import { NoteEditor } from './NoteEditor.js';

const note = { id: 'plan', notebookId: 'a', path: 'notes/shared/plan.outline.md', title: 'Plan', content: '- Saved', tags: [], metadata: { title: 'Plan' } };
const source = { notebookId: 'a', path: 'notes/shared/source.md', title: 'Source' };
const request = { id: 1, destination: note, source };
const error = vi.fn();
const saved = vi.fn(async ({ content }: { content: string; }) => ({ ...note, content }));
function Harness({ readOnly = false, initialRequest = false, content = note.content }: { readOnly?: boolean; initialRequest?: boolean; content?: string; }) {
  const [pending, setPending] = useState<OutlineInsertionRequest | null>(initialRequest ? request : null);
  const claimed = useRef(false);
  return (
    <OutlineActionsProvider
      value={{
        add: () => {},
        canAdd: () => true,
        pending,
        cancel: () => setPending(null),
        error,
        consume: () => {
          if (claimed.current) return false;
          claimed.current = true;
          setPending(null);
          return true;
        },
      }}
    >
      <button onClick={() => setPending(request)}>Queue link</button>
      <NoteEditor note={{ ...note, content }} frame='pane' active statuses={[]} autoSave={false} readOnly={readOnly} onSave={saved} onRestoreFile={async () => null} branch='main' draftScope='fixture:a' />
    </OutlineActionsProvider>
  );
}
function mount(props: Parameters<typeof Harness>[0] = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <PanelProvider>
          <Harness {...props} />
        </PanelProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('github-notes:language', 'en');
  error.mockClear();
  saved.mockClear();
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);
it('inserts into the actual dirty raw destination once and participates in its undo/redo', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Source' }));
  const text = screen.getByRole('textbox', { name: 'Note content' }) as HTMLTextAreaElement;
  fireEvent.change(text, { target: { value: '- Dirty\n  annotation\n  - Child' } });
  fireEvent.click(screen.getByText('Queue link'));
  const expected = '- Dirty\n  annotation\n  - Child\n\n- [Source](source.md)\n';
  await waitFor(() => expect(text.value).toBe(expected));
  fireEvent.keyDown(text, { key: 'z', ctrlKey: true });
  expect(text.value).toBe('- Dirty\n  annotation\n  - Child');
  fireEvent.keyDown(text, { key: 'y', ctrlKey: true });
  expect(text.value).toBe(expected);
  expect(saved).not.toHaveBeenCalled(); // normal explicit-save lifecycle, no append API
});
it('waits for recovery choice and lazy-mounted live editor, preserving the recovered body', async () => {
  saveLocalDraft('fixture:a', note.path, '- Recovered\n  - Child', note.metadata);
  mount({ initialRequest: true });
  expect(screen.getByText(/Restore or discard the recovered draft/)).toBeInTheDocument();
  await screen.findByRole('textbox', { name: 'Note content' });
  expect(EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Note content' }))?.state.doc.toString()).toBe('- Saved');
  fireEvent.click(screen.getByRole('button', { name: 'Restore Draft' }));
  await waitFor(() => expect(EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Note content' }))?.state.doc.toString()).toBe('- Recovered\n  - Child\n\n- [Source](source.md)\n'));
  expect(error).not.toHaveBeenCalled();
});
it('can cancel while recovery is pending without appending when recovery is later restored', async () => {
  saveLocalDraft('fixture:a', note.path, '- Recovery', note.metadata);
  mount({ initialRequest: true });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Restore Draft' }));
  await waitFor(() => expect(EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Note content' }))?.state.doc.toString()).toBe('- Recovery'));
});
it('inserts a CRLF source link as one normalized live transaction with a valid caret and undo/redo', async () => {
  mount({ initialRequest: true, content: '\r\n- Saved\r\n' });
  const text = await screen.findByRole('textbox', { name: 'Note content' });
  const body = () => EditorView.findFromDOM(text)?.state.doc.toString();
  await waitFor(() => expect(body()).toBe('\n- Saved\n\n- [Source](source.md)\n'));
  fireEvent.keyDown(text, { key: 'z', keyCode: 90, ctrlKey: true });
  expect(body()).toBe('\n- Saved\n');
  fireEvent.keyDown(text, { key: 'y', keyCode: 89, ctrlKey: true });
  expect(body()).toBe('\n- Saved\n\n- [Source](source.md)\n');
});

it.each([true, false])('does not insert into a locked editor or unfinished block (readOnly=%s)', async readOnly => {
  mount({ readOnly, initialRequest: true, content: readOnly ? '- Saved' : '```md\nunclosed' });
  await waitFor(() => expect(error).toHaveBeenCalledWith(readOnly ? 'This notebook is read-only.' : expect.stringContaining('unfinished Markdown block')));
  await act(async () => {});
  expect(saved).not.toHaveBeenCalled();
});
