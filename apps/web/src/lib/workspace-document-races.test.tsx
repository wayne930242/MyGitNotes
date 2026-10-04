// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyFocusPage, type FocusPage } from '@mygitnotes/core/focus-page';
import { focusDocumentClient, useFocusPage } from './use-focus-page.js';
import { documentDraftKey, readDocumentDraft, settleDocumentDraft } from './use-workspace-document.js';
vi.mock('./i18n/index.js', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
const empty = emptyFocusPage();
const page: FocusPage = { version: 1, focuses: [{ id: 'a', notebookId: 'n', name: 'A', division: 'single', panes: [{ tabs: [] }] }] };
const record = (page: unknown, revision: string) => new Response(JSON.stringify({ page, revision, writable: true, path: '.github-notes-focus.yaml' }));
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
  const hook = renderHook(({ repository }) => useFocusPage(repository, () => {}, true), { initialProps: { repository: 'one' } });
  hook.rerender({ repository: 'two' });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => first(record(page, 'one')));
  expect(hook.result.current.page).toEqual(empty);
  expect(hook.result.current.repository).toBe('two');
});
it('preserves unrelated-tab draft/base during commit settlement', () => {
  const key = documentDraftKey(focusDocumentClient, 'repo');
  const latest = { page, base: page, revision: 'other', id: 'other-tab', ancestors: [] };
  localStorage.setItem(key, JSON.stringify(latest));
  expect(settleDocumentDraft(focusDocumentClient, 'repo', { page: empty, base: empty, id: 'sent' }, 'new-head')).toBe(false);
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(latest);
});
it('carries only proven descendants onto the committed page', () => {
  const key = documentDraftKey(focusDocumentClient, 'repo');
  localStorage.setItem(key, JSON.stringify({ page, base: empty, revision: 'old', id: 'next', ancestors: ['sent'] }));
  expect(settleDocumentDraft(focusDocumentClient, 'repo', { page: empty, base: empty, id: 'sent' }, 'new')).toBe(true);
  expect(readDocumentDraft(focusDocumentClient, 'repo', empty)).toMatchObject({ page, base: empty, revision: 'new', id: 'next' });
});
it('does not rebase a pending page on an unrelated refreshed remote head', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => record(page, 'fresh')));
  localStorage.setItem(documentDraftKey(focusDocumentClient, 'repo'), JSON.stringify({ page, base: empty, revision: 'old', id: 'draft' }));
  const hook = renderHook(() => useFocusPage('repo', () => {}, true));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.error).toBe('focus.conflict');
  expect(hook.result.current.writable).toBe(false);
  expect(readDocumentDraft(focusDocumentClient, 'repo', empty)).toMatchObject({ revision: 'old', base: empty });
});
