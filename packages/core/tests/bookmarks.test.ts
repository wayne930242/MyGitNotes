import { describe, expect, it } from 'vitest';
import { addBookmark, addBookmarkGroup, bookmarkRepositoryPath, BookmarksPageSchema, bookmarkTargetKey, emptyBookmarksPage, moveBookmark, notebookBookmarks, relocateBookmarkPaths, removeBookmark, removeBookmarkGroup, updateBookmark, validateBookmarksChange } from '../src/bookmarks.js';
import { canonicalizeBookmarkQuery, canonicalizeBookmarkUrl } from '../src/bookmark-query.js';
import { captureBookmarkSelection, captureTextAnchor, listBookmarkPositions, resolveTextAnchor } from '../src/bookmark-anchor.js';
const query = { q: ' hello ', kind: 'note' as const, tags: ['b', 'a', 'b'], folders: ['two', 'one'], descendants: true, tagMode: 'any' as const, status: null, showHidden: false, neighbors: false, view: 'graph' as const, sort: { field: 'title' as const, order: 'asc' as const } };
const bookmark = (id: string, groupId: string | null = null) => ({ id, label: id, groupId, target: { kind: 'note' as const, path: `${id}.md` } });

describe('notebook bookmarks', () => {
  it('round trips every target without changing content', () => {
    const targets = [bookmark('n').target, { kind: 'folder', path: '' }, { kind: 'compilation', path: 'read.compilation.yml' }, { kind: 'position', path: 'n.md', anchor: captureTextAnchor('hello', { from: 0, to: 5 }, 'paragraph') }, { kind: 'url', url: 'https://example.org/' }, { kind: 'query', query }];
    const page = BookmarksPageSchema.parse({ version: 1, notebooks: [{ notebookId: 'n', groups: [], bookmarks: targets.map((target, i) => ({ id: `b${i}`, label: `Bookmark ${i}`, groupId: null, target })) }] });
    expect(BookmarksPageSchema.parse(JSON.parse(JSON.stringify(page)))).toEqual(page);
    expect(page.notebooks[0].bookmarks).toHaveLength(6);
  });
  it('orders entries immutably, ungroups in relative order and removes references only', () => {
    const empty = emptyBookmarksPage();
    let page = addBookmarkGroup(empty, 'n', { id: 'g', label: 'Group' });
    for (const b of [bookmark('a'), bookmark('b', 'g'), bookmark('c', 'g')]) page = addBookmark(page, 'n', b);
    page = moveBookmark(page, 'n', 'c', 'g', 0);
    page = removeBookmarkGroup(page, 'n', 'g');
    expect(notebookBookmarks(page, 'n').bookmarks.map(b => b.id)).toEqual(['a', 'c', 'b']);
    expect(notebookBookmarks(page, 'n').bookmarks.every(b => b.groupId === null)).toBe(true);
    expect(empty.notebooks).toEqual([]);
    expect(notebookBookmarks(removeBookmark(page, 'n', 'a'), 'n').bookmarks).toHaveLength(2);
  });
  it('retarget preserves identity and label, duplicates return the existing ID', () => {
    const page = addBookmark(emptyBookmarksPage(), 'n', bookmark('a'));
    expect(() => addBookmark(page, 'n', { ...bookmark('b'), target: bookmark('a').target })).toThrow(expect.objectContaining({ existingId: 'a' }));
    expect(notebookBookmarks(updateBookmark(page, 'n', 'a', { target: { kind: 'folder', path: '' } }), 'n').bookmarks[0]).toMatchObject({ id: 'a', label: 'a', groupId: null });
  });
  it('rejects unknown fields, unsafe paths, unknown groups and unsupported versions', () => {
    for (const path of ['/etc/passwd', '../a', 'a//b', 'a/./b', 'C:/a', 'https://a', 'a\\b', 'a\u0000b']) expect(() => addBookmark(emptyBookmarksPage(), 'n', { ...bookmark('a'), target: { kind: 'note', path } })).toThrow();
    expect(() => addBookmark(emptyBookmarksPage(), 'n', bookmark('a', 'missing'))).toThrow();
    expect(() => BookmarksPageSchema.parse({ version: 2, notebooks: [] })).toThrow();
    expect(() => canonicalizeBookmarkQuery({ ...query, allNotebooks: true })).toThrow();
  });
  it('preserves unknown owners but refuses their alteration and nested-owner paths', () => {
    const current = addBookmark(emptyBookmarksPage(), 'unknown', bookmark('a'));
    const next = addBookmark(current, 'n', bookmark('b'));
    expect(() => validateBookmarksChange(current, next, [{ id: 'n', root: 'notes' }])).not.toThrow();
    expect(() => validateBookmarksChange(current, emptyBookmarksPage(), [{ id: 'n', root: 'notes' }])).toThrow();
    expect(() => bookmarkRepositoryPath({ id: 'n', root: 'notes' }, 'nested/a.md', [{ id: 'n', root: 'notes' }, { id: 'other', root: 'notes/nested' }])).toThrow();
  });
  it('relocates references and query folders, retaining converged identities and anchor bytes', () => {
    let page = addBookmark(emptyBookmarksPage(), 'n', { ...bookmark('a'), target: { kind: 'folder', path: 'one' } });
    page = addBookmark(page, 'n', { ...bookmark('b'), target: { kind: 'query', query } });
    expect(relocateBookmarkPaths(page, { id: 'n', root: 'notes' }, path => path === 'notes/one' ? 'notes/two' : path)).toBe(true);
    expect(page.notebooks[0].bookmarks[0].target).toEqual({ kind: 'folder', path: 'two' });
    expect(page.notebooks[0].bookmarks[1].target).toMatchObject({ query: { folders: ['two'] } });
  });
});

