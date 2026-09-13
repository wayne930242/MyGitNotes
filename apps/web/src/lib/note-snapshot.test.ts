import { describe, expect, it } from 'vitest';
import { mergeNoteSnapshot } from './note-snapshot.js';
import type { NoteItem } from './types.js';

const note = (notebookId: string, name: string, content = name): NoteItem => ({
  id: name, notebookId, path: `notes/${notebookId}/${name}.md`, title: name,
  content, metadata: { custom: 'preserved' }, tags: [],
});

describe('notebook refresh snapshots', () => {
  it('replaces the refreshed notebook, including external moves and deletions, while retaining cross-notebook links', () => {
    const other = note('other', 'linked');
    const previous = [note('rules', 'removed'), other, note('rules', 'old-path')];
    const incoming = [note('rules', 'new-path', 'external edit')];
    expect(mergeNoteSnapshot(previous, incoming, 'rules')).toEqual([other, ...incoming]);
  });

  it('reuses unchanged snapshots so opening or revisiting a notebook does not invalidate the list', () => {
    const previous = [note('rules', 'a'), note('other', 'b')];
    expect(mergeNoteSnapshot(previous, [structuredClone(previous[0])], 'rules')).toBe(previous);
    expect(mergeNoteSnapshot(previous, structuredClone(previous))).toBe(previous);
  });

  it('applies changed content and metadata without replacing unaffected notes', () => {
    const previous = [note('rules', 'a'), note('rules', 'b')];
    const changed = { ...previous[0], content: 'changed', metadata: { custom: 'new' } };
    const result = mergeNoteSnapshot(previous, [changed, structuredClone(previous[1])], 'rules');
    expect(result).toEqual([changed, previous[1]]);
    expect(result[1]).toBe(previous[1]);
  });

  it('a full refresh removes notes from deleted notebooks', () => {
    expect(mergeNoteSnapshot([note('removed-notebook', 'a')], [note('new', 'b')])).toEqual([note('new', 'b')]);
  });
});
