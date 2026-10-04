// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useBookmarkActions } from './useBookmarkActions.js';
import { captureTextAnchor } from '@mygitnotes/core/bookmark-anchor';
import { emptyBookmarksPage } from '@mygitnotes/core/bookmarks';
import type { BookmarksController } from '../lib/use-bookmarks.js';
import type { NoteItem } from '../lib/types.js';
const read = vi.hoisted(() => vi.fn());
vi.mock('../lib/api.js', () => ({ readNote: read }));
vi.mock('../lib/i18n/index.js', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
const note: NoteItem = { notebookId: 'n', path: 'notes/n/a.md', id: 'a', title: 'A', content: 'Saved paragraph', metadata: {}, tags: [] };
const anchor = captureTextAnchor(note.content, { from: 0, to: note.content.length }, 'paragraph');
const fields = { label: 'Position', groupId: null, target: { kind: 'position' as const, path: 'a.md', anchor } };
const repository = { id: 'github:a/b@main', type: 'github' as const, branch: 'main', revision: 'head', write: true, notebooks: ['n'] };
beforeEach(() => read.mockReset());
function setup(remote = true, flush = async () => true, commit = async () => {}) {
  const change = vi.fn();
  const controller = { page: emptyBookmarksPage(), repository: repository.id, writable: true, loading: false, error: '', change } as unknown as BookmarksController;
  const hook = renderHook(() => useBookmarkActions({ controller, config: { schema_version: 1, workspace: { title: 'Test', default_notebook: 'n' }, notebooks: [{ id: 'n', root: 'notes/n', title: 'N' }] }, folders: [], repositoryFor: () => repository, remote, readDraft: () => remote ? { note, base: note } : undefined, refreshKey: '', selectedNotebookId: 'n', captureView: vi.fn(), sort: { field: 'title', order: 'asc' }, view: 'list', prepareLeave: async () => true, flushEditors: flush, commitNoteFile: commit, openNote: vi.fn(), navigate: vi.fn(), onError: vi.fn() }));
  return { ...hook, change };
}
it('remote position creation flushes then explicitly commits before reading saved source', async () => {
  const order: string[] = [];
  read.mockImplementation(async () => {
    order.push('read');
    return note;
  });
  const hook = setup(true, async () => {
    order.push('flush');
    return true;
  }, async () => {
    order.push('commit');
  });
  await act(async () => hook.result.current.value.bookmarkPosition(note, anchor));
  await waitFor(() => expect(hook.result.current.dialog).not.toBeNull());
  await act(async () => hook.result.current.dialog!.onSave(fields));
  expect(order).toEqual(['flush', 'commit', 'read']);
  expect(hook.change).toHaveBeenCalledOnce();
});
it('failed flush or commit preserves the picker and creates no bookmark', async () => {
  for (const fail of ['flush', 'commit']) {
    const hook = setup(true, async () => fail !== 'flush', async () => {
      throw new Error('commit failed');
    });
    await act(async () => hook.result.current.value.bookmarkPosition(note, anchor));
    await act(async () => {
      await expect(hook.result.current.dialog!.onSave(fields)).rejects.toThrow();
    });
    expect(hook.change).not.toHaveBeenCalled();
    expect(hook.result.current.dialog).not.toBeNull();
    hook.unmount();
  }
  expect(read).not.toHaveBeenCalled();
});
it('local position creation reads after flush without committing and rejects changed selection', async () => {
  const commit = vi.fn();
  read.mockResolvedValue({ ...note, content: 'Rewritten' });
  const hook = setup(false, async () => true, commit);
  await act(async () => hook.result.current.value.bookmarkPosition(note, anchor));
  await act(async () => {
    await expect(hook.result.current.dialog!.onSave(fields)).rejects.toThrow('bookmarks.changedSelection');
  });
  expect(commit).not.toHaveBeenCalled();
  expect(hook.change).not.toHaveBeenCalled();
});
