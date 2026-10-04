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
async function menu(name: string, action: string) {
  const trigger = screen.getByRole('button', { name });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: action }));
}
it('shows Pending and groups/removes through compact keyboard-accessible menus', async () => {
  render(<Harness />);
  expect(screen.getByText('bookmarks.pending')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'bookmarks.add' }));
  expect(request).toHaveBeenCalledWith({ notebookId: 'n' });
  expect(screen.queryByRole('combobox')).toBeNull();
  await menu('bookmarks.edit: Alpha', 'bookmarks.group');
  fireEvent.change(await screen.findByRole('combobox', { name: 'bookmarks.group: Alpha' }), { target: { value: 'g' } });
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Alpha' }).closest('.bookmark-group')).toBeTruthy());
  await menu('bookmarks.edit: Alpha', 'bookmarks.remove');
  expect(await screen.findByText(/bookmarks.removeHint/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull());
});
it('keeps up/down, group actions and drag ordering without permanent control rows', async () => {
  page = addBookmark(page, 'n', { ...bookmark, id: 'b', label: 'Beta', target: { kind: 'note', path: 'b.md' } });
  render(<Harness />);
  await menu('bookmarks.edit: Alpha', 'bookmarks.down');
  await waitFor(() => expect(Array.from(document.querySelectorAll('.bookmark-row .bookmark-heading')).map(row => row.textContent)).toEqual(['Beta', 'Alpha']));
  const rows = document.querySelectorAll('.bookmark-entry');
  fireEvent.dragStart(rows[1], { dataTransfer: { setData: vi.fn() } });
  fireEvent.drop(rows[0]);
  await waitFor(() => expect(Array.from(document.querySelectorAll('.bookmark-row .bookmark-heading')).map(row => row.textContent)).toEqual(['Alpha', 'Beta']));
  await menu('bookmarks.group: Reading', 'bookmarks.renameGroup');
  const input = await screen.findByRole('textbox', { name: 'bookmarks.label' });
  fireEvent.change(input, { target: { value: 'Renamed' } });
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  expect(await screen.findByRole('button', { name: 'bookmarks.group: Renamed' })).toBeTruthy();
});
it('returns focus to the compact trigger after Escape and sequences edit after menu close', async () => {
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'bookmarks.edit: Alpha' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const dropdown = await screen.findByRole('menu');
  fireEvent.keyDown(dropdown, { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  await menu('bookmarks.edit: Alpha', 'bookmarks.edit');
  await waitFor(() => expect(request).toHaveBeenCalledWith({ notebookId: 'n', id: 'a' }));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
