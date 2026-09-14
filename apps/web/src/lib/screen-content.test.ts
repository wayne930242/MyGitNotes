import { expect, it } from 'vitest';
import { createStudyNote, applyStudyAction, emptyStudyWorkspace } from '@github-notes/core/study';
import { screenRowItems, studyRowItems } from './screen-content.js';
import type { NoteItem } from './types.js';
import type { ScreenRow } from '@github-notes/core/screen-page';
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

it('applies independent dynamic sorting to notes and assets without mutating inputs', () => {
  const row: ScreenRow = { id: 'r', name: 'Sorted', view: 'small', kind: 'dynamic', source: { kind: 'folder', notebookId: 'a', path: 'notes/a', recursive: true }, sort: { field: 'title', order: 'desc' } };
  const selected = [
    { ...notes[0], title: 'Note 2', mtime: 100, metadata: { created: 300 }, status: 'published' },
    { ...notes[2], title: 'Note 10', mtime: 300, metadata: { created: 100 }, status: 'capture' },
  ];
  const assets = [{name:'Note 5',notebookId:'a',path:'notes/a/image.png',mtime:200,size:1,rawUrl:'',markdownRef:''}];
  const paths = (sort: typeof row.sort) => screenRowItems({...row,sort},selected,assets,[{id:'a',title:'A',root:'notes/a',statuses:['capture','published']}]).map(item=>item.kind!=='youtube'&&item.path);
  expect(paths({field:'title',order:'desc'})).toEqual(['notes/a/sub/three.md','notes/a/image.png','notes/a/one.md']);
  expect(paths({field:'updated',order:'asc'})).toEqual(['notes/a/one.md','notes/a/image.png','notes/a/sub/three.md']);
  expect(paths({field:'created',order:'desc'})).toEqual(['notes/a/one.md','notes/a/image.png','notes/a/sub/three.md']);
  expect(paths({field:'status',order:'asc'})).toEqual(['notes/a/sub/three.md','notes/a/one.md','notes/a/image.png']);
  expect(selected.map(note=>note.title)).toEqual(['Note 2','Note 10']);
  expect(row.sort).toEqual({field:'title',order:'desc'});
  const tagged: ScreenRow = {...row, source:{kind:'tag',tag:'clue'},sort:{field:'updated',order:'desc'}};
  expect(screenRowItems(tagged,selected.map(note=>({...note,tags:['clue']})),assets).map(item=>item.kind!=='youtube'&&item.path)).toEqual(['notes/a/sub/three.md','notes/a/one.md']);
});

it('filters and sorts study views while preserving custom pin order and note status', () => {
  const now = new Date('2026-09-14T04:00:00Z');
  const selected = notes.slice(0, 2).map((note, i) => ({ ...note, status: i ? 'done' : 'working', content: 'Question\n\n---\n\nAnswer' }));
  let study = emptyStudyWorkspace();
  for (const [index, source] of selected.entries()) {
    const note = createStudyNote(source, now);
    study = applyStudyAction(study, note, note.cards[0].id, { kind: 'read', due: index ? '2026-09-16T04:00:00.000Z' : '2026-09-17T04:00:00.000Z' }, now);
  }
  const row: ScreenRow = { id: 'custom', name: 'Selected', kind: 'custom', view: 'small', items: selected.map((note, i) => ({ id: `pin-${i}`, kind: 'note', notebookId: note.notebookId, path: note.path })) };
  expect(studyRowItems(row.items, { ...row, study: { filter: 'future', dueFirst: true } }, selected, study, now).map(item => item.id)).toEqual(['pin-1', 'pin-0']);
  expect(studyRowItems(row.items, { ...row, study: { filter: 'future', dueFirst: false, status: 'working' } }, selected, study, now).map(item => item.id)).toEqual(['pin-0']);
  expect(studyRowItems(row.items, { ...row, study: { filter: 'due', dueFirst: true } }, selected, study, now)).toEqual([]);
  expect(row.items.map(item => item.id)).toEqual(['pin-0', 'pin-1']);
  expect(selected.map(note => note.status)).toEqual(['working', 'done']);
});
