import { type BookmarkOwner, BOOKMARKS_DOCUMENT, BOOKMARKS_FILE, relocateBookmarkPaths, validateBookmarksChange } from './bookmarks.js';
import { readWorkspaceDocument, serializeWorkspaceDocument } from './workspace-documents.js';
import { type RemoteSnapshot, type RemoteSource, SourceError } from './remote-source.js';

/** The shell uses its already captured tree and resolved destination; no second preflight snapshot. */
export async function bookmarkRelocationChange(reader: RemoteSource, snapshot: RemoteSnapshot, notebook: BookmarkOwner, move: (path: string) => string) {
  const entry = snapshot.entries.find(entry => entry.path === BOOKMARKS_FILE);
  if (!entry) return;
  if (entry.type !== 'blob' || entry.mode === '120000') throw new SourceError('Bookmarks must be a regular file.', 403);
  const raw = (await reader.readSnapshotFile(snapshot, BOOKMARKS_FILE)).toString('utf8');
  if (Buffer.byteLength(raw) > BOOKMARKS_DOCUMENT.maxBytes) throw new SourceError('Bookmarks are too large.', 413);
  let page;
  try {
    page = readWorkspaceDocument(BOOKMARKS_DOCUMENT, raw);
  } catch {
    throw new SourceError('Invalid Bookmarks YAML. Fix the file before moving notes.', 422);
  }
  const current = structuredClone(page);
  const notebooks = (await reader.config()).notebooks;
  const sameOwnerMove = (path: string) => {
    const target = move(path);
    const owner = [...notebooks].sort((a, b) => b.root.length - a.root.length).find(nb => target === nb.root || target.startsWith(nb.root + '/'));
    return owner?.id === notebook.id ? target : path;
  };
  if (!relocateBookmarkPaths(page, notebook, sameOwnerMove)) return;
  validateBookmarksChange(current, page, notebooks, true);
  return { path: BOOKMARKS_FILE, content: serializeWorkspaceDocument(page) };
}
