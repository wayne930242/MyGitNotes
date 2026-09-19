import { expect, it } from 'vitest';
import { applyStageAction, applyStudyAction, createStudyNote, emptyStudyWorkspace, undoStudyAction } from '@mygitnotes/core/study';
import { screenRowItems, studyRowItems } from './screen-content.js';
import type { NoteItem } from './types.js';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
const notes = [{ notebookId: 'a', path: 'notes/a/one.md', title: 'One', tags: ['clue'] }, { notebookId: 'b', path: 'notes/b/two.md', title: 'Two', tags: ['clue'] }, { notebookId: 'a', path: 'notes/a/sub/three.md', title: 'Three', tags: [] }, { notebookId: 'a', path: 'notes/ab/other.md', title: 'Other', tags: [] }].map((note, i) => ({ ...note, id: String(i), content: '', metadata: {} })) as NoteItem[];
it('lists tags only from the lane notebook and respects exact folder boundaries', () => {
  const base = { id: 'row', name: 'Live', view: 'small' as const, notebookId: 'a', kind: 'dynamic' as const };
  expect(screenRowItems({ ...base, source: { kind: 'tag', tag: 'clue', notebookId: 'a' } }, notes, []).map(i => i.kind !== 'youtube' && i.notebookId)).toEqual(['a']);
  expect(screenRowItems({ ...base, notebookId: 'b', source: { kind: 'tag', tag: 'clue', notebookId: 'b' } }, notes, []).map(i => i.kind !== 'youtube' && i.path)).toEqual(['notes/b/two.md']);
  expect(screenRowItems({ ...base, source: { kind: 'folder', notebookId: 'a', path: 'notes/a', recursive: false } }, notes, [])).toHaveLength(1);
  expect(screenRowItems({ ...base, source: { kind: 'folder', notebookId: 'a', path: 'notes/a', recursive: true } }, notes, [])).toHaveLength(2);
  expect(screenRowItems({ ...base, source: { kind: 'tag', tag: 'new-tag', notebookId: 'a' } }, [...notes, { ...notes[0], tags: ['new-tag'] }], [])).toHaveLength(1);
});

it('applies independent dynamic sorting to notes and assets without mutating inputs', () => {
  const row: ScreenRow = { id: 'r', name: 'Sorted', view: 'small', notebookId: 'a', kind: 'dynamic', source: { kind: 'folder', notebookId: 'a', path: 'notes/a', recursive: true }, sort: { field: 'title', order: 'desc' } };
  const selected = [{ ...notes[0], title: 'Note 2', mtime: 100, metadata: { created: 300 }, status: 'published' }, { ...notes[2], title: 'Note 10', mtime: 300, metadata: { created: 100 }, status: 'capture' }];
  const assets = [{ name: 'Note 5', notebookId: 'a', path: 'notes/a/image.png', mtime: 200, size: 1, rawUrl: '', markdownRef: '' }];
  const paths = (sort: typeof row.sort) => screenRowItems({ ...row, sort }, selected, assets, [{ id: 'a', title: 'A', root: 'notes/a', statuses: ['capture', 'published'] }]).map(item => item.kind !== 'youtube' && item.path);
  expect(paths({ field: 'title', order: 'desc' })).toEqual(['notes/a/sub/three.md', 'notes/a/image.png', 'notes/a/one.md']);
  expect(paths({ field: 'updated', order: 'asc' })).toEqual(['notes/a/one.md', 'notes/a/image.png', 'notes/a/sub/three.md']);
  expect(paths({ field: 'created', order: 'desc' })).toEqual(['notes/a/one.md', 'notes/a/image.png', 'notes/a/sub/three.md']);
  expect(paths({ field: 'status', order: 'asc' })).toEqual(['notes/a/sub/three.md', 'notes/a/one.md', 'notes/a/image.png']);
  expect(selected.map(note => note.title)).toEqual(['Note 2', 'Note 10']);
  expect(row.sort).toEqual({ field: 'title', order: 'desc' });
  const tagged: ScreenRow = { ...row, source: { kind: 'tag', tag: 'clue', notebookId: 'a' }, sort: { field: 'updated', order: 'desc' } };
  expect(screenRowItems(tagged, selected.map(note => ({ ...note, tags: ['clue'] })), assets).map(item => item.kind !== 'youtube' && item.path)).toEqual(['notes/a/sub/three.md', 'notes/a/one.md']);
});

