import { expect, it } from 'vitest';
import { screenRowItems } from './screen-content.js';
import type { NoteItem } from './types.js';
const notes = [
  { notebookId: 'a', path: 'notes/a/one.md', title: 'One', tags: ['clue'] },
  { notebookId: 'b', path: 'notes/b/two.md', title: 'Two', tags: ['clue'] },
  { notebookId: 'a', path: 'notes/a/sub/three.md', title: 'Three', tags: [] },
  { notebookId: 'a', path: 'notes/ab/other.md', title: 'Other', tags: [] },
].map((note, i) => ({ ...note, id: String(i), content: '', metadata: {} })) as NoteItem[];
it('dynamically lists tags across notebooks and respects exact folder boundaries', () => {
  const base = { id: 'row', name: 'Live', view: 'small' as const, kind: 'dynamic' as const };
  expect(screenRowItems({ ...base, source: { kind: 'tag', tag: 'clue' } }, notes, []).map(i => i.kind !== 'youtube' && i.notebookId)).toEqual(['a', 'b']);
  expect(screenRowItems({ ...base, source: { kind: 'folder', notebookId: 'a', path: 'notes/a', recursive: false } }, notes, [])).toHaveLength(1);
  expect(screenRowItems({ ...base, source: { kind: 'folder', notebookId: 'a', path: 'notes/a', recursive: true } }, notes, [])).toHaveLength(2);
  expect(screenRowItems({ ...base, source: { kind: 'tag', tag: 'new-tag' } }, [...notes, { ...notes[0], tags: ['new-tag'] }], [])).toHaveLength(1);
});
