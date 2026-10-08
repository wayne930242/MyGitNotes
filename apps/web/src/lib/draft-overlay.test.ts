import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTE_QUERY, type NotebookFacets, type NoteListItem, type NoteQuery, noteRefKey } from '@mygitnotes/core/note-query';
import { overlayDraftFacets, overlayDraftLookup, overlayDraftPaths, overlayDraftRows, overlayGraphDrafts, withoutDeletedDrafts } from './draft-overlay.js';
import type { WorkingNotes } from './working-notes.js';
import type { NoteItem } from './types.js';

const row = (path: string, extra: Partial<NoteListItem> = {}): NoteListItem => ({ id: path, path, notebookId: 'life', title: path, tags: [], metadata: {}, ...extra });
const note = (path: string, extra: Partial<NoteItem> = {}): NoteItem => ({ id: path, path, notebookId: 'life', title: path, tags: [], metadata: {}, content: '', ...extra });
const query = (extra: Partial<NoteQuery> = {}): NoteQuery => ({ ...DEFAULT_NOTE_QUERY, notebookId: 'life', ...extra });
const drafts = (...entries: { note: NoteItem; base: NoteItem | null; deleted?: true; }[]): WorkingNotes => Object.fromEntries(entries.map(entry => [noteRefKey(entry.note), entry]));

describe('draft rows over a loaded page', () => {
  it('updates a drafted row in place and keeps the others', () => {
    const pages = [row('notes/life/a.md', { status: 'inbox' }), row('notes/life/b.md', { status: 'inbox' })];
    const draft = note('notes/life/a.md', { status: 'working', title: 'Edited' });
    const result = overlayDraftRows(pages, query(), drafts({ note: draft, base: note('notes/life/a.md', { status: 'inbox' }) }));
    expect(result.notes.map(item => item.title)).toEqual(['Edited', 'notes/life/b.md']);
    expect(result.uncommitted).toEqual([]);
    expect(result.removed).toBe(0);
  });

  it('removes a row the draft moved out of the query', () => {
    const pages = [row('notes/life/a.md', { status: 'inbox' })];
    const draft = note('notes/life/a.md', { status: 'done' });
    const result = overlayDraftRows(pages, query({ status: 'inbox' }), drafts({ note: draft, base: note('notes/life/a.md', { status: 'inbox' }) }));
    expect(result.notes).toEqual([]);
    expect(result.removed).toBe(1);
  });

  it('lists a created draft, and a draft the edit moved into this query, as uncommitted', () => {
    const created = note('notes/life/new.md', { status: 'inbox' });
    const moved = note('notes/life/b.md', { status: 'done' });
    const result = overlayDraftRows([], query({ status: 'done' }), drafts({ note: created, base: null }, { note: moved, base: note('notes/life/b.md', { status: 'inbox' }) }));
    expect(result.uncommitted.map(item => item.path)).toEqual(['notes/life/b.md']);
    const inbox = overlayDraftRows([], query({ status: 'inbox' }), drafts({ note: created, base: null }));
    expect(inbox.uncommitted.map(item => item.path)).toEqual(['notes/life/new.md']);
  });

  it('never lists a draft twice when the page already carries it', () => {
    const draft = note('notes/life/a.md', { status: 'inbox' });
    const result = overlayDraftRows([row('notes/life/a.md')], query(), drafts({ note: draft, base: null }));
    expect(result.notes.map(item => item.path)).toEqual(['notes/life/a.md']);
    expect(result.uncommitted).toEqual([]);
  });

  it('drops the hidden path, which the folder index shows on its own', () => {
    const result = overlayDraftRows([row('notes/life/index.md'), row('notes/life/a.md')], query(), {}, { hide: 'notes/life/index.md' });
    expect(result.notes.map(item => item.path)).toEqual(['notes/life/a.md']);
  });
});

