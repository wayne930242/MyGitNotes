import { canonicalizeBookmarkQuery, type SavedBookmarkQuery } from '@mygitnotes/core/bookmark-query';
import { BookmarkError, type BookmarkOwner, bookmarkRepositoryPath } from '@mygitnotes/core/bookmarks';
import { type FilterQuery, writeFilterQuery } from './filter-query.js';
import { notebookRoute } from './routes.js';

export function captureBookmarkQuery(filters: Pick<FilterQuery, 'q' | 'kind' | 'tag' | 'folders' | 'descendants' | 'tagMode' | 'status' | 'showHidden' | 'neighbors' | 'view' | 'allNotebooks'>, sort: SavedBookmarkQuery['sort'], notebook: BookmarkOwner, scopeNotebookId = notebook.id): SavedBookmarkQuery {
  if (filters.allNotebooks || scopeNotebookId === 'all' || scopeNotebookId !== notebook.id) throw new BookmarkError('invalid-scope', 'Choose one notebook before saving this view');
  const folders = filters.folders.map(folder => {
    if (folder === notebook.root) return '';
    if (!folder.startsWith(notebook.root + '/')) throw new BookmarkError('invalid-scope', 'Folder belongs to another notebook');
    return folder.slice(notebook.root.length + 1);
  });
  return canonicalizeBookmarkQuery({ q: filters.q, kind: filters.kind, tags: filters.tag, folders, descendants: filters.descendants, tagMode: filters.tagMode, status: filters.status, showHidden: filters.showHidden, neighbors: filters.neighbors, view: filters.view, sort });
}
/** Build a clean notebook-owned route; never merge transient state from the current URL. */
export function bookmarkQueryRoute(notebook: BookmarkOwner, input: SavedBookmarkQuery): string {
  const query = canonicalizeBookmarkQuery(input);
  const filters = { ...query, tag: query.tags, folders: query.folders.map((path: string) => bookmarkRepositoryPath(notebook, path, [notebook])), allNotebooks: false, sortField: query.sort.field, sortOrder: query.sort.order };
  const search = new URLSearchParams(writeFilterQuery(filters));
  if (query.view === 'graph') {
    search.set('notebook', notebook.id);
    return `/graph?${search}`;
  }
  return notebookRoute(notebook.id) + (search.size ? `?${search}` : '');
}
export function bookmarkFolderRoute(notebook: BookmarkOwner, folder: string, sort: SavedBookmarkQuery['sort'], view: SavedBookmarkQuery['view']): string {
  return bookmarkQueryRoute(notebook, { q: '', kind: 'note', tags: [], folders: [folder], descendants: true, tagMode: 'any', status: null, showHidden: false, neighbors: false, view, sort });
}
