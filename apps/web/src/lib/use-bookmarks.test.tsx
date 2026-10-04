// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { addBookmark, emptyBookmarksPage } from '@mygitnotes/core/bookmarks';
import { bookmarksDocumentClient, useBookmarks } from './use-bookmarks.js';
import { documentDraftKey, readDocumentDraft, settleDocumentDraft } from './use-workspace-document.js';
vi.mock('./i18n/index.js', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
const empty = emptyBookmarksPage();
const page = addBookmark(empty, 'n', { id: 'a', label: 'A', groupId: null, target: { kind: 'note', path: 'a.md' } });
const record = (page: unknown, revision: string) => new Response(JSON.stringify({ page, revision, writable: true, path: '.mygitnotes-bookmarks.yaml' }));
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());
it('ignores a late repository response and hides write controls while switching', async () => {
  let first!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.includes('repository=one')
        ? new Promise<Response>(resolve => {
          first = resolve;
        })
        : Promise.resolve(record(empty, 'two'))
    ),
  );
  const hook = renderHook(({ repository }) => useBookmarks(repository, () => {}, true), { initialProps: { repository: 'one' } });
  hook.rerender({ repository: 'two' });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => first(record(page, 'one')));
  expect(hook.result.current.page).toEqual(empty);
  expect(hook.result.current.repository).toBe('two');
});
it('preserves unrelated-tab draft/base during commit settlement', () => {
  const key = documentDraftKey(bookmarksDocumentClient, 'repo');
  const latest = { page, base: page, revision: 'other', id: 'other-tab', ancestors: [] };
  localStorage.setItem(key, JSON.stringify(latest));
  expect(settleDocumentDraft(bookmarksDocumentClient, 'repo', { page: empty, base: empty, id: 'sent' }, 'new-head')).toBe(false);
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(latest);
});
it('carries only proven descendants onto the committed page', () => {
  const key = documentDraftKey(bookmarksDocumentClient, 'repo');
  localStorage.setItem(key, JSON.stringify({ page, base: empty, revision: 'old', id: 'next', ancestors: ['sent'] }));
  expect(settleDocumentDraft(bookmarksDocumentClient, 'repo', { page: empty, base: empty, id: 'sent' }, 'new')).toBe(true);
  expect(readDocumentDraft(bookmarksDocumentClient, 'repo', empty)).toMatchObject({ page, base: empty, revision: 'new', id: 'next' });
});
it('does not rebase a pending page on an unrelated refreshed remote head', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => record(page, 'fresh')));
  localStorage.setItem(documentDraftKey(bookmarksDocumentClient, 'repo'), JSON.stringify({ page, base: empty, revision: 'old', id: 'draft' }));
  const hook = renderHook(() => useBookmarks('repo', () => {}, true));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.error).toBe('bookmarks.conflict');
  expect(hook.result.current.writable).toBe(false);
  expect(readDocumentDraft(bookmarksDocumentClient, 'repo', empty)).toMatchObject({ revision: 'old', base: empty });
});
