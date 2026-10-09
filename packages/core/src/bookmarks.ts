import { z } from 'zod';
import { NOTEBOOK_KEY_MAX_LENGTH } from './notebook-key.js';
import type { WorkspaceDocument } from './workspace-documents.js';
import { BookmarkError } from './bookmark-error.js';
import { bookmarkPath, BookmarkUrlSchema, SavedBookmarkQuerySchema } from './bookmark-query.js';
import { resolveTextAnchor, TextAnchorSchema } from './bookmark-anchor.js';
export { BookmarkError } from './bookmark-error.js';

export const BOOKMARKS_FILE = '.mygitnotes-bookmarks.yaml';
export const BOOKMARKS_MAX_BYTES = 1024 * 1024;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const label = z.string().trim().min(1).max(120);
const notePath = bookmarkPath.refine(value => value.length > 0, 'A file path is required');
export const BookmarkTargetSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('note'), path: notePath }).strict(), z.object({ kind: z.literal('folder'), path: bookmarkPath }).strict(), z.object({ kind: z.literal('compilation'), path: notePath }).strict(), z.object({ kind: z.literal('position'), path: notePath, anchor: TextAnchorSchema }).strict(), z.object({ kind: z.literal('url'), url: BookmarkUrlSchema }).strict(), z.object({ kind: z.literal('query'), query: SavedBookmarkQuerySchema }).strict()]);
export type BookmarkTarget = z.infer<typeof BookmarkTargetSchema>;
export const BookmarkSchema = z.object({ id, label, groupId: id.nullable(), target: BookmarkTargetSchema }).strict();
export interface Bookmark extends z.infer<typeof BookmarkSchema> {}
export interface BookmarkGroup {
  id: string;
  label: string;
}
export interface NotebookBookmarks {
  notebookId: string;
  groups: BookmarkGroup[];
  bookmarks: Bookmark[];
}
export interface BookmarksPage {
  version: 1;
  notebooks: NotebookBookmarks[];
}
export const BookmarksPageSchema = z.object({ version: z.literal(1), notebooks: z.array(z.object({ notebookId: z.string().min(1).max(NOTEBOOK_KEY_MAX_LENGTH), groups: z.array(z.object({ id, label }).strict()).max(100), bookmarks: z.array(BookmarkSchema).max(500) }).strict()).max(100) }).strict().superRefine((page, ctx) => {
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique(page.notebooks.map(nb => nb.notebookId))) ctx.addIssue({ code: 'custom', message: 'Duplicate notebook collection' });
  if (page.notebooks.reduce((n, nb) => n + nb.groups.length, 0) > 100 || page.notebooks.reduce((n, nb) => n + nb.bookmarks.length, 0) > 500) ctx.addIssue({ code: 'custom', message: 'Bookmark collection limit exceeded' });
  for (const nb of page.notebooks) {
    if (!unique(nb.groups.map(g => g.id)) || !unique(nb.bookmarks.map(b => b.id))) ctx.addIssue({ code: 'custom', message: 'Duplicate bookmark or group ID' });
    if (nb.bookmarks.some(b => b.groupId !== null && !nb.groups.some(g => g.id === b.groupId))) ctx.addIssue({ code: 'custom', message: 'Unknown bookmark group' });
  }
});
export const emptyBookmarksPage = (): BookmarksPage => ({ version: 1, notebooks: [] });
export const notebookBookmarks = (page: BookmarksPage, notebookId: string): NotebookBookmarks => page.notebooks.find(nb => nb.notebookId === notebookId) ?? { notebookId, groups: [], bookmarks: [] };
export function bookmarkTargetKey(target: BookmarkTarget): string {
  const canonical = BookmarkTargetSchema.parse(target);
  if (canonical.kind === 'position') {
    const { fromHint: _hint, ...anchor } = canonical.anchor;
    return JSON.stringify({ ...canonical, anchor });
  }
  return JSON.stringify(canonical);
}
export function findEquivalentBookmark(collection: NotebookBookmarks, target: BookmarkTarget, exceptId?: string, savedBody?: string): Bookmark | undefined {
  const key = bookmarkTargetKey(target);
  return collection.bookmarks.find(bookmark => {
    if (bookmark.id === exceptId) return false;
    if (bookmarkTargetKey(bookmark.target) === key) return true;
    if (savedBody === undefined || target.kind !== 'position' || bookmark.target.kind !== 'position' || target.path !== bookmark.target.path || target.anchor.kind !== bookmark.target.anchor.kind) return false;
    const left = resolveTextAnchor(savedBody, target.anchor), right = resolveTextAnchor(savedBody, bookmark.target.anchor);
    return left.state === 'resolved' && right.state === 'resolved' && left.range.from === right.range.from && left.range.to === right.range.to;
  });
}
function editCollection(page: BookmarksPage, notebookId: string, edit: (nb: NotebookBookmarks) => void): BookmarksPage {
  const next = BookmarksPageSchema.parse(page);
  let nb = next.notebooks.find(nb => nb.notebookId === notebookId);
  if (!nb) {
    nb = { notebookId, groups: [], bookmarks: [] };
    next.notebooks.push(nb);
  }
  edit(nb);
  return BookmarksPageSchema.parse(next);
}
function duplicate(nb: NotebookBookmarks, target: BookmarkTarget, exceptId?: string) {
  const existing = findEquivalentBookmark(nb, target, exceptId);
  if (existing) throw new BookmarkError('duplicate-target', 'This target is already bookmarked', existing.id);
}
function entry(nb: NotebookBookmarks, id: string): Bookmark {
  const value = nb.bookmarks.find(b => b.id === id);
  if (!value) throw new BookmarkError('unknown-bookmark', 'Bookmark no longer exists');
  return value;
}
export const addBookmark = (page: BookmarksPage, owner: string, bookmark: Bookmark) =>
  editCollection(page, owner, nb => {
    duplicate(nb, bookmark.target);
    nb.bookmarks.push(bookmark);
  });
