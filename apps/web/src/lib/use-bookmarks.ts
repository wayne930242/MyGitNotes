import { BOOKMARKS_DOCUMENT, type BookmarksPage } from '@mygitnotes/core/bookmarks';
import { useWorkspaceDocument, type WorkspaceDocumentClient, type WorkspaceDocumentController } from './use-workspace-document.js';

export const bookmarksDocumentClient: WorkspaceDocumentClient<BookmarksPage> = { document: BOOKMARKS_DOCUMENT, endpoint: '/api/bookmarks', draftKey: 'bookmarks-draft', messages: { load: 'bookmarks.loadError', conflict: 'bookmarks.conflict', limit: 'bookmarks.limit', draft: 'bookmarks.draftError', save: 'bookmarks.saveError', loading: 'bookmarks.loading' } };
export function useBookmarks(repository: string | undefined, onSaved: () => void, remote = false, enabled = true) {
  return useWorkspaceDocument(bookmarksDocumentClient, repository, onSaved, remote, enabled);
}
export type BookmarksController = WorkspaceDocumentController<BookmarksPage>;
export async function resolveBookmarks(notebookId: string, targets: { id: string; target: import('@mygitnotes/core/bookmarks').BookmarkTarget; }[], signal?: AbortSignal): Promise<import('@mygitnotes/core').BookmarkResolution[]> {
  const results: import('@mygitnotes/core').BookmarkResolution[] = [];
  for (let index = 0; index < targets.length; index += 100) {
    const batch = targets.slice(index, index + 100);
    const response = await fetch('/api/bookmarks/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId, targets: batch }), signal });
    if (!response.ok) throw new Error('Bookmarks unavailable');
    const record = await response.json();
    const byId = new Map<string, import('@mygitnotes/core').BookmarkResolution>(record.results.map((entry: { id: string; resolution: import('@mygitnotes/core').BookmarkResolution; }) => [entry.id, entry.resolution]));
    results.push(...batch.map(entry => byId.get(entry.id) ?? { state: 'unavailable' as const, retryable: true }));
  }
  return results;
}
