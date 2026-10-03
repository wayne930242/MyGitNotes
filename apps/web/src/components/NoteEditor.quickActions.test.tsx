// @vitest-environment jsdom
import { type ChangeEvent, createElement, forwardRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PanelProvider } from '../lib/panel-context.js';
import type { NoteItem } from '../lib/types.js';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.js';

vi.mock('./MarkdownEditor.js', () => ({ MarkdownEditorModeSwitch: () => null, MarkdownEditor: forwardRef<unknown, { content: string; onChange: (content: string) => void; }>(({ content, onChange }, _ref) => createElement('textarea', { 'aria-label': 'Note content', value: content, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) })) }));

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const note: NoteItem = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha' }, content: '# Alpha\n' };
const editor = (props: Partial<NoteEditorProps>) => createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'pane', active: true, statuses: [], autoSave: true, onSave: async () => note, onRestoreFile: async () => null, onCommitFile: async () => {}, branch: 'main', draftScope: 'src:main', ...props } as NoteEditorProps));
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

it('shows neither the path nor the actions while the note is clean', () => {
  render(editor({}));
  expect(screen.queryByRole('button', { name: /commit/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /restore/i })).toBeNull();
  expect(screen.queryByText(note.path)).toBeNull();
});

it('shows no actions for a read-only note', () => {
  render(editor({ isDirty: true, readOnly: true }));
  expect(screen.queryByRole('button', { name: /commit/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /restore/i })).toBeNull();
});

it('commits the note only on a confirming second click, saving pending edits first', async () => {
  const calls: string[] = [];
  const onSave = vi.fn(async ({ content, metadata }: { content: string; metadata?: Record<string, unknown>; }) => {
    calls.push(`save:${content}`);
    return { ...note, content, metadata: metadata ?? {} };
  });
  const onCommitFile = vi.fn(async (path: string) => {
    calls.push(`commit:${path}`);
  });
  render(editor({ isDirty: true, onSave, onCommitFile }));
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: '# Alpha\nMore.' } });

  fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
  await flush();
  expect(onCommitFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Click again to commit' }));
  await flush();

  expect(calls).toEqual(['save:# Alpha\nMore.', 'commit:notes/a.md']);
  // The superseded autosave does not write the same edit again after the commit.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(onSave).toHaveBeenCalledTimes(1);
});

it('disarms an action when its confirming click does not come in time', async () => {
  const onCommitFile = vi.fn(async () => {});
  render(editor({ isDirty: true, onCommitFile }));
  fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
  await flush();
  expect(onCommitFile).not.toHaveBeenCalled();
});

it('restores the note on a confirming second click and shows the restored content', async () => {
  const restored: NoteItem = { ...note, content: '# Alpha\nCommitted.' };
  const onRestoreFile = vi.fn(async () => restored);
  render(editor({ isDirty: true, onRestoreFile }));

  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
  await flush();
  expect(onRestoreFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Click again to discard' }));
  await flush();

  expect(onRestoreFile).toHaveBeenCalledWith('notes/a.md');
  expect((screen.getByLabelText('Note content') as HTMLTextAreaElement).value).toBe('# Alpha\nCommitted.');
});

it('offers only Restore when the note cannot be committed from the editor', () => {
  render(editor({ isDirty: true, onCommitFile: undefined }));
  expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
});

const stats = (added: number, removed: number) => `Lines changed since the last commit: ${added} added, ${removed} removed`;

it('shows the uncommitted line counts beside the actions of a dirty note', async () => {
  const readDiff = vi.fn(async () => '--- a\n+++ b\n@@ -1,2 +1,3 @@\n-old\n+new\n+more\n keep\n');
  render(editor({ isDirty: true, readDiff }));
  await flush();
  expect(screen.getByRole('img', { name: stats(2, 1) }).textContent).toBe('+2−1');
});

it('neither reads nor shows line counts for a clean note', async () => {
  const readDiff = vi.fn(async () => '');
  render(editor({ readDiff }));
  await flush();
  expect(readDiff).not.toHaveBeenCalled();
  expect(screen.queryByRole('img', { name: /Lines changed/ })).toBeNull();
});

it('reads the line counts again once an edit is saved', async () => {
  const readDiff = vi.fn(async () => '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n');
  render(editor({ isDirty: true, readDiff, onSave: async ({ content }: { content: string; }) => ({ ...note, content }) }));
  await flush();
  expect(screen.getByRole('img', { name: stats(1, 1) })).toBeTruthy();

  readDiff.mockResolvedValue('--- a\n+++ b\n@@ -1 +1,3 @@\n-old\n+new\n+one\n+two\n');
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: '# Alpha\nMore.' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  await flush();

  expect(readDiff.mock.calls.length).toBeGreaterThan(1);
  expect(screen.getByRole('img', { name: stats(3, 1) })).toBeTruthy();
});

it('refreshes a clean note by adopting its latest version without merging', async () => {
  const latest: NoteItem = { ...note, content: '# Alpha\nFrom elsewhere.' };
  const onReadRemote = vi.fn(async () => note);
  const onSave = vi.fn(async () => note);
  render(editor({ onReadRemote, onSave }));
  await flush();
  onReadRemote.mockResolvedValue(latest);

  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await flush();

  expect((screen.getByLabelText('Note content') as HTMLTextAreaElement).value).toBe('# Alpha\nFrom elsewhere.');
  expect(screen.queryByText(/merged/i)).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  // Adopting the latest version is not an edit, so nothing is written back.
  expect(onSave).not.toHaveBeenCalled();
});

it('refreshes a note with local edits by merging its latest version into them', async () => {
  const base: NoteItem = { ...note, content: 'one\ntwo\nthree\n' };
  const onReadRemote = vi.fn(async () => base);
  render(editor({ note: base, onReadRemote, onSave: async ({ content }: { content: string; }) => ({ ...base, content }) }));
  await flush();
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'ONE\ntwo\nthree\n' } });
  onReadRemote.mockResolvedValue({ ...base, content: 'one\ntwo\nTHREE\n' });

  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await flush();

  expect((screen.getByLabelText('Note content') as HTMLTextAreaElement).value).toBe('ONE\ntwo\nTHREE\n');
});