export const updateBookmark = (page: BookmarksPage, owner: string, id: string, fields: Partial<Omit<Bookmark, 'id'>>) =>
  editCollection(page, owner, nb => {
    const value = entry(nb, id);
    if (fields.target && bookmarkTargetKey(fields.target) !== bookmarkTargetKey(value.target)) duplicate(nb, fields.target, id);
    Object.assign(value, fields);
  });
export const removeBookmark = (page: BookmarksPage, owner: string, id: string) =>
  editCollection(page, owner, nb => {
    entry(nb, id);
    nb.bookmarks = nb.bookmarks.filter(b => b.id !== id);
  });
export const addBookmarkGroup = (page: BookmarksPage, owner: string, group: BookmarkGroup) =>
  editCollection(page, owner, nb => {
    nb.groups.push(group);
  });
export const renameBookmarkGroup = (page: BookmarksPage, owner: string, id: string, label: string) =>
  editCollection(page, owner, nb => {
    const group = nb.groups.find(g => g.id === id);
    if (!group) throw new BookmarkError('unknown-group', 'Group no longer exists');
    group.label = label;
  });
export const removeBookmarkGroup = (page: BookmarksPage, owner: string, id: string) =>
  editCollection(page, owner, nb => {
    if (!nb.groups.some(g => g.id === id)) throw new BookmarkError('unknown-group', 'Group no longer exists');
    const members = nb.bookmarks.filter(b => b.groupId === id).map(b => ({ ...b, groupId: null }));
    nb.bookmarks = [...nb.bookmarks.filter(b => b.groupId !== id), ...members];
    nb.groups = nb.groups.filter(g => g.id !== id);
  });
export const moveBookmark = (page: BookmarksPage, owner: string, id: string, groupId: string | null, index?: number) =>
  editCollection(page, owner, nb => {
    const bookmark = entry(nb, id);
    if (groupId !== null && !nb.groups.some(g => g.id === groupId)) throw new BookmarkError('unknown-group', 'Group no longer exists');
    nb.bookmarks = nb.bookmarks.filter(b => b.id !== id);
    bookmark.groupId = groupId;
    const siblings = nb.bookmarks.filter(b => b.groupId === groupId);
    const before = index === undefined ? undefined : siblings[Math.max(0, index)];
    const last = siblings.at(-1);
    const at = before ? nb.bookmarks.indexOf(before) : last ? nb.bookmarks.indexOf(last) + 1 : nb.bookmarks.length;
    nb.bookmarks.splice(at, 0, bookmark);
  });
export const moveBookmarkGroup = (page: BookmarksPage, owner: string, id: string, index: number) =>
  editCollection(page, owner, nb => {
    const group = nb.groups.find(g => g.id === id);
    if (!group) throw new BookmarkError('unknown-group', 'Group no longer exists');
    nb.groups = nb.groups.filter(g => g.id !== id);
    nb.groups.splice(Math.max(0, index), 0, group);
  });

