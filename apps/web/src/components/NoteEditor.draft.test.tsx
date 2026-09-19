// @vitest-environment jsdom
import { createElement, forwardRef, type ChangeEvent } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PanelProvider } from '../lib/panel-context.js';
import { getLocalDraft } from '../lib/storage.js';
import type { NoteItem } from '../lib/types.js';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.js';

vi.mock('./MarkdownEditor.js', () => ({
  MarkdownEditorModeSwitch: () => null,
  MarkdownEditor: forwardRef<unknown, { content: string; onChange: (content: string) => void }>(({ content, onChange }, _ref) =>
    createElement('textarea', { 'aria-label': 'Note content', value: content, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) })),
}));

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const note: NoteItem = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha', updated: 't0' }, content: '# Alpha\n' };
const editor = (props: Partial<NoteEditorProps>) => createElement(PanelProvider, null, createElement(NoteEditor, {
  note, frame: 'pane', active: true, statuses: [], autoSave: true, onSave: async () => note, onRestoreFile: async () => null,
  branch: 'main', draftScope: 'src:main', ...props,
} as NoteEditorProps));

it('leaves no recovery draft once an autosave succeeds, even while the refreshed note arrives later', async () => {
  const onSave = vi.fn(async ({ content, metadata }: { content: string; metadata?: Record<string, unknown> }) =>
    ({ ...note, content, metadata: { ...metadata, updated: `t${onSave.mock.calls.length}` } }));
  const view = render(editor({ onSave }));
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: '# Alpha\nMore.' } });
  expect(getLocalDraft('src:main', note.path)?.content).toBe('# Alpha\nMore.');

  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(onSave).toHaveBeenCalledTimes(1);
  // The saved note reaches the editor after its notes refetch, as `invalidateNotes` does.
  const saved = await onSave.mock.results[0].value;
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  view.rerender(editor({ onSave, note: saved }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

  expect(getLocalDraft('src:main', note.path)).toBeNull();
  view.unmount();
  render(editor({ onSave, note: saved }));
  expect(screen.queryByText(/recover|unsaved draft/i)).toBeNull();
});

it('keeps a recovery draft for edits that were not saved', async () => {
  const onSave = vi.fn(async () => { throw new Error('disk full'); });
  const view = render(editor({ onSave }));
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: '# Alpha\nUnsaved.' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  view.unmount();
  expect(getLocalDraft('src:main', note.path)?.content).toBe('# Alpha\nUnsaved.');
});

it('does not report its own autosave as an external change on the next remote check', async () => {
  let diskNote: NoteItem = note;
  const onSave = vi.fn(async ({ content, metadata }: { content: string; metadata?: Record<string, unknown> }) => {
    diskNote = { ...note, content, metadata: { ...metadata, updated: `t${onSave.mock.calls.length}` } };
    return diskNote;
  });
  const onReadRemote = vi.fn(async () => diskNote);
  render(editor({ onSave, onReadRemote }));
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: '# Alpha\nMore.' } });

  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(onSave).toHaveBeenCalledTimes(1);

  // Past the remote-check throttle, so the interval fires again and re-reads the note.
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(onReadRemote.mock.calls.length).toBeGreaterThan(1);
  expect(screen.queryByText(/Remote changes merged/i)).toBeNull();
  expect((screen.getByLabelText('Note content') as HTMLTextAreaElement).value).toBe('# Alpha\nMore.');
});
