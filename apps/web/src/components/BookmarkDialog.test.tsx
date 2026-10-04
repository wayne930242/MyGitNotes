// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BookmarkDialog } from './BookmarkDialog.js';
vi.mock('../lib/i18n/index.js', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('../lib/use-note-queries.js', () => ({ useNoteList: () => ({ notes: [], hasMore: false, loading: false, error: '' }) }));
vi.mock('../lib/api.js', () => ({ readNote: async () => ({ content: '# Title\n\nSaved paragraph.' }) }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function() {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);
const save = vi.fn();
const props = () => ({ request: { notebookId: 'n' }, notebook: { id: 'n', title: 'Notebook', root: 'notes/n' }, collection: { notebookId: 'n', bookmarks: [], groups: [] }, folders: [], remote: false, writable: true, captureView: () => ({ q: 'search', kind: 'note' as const, tags: [], folders: [], descendants: true, tagMode: 'any' as const, status: null, showHidden: false, neighbors: false, view: 'list' as const, sort: { field: 'updated' as const, order: 'desc' as const } }), onSave: save, onEditExisting: vi.fn(), onClose: vi.fn() });
it('offers all six targets and validates URL without fetching a preview', async () => {
  render(<BookmarkDialog {...props()} />);
  const types = screen.getByLabelText('bookmarks.target', { selector: 'select' }) as HTMLSelectElement;
  expect([...types.options].map(option => option.value)).toEqual(['note', 'folder', 'compilation', 'position', 'url', 'query']);
  fireEvent.change(types, { target: { value: 'url' } });
  fireEvent.change(screen.getByLabelText('bookmarks.label'), { target: { value: 'Website' } });
  fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.org/' } });
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ label: 'Website', groupId: null, target: { kind: 'url', url: 'https://example.org/' } }));
});
it('shows saved-source positions and explains explicit remote save plus commit', async () => {
  render(<BookmarkDialog {...props()} request={{ notebookId: 'n', positionPath: 'a.md' }} remote />);
  expect(screen.getByText('bookmarks.saveFirstRemote')).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('option', { name: 'Saved paragraph.' })).toBeTruthy());
  expect(screen.getByRole('button', { name: 'bookmarks.saveFirst' })).toBeTruthy();
});