describe('canonical query and URL identity', () => {
  it('sorts sets without changing text and includes view/sort', () => {
    expect(canonicalizeBookmarkQuery(query)).toMatchObject({ q: ' hello ', tags: ['a', 'b'], folders: ['one', 'two'] });
    expect(bookmarkTargetKey({ kind: 'query', query })).toBe(bookmarkTargetKey({ kind: 'query', query: { ...query, tags: ['a', 'b'] } }));
    expect(bookmarkTargetKey({ kind: 'query', query })).not.toBe(bookmarkTargetKey({ kind: 'query', query: { ...query, view: 'list' } }));
  });
  it('only accepts explicit HTTP(S), without credentials or parser normalization tricks', () => {
    expect(canonicalizeBookmarkUrl('HTTPS://Example.Org:443/a#x')).toBe('https://example.org/a#x');
    for (const value of ['javascript:alert(1)', '//example.org', 'https://u:p@example.org', 'data:text/plain,x', 'https://a\\b', 'https://a\nb']) expect(() => canonicalizeBookmarkUrl(value)).toThrow();
  });
});

describe('exact source anchors', () => {
  it('finds moved unique text, but never guesses after edit or deletion', () => {
    const anchor = captureTextAnchor('start\n\n中文 *段落*\n\nend', { from: 7, to: 14 }, 'paragraph');
    expect(resolveTextAnchor('中文 *段落*\n\nstart\n\nend', anchor)).toEqual({ state: 'resolved', range: { from: 0, to: 7 } });
    expect(resolveTextAnchor('rewritten', anchor)).toEqual({ state: 'unresolved', reason: 'missing-position' });
  });
  it('uses exact context for duplicates and ignores hints for ambiguity, including overlaps', () => {
    const anchor = captureTextAnchor('A\nrepeat\nB\nrepeat\nC', { from: 2, to: 8 }, 'paragraph');
    expect(resolveTextAnchor('A\nrepeat\nB\nrepeat\nC', anchor)).toMatchObject({ state: 'resolved', range: { from: 2 } });
    expect(resolveTextAnchor('aaa', { version: 1, kind: 'paragraph', exact: 'aa', prefix: '', suffix: '', fromHint: 0 })).toEqual({ state: 'unresolved', reason: 'ambiguous-position' });
  });
  it('converts CRLF boundaries and preserves source markup', () => {
    const source = '# Heading\r\n\r\nA **bold** paragraph';
    const positions = listBookmarkPositions(source);
    expect(positions.map(p => p.kind)).toEqual(['heading', 'paragraph']);
    const anchor = captureTextAnchor(source, positions[1], 'paragraph');
    expect(resolveTextAnchor(source, anchor)).toEqual({ state: 'resolved', range: { from: 13, to: source.length } });
  });
  it('excludes code and separators, includes setext/list/quote, and rejects cross-block selection', () => {
    const source = 'Heading\n=======\n\n```md\n# code\n```\n\n    code\n\n---\n\n- list\n- next\n\n> quote';
    expect(listBookmarkPositions(source).map(p => p.label)).toEqual(['Heading\n=======', '- list\n- next', '> quote']);
    expect(() => captureBookmarkSelection(source, { from: 0, to: source.length })).toThrow();
    expect(listBookmarkPositions('# plain\n\ntext', 'txt').map(p => p.kind)).toEqual(['paragraph', 'paragraph']);
  });
});
