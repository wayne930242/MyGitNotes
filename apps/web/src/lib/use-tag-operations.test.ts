import { describe, expect, it } from 'vitest';
import { applyTagEntriesToNotes, pushTagOperationRecord } from './use-tag-operations.js';
import { NoteItem } from './types.js';

function note(path: string, tags: string[], notebookId = 'nb'): NoteItem {
  return { id: path, path, notebookId, title: path, status: undefined, tags, metadata: { tags }, content: 'body' };
}

describe('pushTagOperationRecord', () => {
  it('prepends a record with only the snapshot fields, dropping nextTags', () => {
    const plan = { affected: [{ path: 'a.md', notebookId: 'nb', previousTags: ['x'], nextTags: ['y'] }] };
    const history = pushTagOperationRecord([], 'rename', 'x -> y', plan);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: 'rename', label: 'x -> y', entries: [{ path: 'a.md', notebookId: 'nb', previousTags: ['x'] }] });
    expect((history[0].entries[0] as any).nextTags).toBeUndefined();
  });

  it('gives each record a distinct id and keeps newest first', () => {
    const plan = { affected: [] };
    const history = pushTagOperationRecord(pushTagOperationRecord([], 'delete', 'first', plan), 'delete', 'second', plan);
    expect(history.map(r => r.label)).toEqual(['second', 'first']);
    expect(history[0].id).not.toBe(history[1].id);
  });
});

describe('applyTagEntriesToNotes', () => {
  it('updates tags and mirrored metadata.tags only for matching path+notebookId', () => {
    const notes = [note('a.md', ['x'], 'blog'), note('a.md', ['x'], 'thesis'), note('b.md', ['y'])];
    const updated = applyTagEntriesToNotes(notes, [{ path: 'a.md', notebookId: 'blog', tags: ['z'] }]);
    expect(updated.find(n => n.path === 'a.md' && n.notebookId === 'blog')).toMatchObject({ tags: ['z'], metadata: { tags: ['z'] } });
    expect(updated.find(n => n.path === 'a.md' && n.notebookId === 'thesis')).toMatchObject({ tags: ['x'] });
    expect(updated.find(n => n.path === 'b.md')).toMatchObject({ tags: ['y'] });
  });

  it('returns the same array reference when there is nothing to apply', () => {
    const notes = [note('a.md', ['x'])];
    expect(applyTagEntriesToNotes(notes, [])).toBe(notes);
  });

  it('leaves notes untouched when no entry matches them', () => {
    const notes = [note('a.md', ['x'])];
    expect(applyTagEntriesToNotes(notes, [{ path: 'missing.md', notebookId: 'nb', tags: ['z'] }])).toEqual(notes);
  });
});
