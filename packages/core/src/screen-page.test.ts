import { describe, expect, it } from 'vitest';
import { readScreenPage, ScreenPageSchema } from './screen-page.js';

const note = { id: 'a', kind: 'note', notebookId: 'one', path: 'notes/one/a.md' };
const page = { version: 2, rows: [{ id: 'first', name: '閱讀', view: 'small', notebookId: 'one', kind: 'custom', items: [note] }, { id: 'second', name: '參考', view: 'medium', notebookId: 'one', kind: 'custom', items: [{ ...note, id: 'b', path: 'notes/one/b.md' }] }, { id: 'live', name: '動態標籤', view: 'thumbnail', notebookId: 'one', kind: 'dynamic', source: { kind: 'tag', tag: 'clue', notebookId: 'one' } }, { id: 'other', name: '其他', view: 'small', notebookId: 'two', kind: 'custom', items: [] }] };
const config = { workspace: { default_notebook: 'two' }, notebooks: [{ id: 'one' }, { id: 'two' }, { id: 'three' }] };
const video = { id: 'v', kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 0 };
describe('Screen Page swimlanes', () => {
  it('preserves optional dynamic sorting without rewriting legacy lanes', () => {
    const legacy = ScreenPageSchema.parse(page);
    expect(legacy.rows[2]).not.toHaveProperty('sort');
    const sorted = { ...page, rows: [{ ...page.rows[2], sort: { field: 'updated', order: 'desc' } }] };
    expect(ScreenPageSchema.parse(sorted).rows[0]).toMatchObject({ sort: { field: 'updated', order: 'desc' } });
    for (const sort of [{ field: 'unknown', order: 'asc' }, { field: 'title', order: 'random' }]) {
      expect(ScreenPageSchema.safeParse({ ...sorted, rows: [{ ...sorted.rows[0], sort }] }).success).toBe(false);
    }
    expect(ScreenPageSchema.safeParse({ ...page, rows: [{ ...page.rows[0], sort: { field: 'title', order: 'asc' } }] }).success).toBe(false);
  });
  it('restores ordinary layout for legacy study views while preserving progression', () => {
    const progression = { stages: [{ status: 'new', intervalDays: 1 }], easy: 'two' };
    for (const view of ['reading', 'study']) {
      expect(ScreenPageSchema.parse({ version: 2, rows: [{ ...page.rows[0], view, progression }] }).rows[0]).toMatchObject({ view: 'small', progression });
    }
  });
  it('rejects lane content from another notebook', () => {
    expect(ScreenPageSchema.safeParse({ version: 2, rows: [{ ...page.rows[0], items: [{ ...note, notebookId: 'two' }] }] }).success).toBe(false);
    expect(ScreenPageSchema.safeParse({ version: 2, rows: [{ ...page.rows[2], source: { kind: 'tag', tag: 'clue', notebookId: 'two' } }] }).success).toBe(false);
    expect(ScreenPageSchema.safeParse({ version: 2, rows: [{ ...page.rows[2], source: { kind: 'tag', tag: 'clue' } }] }).success).toBe(false);
    expect(ScreenPageSchema.safeParse({ version: 2, rows: [{ ...page.rows[0], notebookId: undefined }] }).success).toBe(false);
    expect(ScreenPageSchema.safeParse({ version: 2, rows: [{ ...page.rows[3], items: [video] }] }).success).toBe(true);
  });
  it('rejects traversal, duplicate identities, dynamic-row contents and unknown layout fields', () => {
    for (const item of [{ ...note, path: '../private' }, { ...note, path: '/etc/passwd' }, { ...note, x: 1 }, { ...note, path: 'notes\\one' }]) {
      expect(ScreenPageSchema.safeParse({ version: 2, rows: [{ ...page.rows[0], items: [item] }] }).success).toBe(false);
    }
    expect(ScreenPageSchema.safeParse({ version: 2, rows: [page.rows[0], page.rows[0]] }).success).toBe(false);
    expect(ScreenPageSchema.safeParse({ version: 2, rows: [{ ...page.rows[2], items: [note] }] }).success).toBe(false);
  });
  it('migrates version 1 lanes into their notebooks without losing items', () => {
    const mixed = [{ ...note, id: 'b1', notebookId: 'two', path: 'notes/two/b.md' }, note, video, { ...note, id: 'b2', notebookId: 'two', path: 'notes/two/c.md' }];
    const legacy = { version: 1, rows: [{ id: 'mixed', name: '混合', view: 'medium', kind: 'custom', study: { filter: 'due', dueFirst: true }, items: mixed }, { id: 'mixed-one', name: '衝突 id', view: 'small', kind: 'custom', items: [] }, { id: 'single', name: '單一', view: 'small', kind: 'custom', items: [{ ...note, id: 'c', notebookId: 'three', path: 'notes/three/c.md' }] }, { id: 'videos', name: '影片', view: 'small', kind: 'custom', items: [{ ...video, id: 'v2' }] }, { id: 'every', name: '全部 tag', view: 'small', kind: 'dynamic', source: { kind: 'tag', tag: 'clue' } }, { id: 'tagged', name: 'tag', view: 'small', kind: 'dynamic', source: { kind: 'tag', tag: 'clue', notebookId: 'three' } }, { id: 'folder', name: '資料夾', view: 'small', kind: 'dynamic', source: { kind: 'folder', notebookId: 'one', path: 'notes/one', recursive: true } }] };
    const migrated = readScreenPage(legacy, config);
    expect(migrated.version).toBe(2);
    expect(migrated.rows.map(row => [row.id, row.notebookId])).toEqual([['mixed', 'two'], ['mixed-one-2', 'one'], ['mixed-one', 'two'], ['single', 'three'], ['videos', 'two'], ['every', 'two'], ['tagged', 'three'], ['folder', 'one']]);
    expect(migrated.rows[0]).toMatchObject({ name: '混合', view: 'medium', study: { filter: 'due', dueFirst: true }, items: [{ id: 'b1' }, { id: 'v' }, { id: 'b2' }] });
    expect(migrated.rows[1]).toMatchObject({ name: '混合', view: 'medium', study: { filter: 'due', dueFirst: true }, items: [note] });
    expect(migrated.rows[5]).toMatchObject({ source: { kind: 'tag', tag: 'clue', notebookId: 'two' } });
    expect(readScreenPage(legacy, config)).toEqual(migrated);
    expect(readScreenPage(migrated, config)).toEqual(migrated);
    expect(() => readScreenPage({ version: 1, rows: Array.from({ length: 40 }, (_, index) => ({ ...legacy.rows[0], id: `row-${index}`, items: mixed.map(item => ({ ...item, id: `${item.id}-${index}` })) })) }, config)).toThrow();
  });
});