describe('draft facets', () => {
  const facets = (): Record<string, NotebookFacets> => ({ life: { total: 2, hidden: 0, statuses: { inbox: 2 }, tags: { work: 1 }, directories: { 'notes/life': 2 }, compilations: { total: 0, statuses: {}, tags: {} }, outlines: { total: 0, statuses: {}, tags: {} } } });

  it('classifies a new outline draft before its first server read and isolates same-path notebooks', () => {
    const source = facets();
    const staged = drafts({ note: note('notes/life/new.outline.md', { status: 'working', tags: ['outline'] }), base: null });
    expect(overlayDraftRows([], query(), staged).uncommitted).toEqual([]);
    expect(overlayDraftRows([], query({ kind: 'outline' }), staged).uncommitted).toHaveLength(1);
    expect(overlayDraftRows([], query({ kind: 'outline', notebookId: 'other' }), staged).uncommitted).toEqual([]);
    const result = overlayDraftFacets(source, staged, false);
    expect(result.life).toMatchObject({ total: 2, outlines: { total: 1, statuses: { working: 1 }, tags: { outline: 1 } }, compilations: { total: 0 } });
    expect(source.life.outlines.total).toBe(0);
  });

  it('moves a draft between status counts without changing the total', () => {
    const result = overlayDraftFacets(facets(), drafts({ note: note('notes/life/a.md', { status: 'done' }), base: note('notes/life/a.md', { status: 'inbox' }) }), false);
    expect(result.life).toMatchObject({ total: 2, statuses: { inbox: 1, done: 1 } });
  });

  it('counts a created draft and its tags and directory', () => {
    const result = overlayDraftFacets(facets(), drafts({ note: note('notes/life/deep/new.md', { status: 'inbox', tags: ['work', 'new'] }), base: null }), false);
    expect(result.life).toMatchObject({ total: 3, statuses: { inbox: 3 }, tags: { work: 2, new: 1 }, directories: { 'notes/life': 2, 'notes/life/deep': 1 } });
  });

  it('counts a draft hidden by its status as hidden only', () => {
    const result = overlayDraftFacets(facets(), drafts({ note: note('notes/life/a.md', { status: 'archived', metadata: { hiden: true } }), base: note('notes/life/a.md', { status: 'inbox' }) }), false);
    expect(result.life).toMatchObject({ total: 1, hidden: 1, statuses: { inbox: 1 } });
  });

  it('leaves the answer untouched when nothing is staged', () => {
    const base = facets();
    expect(overlayDraftFacets(base, {}, false)).toBe(base);
  });
});

