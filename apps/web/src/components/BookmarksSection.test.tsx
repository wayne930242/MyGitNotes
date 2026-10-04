// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addBookmark, addBookmarkGroup, type BookmarksPage, emptyBookmarksPage } from '@mygitnotes/core/bookmarks';
import { BookmarksSection } from './BookmarksSection.js';
import { type BookmarkContextValue, BookmarksProvider } from '../lib/bookmark-context.js';
import type { BookmarksController } from '../lib/use-bookmarks.js';
vi.mock('../lib/i18n/index.js', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
const bookmark = { id: 'a', label: 'Alpha', groupId: null, target: { kind: 'note' as const, path: 'a.md' } };
let page = addBookmarkGroup(addBookmark(emptyBookmarksPage(), 'n', bookmark), 'n', { id: 'g', label: 'Reading' });
const request = vi.fn(), activate = vi.fn();
const repository = { id: 'github:a/b@main', type: 'github' as const, branch: 'main', revision: 'head', write: true, notebooks: ['n'] };
function Harness({ writable = true }: { writable?: boolean; }) {
  const [current, setCurrent] = useState(page);
  const context = { controller: { page: current, repository: repository.id, writable, loading: false, dirty: true, error: '' } as BookmarksController, notebooks: [{ id: 'n', root: 'notes/n', title: 'N' }], folders: [], repositoryFor: () => ({ ...repository, write: writable }), remote: true, refreshKey: '', request, activate, mutate: (_owner: string, change: (page: BookmarksPage) => BookmarksPage) => setCurrent(change), captureView: vi.fn(), bookmarkNote: vi.fn(), bookmarkPosition: vi.fn(), position: null, consumePosition: vi.fn() } satisfies BookmarkContextValue;
  return (
    <QueryClientProvider client={new QueryClient()}>
      <BookmarksProvider value={context}>
        <BookmarksSection notebookId='n' />
      </BookmarksProvider>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  localStorage.clear();
  request.mockClear();
  activate.mockClear();
  page = addBookmarkGroup(addBookmark(emptyBookmarksPage(), 'n', bookmark), 'n', { id: 'g', label: 'Reading' });
  HTMLDialogElement.prototype.showModal = function() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function() {
    this.removeAttribute('open');
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ results: body.targets.map((target: { id: string; }) => ({ id: target.id, resolution: { state: 'resolved' } })) }));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('navigates read-only entries but disables shared writes', async () => {
  render(<Harness writable={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
  expect(activate).toHaveBeenCalledWith('n', bookmark);
  expect((screen.getByRole('button', { name: 'bookmarks.add' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'bookmarks.remove' })).toBeNull();
});
it('shows Pending, offers Add, grouping and removal confirmation without deleting content', async () => {
  render(<Harness />);
  expect(screen.getByText('bookmarks.pending')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'bookmarks.add' }));
  expect(request).toHaveBeenCalledWith({ notebookId: 'n' });
  fireEvent.change(screen.getByRole('combobox', { name: 'bookmarks.group: Alpha' }), { target: { value: 'g' } });
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'bookmarks.group: Alpha' }) as HTMLSelectElement).value).toBe('g'));
  fireEvent.click(screen.getByRole('button', { name: 'bookmarks.remove' }));
  expect(screen.getByText(/bookmarks.removeHint/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull());
});