it('filters and sorts study views while preserving custom pin order and note status', () => {
  const now = new Date('2026-09-14T04:00:00Z');
  const selected = notes.slice(0, 2).map((note, i) => ({ ...note, status: i ? 'done' : 'working', content: 'Question\n\n---\n\nAnswer' }));
  let study = emptyStudyWorkspace();
  for (const [index, source] of selected.entries()) {
    const note = createStudyNote(source, now);
    study = applyStudyAction(study, note, note.cards[0].id, { kind: 'read', due: index ? '2026-09-16T04:00:00.000Z' : '2026-09-17T04:00:00.000Z' }, now);
  }
  const row: ScreenRow = { id: 'custom', name: 'Selected', kind: 'custom', view: 'small', notebookId: 'a', items: selected.map((note, i) => ({ id: `pin-${i}`, kind: 'note', notebookId: note.notebookId, path: note.path })) };
  expect(studyRowItems(row.items, { ...row, study: { filter: 'future', dueFirst: true } }, selected, study, now).map(item => item.id)).toEqual(['pin-1', 'pin-0']);
  expect(studyRowItems(row.items, { ...row, study: { filter: 'future', dueFirst: false, status: 'working' } }, selected, study, now).map(item => item.id)).toEqual(['pin-0']);
  expect(studyRowItems(row.items, { ...row, study: { filter: 'due', dueFirst: true } }, selected, study, now)).toEqual([]);
  expect(row.items.map(item => item.id)).toEqual(['pin-0', 'pin-1']);
  expect(selected.map(note => note.status)).toEqual(['working', 'done']);
});

it('orders cards by each move time plus its destination interval across days and after a same-stage move', () => {
  const selected = notes.slice(0, 3).map(note => ({ ...note, status: 'working' }));
  const progression = { stages: [{ status: 'working', intervalDays: 3 }, { status: 'review', intervalDays: 7 }], easy: 'two' as const };
  let study = emptyStudyWorkspace();
  // The older review-stage card is due between two working-stage cards.
  const times = ['2026-09-14T08:00:00.000Z', '2026-09-10T09:00:00.000Z', '2026-09-14T10:00:00.000Z'];
  selected.forEach((source, i) => {
    const now = new Date(times[i]);
    study = applyStageAction(study, createStudyNote(source, now), 'lane', 'working', progression, { kind: 'stage-review', rating: i === 1 ? 3 : 2 }, now);
  });
  const row: ScreenRow = { id: 'lane', name: 'Study', kind: 'custom', view: 'small', notebookId: 'a', items: selected.map((note, i) => ({ id: `pin-${i}`, kind: 'note', notebookId: note.notebookId, path: note.path })), study: { filter: 'all', dueFirst: true } };
  const ordered = () => studyRowItems([...row.items].reverse(), row, selected, study).map(item => item.id);
  expect(study.notes.map(note => note.lastMovedAt)).toEqual(times);
  expect(ordered()).toEqual(['pin-0', 'pin-1', 'pin-2']);
  const first = study.notes[0];
  study = applyStageAction(study, first, 'lane', 'working', progression, { kind: 'stage-review', rating: 2 }, new Date('2026-09-14T11:00:00.000Z'));
  expect(ordered()).toEqual(['pin-1', 'pin-2', 'pin-0']);
  const dueRow = { ...row, study: { filter: 'due' as const, dueFirst: true } };
  expect(studyRowItems(row.items, dueRow, selected, study, new Date('2026-09-17T09:30:00.000Z')).map(item => item.id)).toEqual(['pin-1']);
  study = undoStudyAction(study);
  expect(ordered()).toEqual(['pin-0', 'pin-1', 'pin-2']);
});