describe('draft paths, lookups and graph', () => {
  it('drops a path the draft no longer matches and adds one it now matches', () => {
    const staged = drafts({ note: note('notes/life/a.md', { status: 'done' }), base: note('notes/life/a.md', { status: 'inbox' }) }, { note: note('notes/life/new.md', { status: 'inbox' }), base: null });
    expect(overlayDraftPaths([{ notebookId: 'life', path: 'notes/life/a.md' }], query({ status: 'inbox' }), staged)).toEqual([{ notebookId: 'life', path: 'notes/life/new.md' }]);
  });

  it('keeps drafts of the same path in two notebooks apart', () => {
    const other = { ...note('notes/life/a.md', { title: 'Other notebook' }), notebookId: 'work' };
    const staged = drafts({ note: note('notes/life/a.md', { title: 'Life draft' }), base: note('notes/life/a.md') }, { note: other, base: null });
    const result = overlayDraftLookup([{ notebookId: 'work', path: 'notes/life/a.md' }, { notebookId: 'life', path: 'notes/life/a.md' }], [], staged);
    expect(result.map(item => item.title)).toEqual(['Other notebook', 'Life draft']);
  });

  it('answers a lookup with the staged draft, in the requested order', () => {
    const staged = drafts({ note: note('notes/life/a.md', { title: 'Draft' }), base: note('notes/life/a.md') });
    const result = overlayDraftLookup([{ notebookId: 'life', path: 'notes/life/a.md' }, { notebookId: 'life', path: 'notes/life/b.md' }], [row('notes/life/b.md'), row('notes/life/a.md')], staged);
    expect(result.map(item => item.title)).toEqual(['Draft', 'notes/life/b.md']);
  });

  it("replaces a drafted note's links and adds a node for a note the server has never seen", () => {
    const graph = { nodes: [{ id: 'life:notes/life/a.md', path: 'notes/life/a.md', title: 'A', notebookId: 'life', tags: [], inDegree: 0, outDegree: 1, val: 3 }], links: [{ source: 'life:notes/life/a.md', target: 'life:notes/life/gone.md' }] };
    const result = overlayGraphDrafts(graph, [{ path: 'notes/life/a.md', notebookId: 'life', title: 'A', tags: [], content: '[b](../life/b.md)' }, { path: 'notes/life/b.md', notebookId: 'life', title: 'B', tags: [], content: '' }]);
    expect(result.nodes.map(node => [node.id, node.path])).toEqual([['life:notes/life/a.md', 'notes/life/a.md'], ['life:notes/life/b.md', 'notes/life/b.md']]);
    expect(result.links).toEqual([{ source: 'life:notes/life/a.md', target: 'life:notes/life/b.md' }]);
  });

  it('keys drafts with the same path apart and resolves their links within their repository', () => {
    const node = (notebookId: string, path: string) => ({ id: `${notebookId}:${path}`, path, title: path, notebookId, tags: [], inDegree: 0, outDegree: 0, val: 3 });
    const graph = { nodes: [node('one', 'notes/shared/a.md'), node('one', 'notes/shared/b.md'), node('two', 'notes/shared/a.md'), node('two', 'notes/shared/only-two.md')], links: [] };
    const draft = (notebookId: string, content: string) => ({ path: 'notes/shared/a.md', notebookId, title: 'A', tags: [], content });
    const result = overlayGraphDrafts(graph, [draft('one', '[b](b.md) [elsewhere](only-two.md)'), draft('two', '[b](b.md) [here](only-two.md)')], { one: 'first', two: 'second' });
    expect(result.nodes).toHaveLength(4);
    expect(result.links).toEqual([{ source: 'one:notes/shared/a.md', target: 'one:notes/shared/b.md' }, { source: 'two:notes/shared/a.md', target: 'two:notes/shared/only-two.md' }]);
  });
});

describe('deleted drafts', () => {
  const gone = note('notes/gone.md', { tags: ['old'] });
  const deleted = drafts({ note: gone, base: gone, deleted: true });

  it('take the note out of rows, paths, lookups, facets and the graph', () => {
    expect(overlayDraftRows([row('notes/gone.md'), row('notes/kept.md')], query(), deleted)).toEqual({ notes: [row('notes/kept.md')], uncommitted: [], removed: 1 });
    expect(overlayDraftPaths([{ notebookId: 'life', path: 'notes/gone.md' }], query(), deleted)).toEqual([]);
    expect(overlayDraftLookup([{ notebookId: 'life', path: 'notes/gone.md' }], [row('notes/gone.md')], deleted)).toEqual([]);
    const facets: NotebookFacets = { total: 1, hidden: 0, statuses: {}, tags: { old: 1 }, directories: { notes: 1 }, compilations: { total: 0, statuses: {}, tags: {} }, outlines: { total: 0, statuses: {}, tags: {} } };
    expect(overlayDraftFacets({ life: facets }, deleted, false).life).toMatchObject({ total: 0, tags: {} });
    const id = noteRefKey(gone), other = noteRefKey(note('notes/kept.md'));
    const graph = { nodes: [{ id, path: gone.path, title: 'g', notebookId: 'life', tags: [], inDegree: 0, outDegree: 1, val: 3 }, { id: other, path: 'notes/kept.md', title: 'k', notebookId: 'life', tags: [], inDegree: 1, outDegree: 0, val: 3 }], links: [{ source: id, target: other }] };
    expect(withoutDeletedDrafts(graph, deleted)).toEqual({ nodes: [graph.nodes[1]], links: [] });
  });
});
