import { describe, expect, it } from 'vitest';
import { type BookmarksPage, BookmarksPageSchema } from '../src/bookmarks.js';
import { captureTextAnchor } from '../src/bookmark-anchor.js';
import { planLegacyOutlineImport } from '../src/outline-import.js';
import { Lexer } from 'marked';

const owner = { id: 'a', root: 'notes/shared' };
const request = { repository: 'repo-a', notebookId: 'a', selectedIds: ['note', 'compilation', 'url', 'position', 'folder', 'query'], path: 'notes/shared/imported.outline.md', title: 'Imported: "plan"' };
export const legacyPage = (): BookmarksPage => ({ version: 1, notebooks: [{ notebookId: 'a', groups: [{ id: 'group', label: '[group](https://invalid.test)' }, { id: 'empty', label: 'Empty' }], bookmarks: [{ id: 'note', label: '*same* [title]', groupId: 'group', target: { kind: 'note', path: 'missing 中文.md' } }, { id: 'compilation', label: '*same* [title]', groupId: 'group', target: { kind: 'compilation', path: 'reading.compilation.yml' } }, { id: 'url', label: 'URL &copy; <img>', groupId: null, target: { kind: 'url', url: 'https://example.test/a(b)?q=x(y)&v=1#section' } }, { id: 'position', label: 'Exact position', groupId: null, target: { kind: 'position', path: 'note.md', anchor: captureTextAnchor('Paragraph.', { from: 0, to: 10 }, 'paragraph') } }, { id: 'folder', label: 'Folder', groupId: null, target: { kind: 'folder', path: 'folder' } }, { id: 'query', label: 'View', groupId: null, target: { kind: 'query', query: { q: '', kind: 'note', tags: ['z', 'a'], folders: [], descendants: true, tagMode: 'any', status: null, showHidden: false, neighbors: false, view: 'list', sort: { field: 'title', order: 'asc' } } } }] }, { notebookId: 'unknown', groups: [], bookmarks: [{ id: 'foreign', label: 'Unknown owner', groupId: null, target: { kind: 'note', path: 'unchanged.md' } }] }] });

describe('explicit non-lossy legacy outline planner', () => {
  it('preserves display order, empty groups, duplicate labels, missing targets and exact retained entries without mutating input', () => {
    const page = legacyPage(), before = structuredClone(page);
    const result = planLegacyOutlineImport(page, owner, [owner], { ...request, selectedIds: [...request.selectedIds].reverse() });
    expect(page).toEqual(before);
    expect(result.convertedIds).toEqual(['note', 'compilation', 'url']);
    expect(result.groups).toEqual([{ id: 'group', label: '[group](https://invalid.test)', convertedIds: ['note', 'compilation'] }, { id: 'empty', label: 'Empty', convertedIds: [] }]);
    expect(result.partial).toBe(true);
    expect(result.retained.map(item => [item.entry.id, item.reason])).toEqual([['position', 'position'], ['folder', 'folder'], ['query', 'query'], ['foreign', 'other-owner']]);
    expect(result.retained[2].entry).toEqual(before.notebooks[0].bookmarks[5]);
    expect(result.markdown).toContain('- \\[group\\]\\(https\\:\\/\\/invalid\\.test\\)');
    expect(result.markdown).toContain('[\\*same\\* \\[title\\]](missing%20%E4%B8%AD%E6%96%87.md)');
    expect(result.markdown).toContain('https://example.test/a%28b%29?q=x%28y%29&amp;v=1#section');
    expect(result.markdown).toContain('\n- Empty\n');
    expect(result.markdown).not.toContain('unchanged.md');
    const list = Lexer.lex(result.markdown!.split('---\n\n')[1])[0];
    expect(list.type).toBe('list');
    if (list.type === 'list') expect(list.items).toHaveLength(3);
  });
  it('does not deduplicate identical targets and does not create files for groups or unsupported-only selection', () => {
    const page = legacyPage();
    page.notebooks[0].bookmarks.push({ ...page.notebooks[0].bookmarks[0], id: 'again' });
    expect(planLegacyOutlineImport(page, owner, [owner], { ...request, selectedIds: ['note', 'again'] }).convertedIds).toEqual(['note', 'again']);
    for (const selectedIds of [[], ['folder', 'position', 'query']]) expect(planLegacyOutlineImport(page, owner, [owner], { ...request, selectedIds }).markdown).toBeNull();
  });
  it('rejects unknown IDs, unknown owners, duplicate selection, nested ownership, protected or non-outline destinations', () => {
    for (const patch of [{ selectedIds: ['foreign'] }, { selectedIds: ['note', 'note'] }, { notebookId: 'unknown' }, { path: 'notes/shared/.private/import.outline.md' }, { path: 'notes/shared/../bad.outline.md' }, { path: 'notes/shared/plain.md' }]) expect(() => planLegacyOutlineImport(legacyPage(), owner, [owner], { ...request, ...patch })).toThrow();
    expect(() => planLegacyOutlineImport(legacyPage(), owner, [owner, { id: 'child', root: 'notes/shared/child' }], { ...request, path: 'notes/shared/child/import.outline.md' })).toThrow();
    expect(() => planLegacyOutlineImport(legacyPage(), owner, [], request)).toThrow();
  });
  it('strictly rejects unsupported versions, fields and unsafe URLs without substituting empty data', () => {
    expect(() => BookmarksPageSchema.parse({ ...legacyPage(), version: 2 })).toThrow();
    const page = legacyPage();
    page.notebooks[0].bookmarks[2].target = { kind: 'url', url: 'https://user:password@example.test/' };
    expect(() => planLegacyOutlineImport(page, owner, [owner], request)).toThrow();
    expect(() => planLegacyOutlineImport(legacyPage(), owner, [owner], { ...request, extra: true } as typeof request)).toThrow();
  });
});
