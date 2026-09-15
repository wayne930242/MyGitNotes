import { expect, it } from 'vitest';
import { GraphDrafts } from './graph-drafts.js';
import type { NoteItem } from './types.js';
const note = { id: 'a', path: 'notes/a.md', notebookId: 'n', content: 'base', metadata: {}, title: 'A', tags: [] } as NoteItem;
it('preserves a newer edit when an earlier save finishes', async () => {
  let finish!: (note: NoteItem) => void;
  const persisted: string[] = [];
  let calls = 0;
  const store = new GraphDrafts(() => calls++ === 0 ? new Promise<NoteItem>(resolve => { finish = resolve; }) : Promise.resolve({ ...note, content: 'second' }), value => { if (value) persisted.push(value.draft.content); });
  store.edit(note, 'first');
  const saving = store.flush(note.path);
  store.edit(note, 'second');
  finish({ ...note, content: 'first' });
  await saving;
  expect(store.get(note).draft.content).toBe('second');
  expect(store.get(note).dirty).toBe(true);
  expect(persisted.at(-1)).toBe('second');
  await store.flush(note.path);
  expect(store.get(note).dirty).toBe(false);
});
it('keeps failed drafts and blocks conflicting external changes', async () => {
  const store = new GraphDrafts(async () => { throw Error('offline'); }, () => {});
  store.edit(note, 'local');
  await expect(store.flush(note.path)).rejects.toThrow('offline');
  expect(store.get(note).draft.content).toBe('local');
  store.reconcile({ ...note, content: 'external' });
  expect(store.get(note).error).toBeTruthy();
  expect(store.get(note).draft.content).toBe('local');
});
it('shares a draft and undo history across callers for one path', () => {
  const store = new GraphDrafts(async () => note, () => {});
  store.edit(note, 'one'); store.edit(note, 'two'); store.undo(note);
  expect(store.get({ ...note }).draft.content).toBe('one');
});