export interface BookmarkOwner {
  id: string;
  root: string;
  assets?: string;
}
const within = (file: string, root: string) => file === root || file.startsWith(root + '/');
export function bookmarkRepositoryPath(owner: BookmarkOwner, relative: string, notebooks: readonly BookmarkOwner[]): string {
  bookmarkPath.parse(relative);
  const path = relative ? `${owner.root}/${relative}` : owner.root;
  const actual = [...notebooks].sort((a, b) => b.root.length - a.root.length).find(nb => within(path, nb.root));
  const protectedPart = path.split('/').some(part => part.startsWith('.') || ['agents.md', 'claude.md', 'gemini.md', 'node_modules', 'dist', 'build'].includes(part.toLowerCase()));
  const assets = owner.assets || 'assets';
  if (actual?.id !== owner.id || protectedPart || within(relative, assets) || /(^|\/)docs\/agent(\/|$)/.test(path)) throw new BookmarkError('invalid-scope', 'Target must belong to this notebook');
  return path;
}
export function validateBookmarkTargetScope(target: BookmarkTarget, owner: BookmarkOwner, notebooks: readonly BookmarkOwner[]): void {
  if ('path' in target) bookmarkRepositoryPath(owner, target.path, notebooks);
  if ((target.kind === 'note' || target.kind === 'position') && !/\.(md|markdown|mdx|txt)$/i.test(target.path)) throw new BookmarkError('invalid-target', 'Target must be a note file');
  if (target.kind === 'compilation' && !target.path.endsWith('.compilation.yml')) throw new BookmarkError('invalid-target', 'Target must be a compilation file');
  if (target.kind === 'query') target.query.folders.forEach(folder => bookmarkRepositoryPath(owner, folder, notebooks));
}
export function validateBookmarksChange(current: BookmarksPage, next: BookmarksPage, notebooks: readonly BookmarkOwner[], relocation = false): void {
  BookmarksPageSchema.parse(next);
  for (const ownerId of new Set([...current.notebooks, ...next.notebooks].map(nb => nb.notebookId))) {
    const before = current.notebooks.find(nb => nb.notebookId === ownerId), after = next.notebooks.find(nb => nb.notebookId === ownerId);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const owner = notebooks.find(nb => nb.id === ownerId);
    if (!owner) throw new BookmarkError('invalid-scope', 'Unconfigured notebook collections must remain unchanged');
    for (const bookmark of after?.bookmarks ?? []) {
      const old = before?.bookmarks.find(b => b.id === bookmark.id);
      if (old && bookmarkTargetKey(old.target) === bookmarkTargetKey(bookmark.target)) continue;
      validateBookmarkTargetScope(bookmark.target, owner, notebooks);
      if (!relocation) duplicate(after!, bookmark.target, bookmark.id);
    }
  }
}
/** Compare newly captured positions against existing exact ranges in the same saved body. */
export async function validateBookmarkPositions(current: BookmarksPage, next: BookmarksPage, notebooks: readonly BookmarkOwner[], readBody: (path: string) => Promise<string | null>): Promise<void> {
  const bodies = new Map<string, string | null>();
  for (const collection of next.notebooks) {
    const owner = notebooks.find(nb => nb.id === collection.notebookId);
    if (!owner) continue;
    const before = notebookBookmarks(current, owner.id);
    for (const bookmark of collection.bookmarks) {
      if (bookmark.target.kind !== 'position') continue;
      const old = before.bookmarks.find(item => item.id === bookmark.id);
      if (old && bookmarkTargetKey(old.target) === bookmarkTargetKey(bookmark.target)) continue;
      const target = bookmark.target;
      if (!collection.bookmarks.some(item => item.id !== bookmark.id && item.target.kind === 'position' && item.target.path === target.path)) continue;
      const path = bookmarkRepositoryPath(owner, target.path, notebooks);
      if (!bodies.has(path)) bodies.set(path, await readBody(path));
      const body = bodies.get(path);
      if (body === null || body === undefined) continue;
      const existing = findEquivalentBookmark(collection, bookmark.target, bookmark.id, body);
      if (existing) throw new BookmarkError('duplicate-target', 'This position is already bookmarked', existing.id);
    }
  }
}
export function relocateBookmarkPaths(page: BookmarksPage, notebook: BookmarkOwner, move: (path: string) => string): boolean {
  let changed = false;
  const relocate = (relative: string) => {
    const source = relative ? `${notebook.root}/${relative}` : notebook.root;
    const destination = move(source);
    if (source === destination || !within(destination, notebook.root)) return relative;
    const result = destination === notebook.root ? '' : destination.slice(notebook.root.length + 1);
    bookmarkPath.parse(result);
    changed = true;
    return result;
  };
  const nb = page.notebooks.find(nb => nb.notebookId === notebook.id);
  for (const bookmark of nb?.bookmarks ?? []) {
    if ('path' in bookmark.target) bookmark.target.path = relocate(bookmark.target.path);
    if (bookmark.target.kind === 'query') bookmark.target.query = SavedBookmarkQuerySchema.parse({ ...bookmark.target.query, folders: bookmark.target.query.folders.map(relocate) });
  }
  return changed;
}
export const BOOKMARKS_DOCUMENT: WorkspaceDocument<BookmarksPage> = { file: BOOKMARKS_FILE, label: 'Bookmarks', maxBytes: BOOKMARKS_MAX_BYTES, scopes: ['folders', 'files'], retired: true, schema: BookmarksPageSchema, fileSchema: BookmarksPageSchema, empty: emptyBookmarksPage, read: value => BookmarksPageSchema.parse(value), relocate: relocateBookmarkPaths, validateChange: validateBookmarksChange, validateReferences: validateBookmarkPositions, mapNotebookIds: (page, map) => ({ ...page, notebooks: page.notebooks.map(collection => ({ ...collection, notebookId: map(collection.notebookId) })) }) };
