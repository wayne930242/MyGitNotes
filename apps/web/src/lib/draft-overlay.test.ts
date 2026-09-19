import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTE_QUERY, type NotebookFacets, type NoteListItem, type NoteQuery } from '@mygitnotes/core/note-query';
import { overlayDraftFacets, overlayDraftLookup, overlayDraftPaths, overlayDraftRows, overlayGraphDrafts } from './draft-overlay.js';
import type { WorkingNotes } from './working-notes.js';
import type { NoteItem } from './types.js';

const row = (path: string, extra: Partial<NoteListItem> = {}): NoteListItem => ({ id: path, path, notebookId: 'life', title: path, tags: [], metadata: {}, ...extra });
const note = (path: string, extra: Partial<NoteItem> = {}): NoteItem => ({ id: path, path, notebookId: 'life', title: path, tags: [], metadata: {}, content: '', ...extra });
const query = (extra: Partial<NoteQuery> = {}): NoteQuery => ({ ...DEFAULT_NOTE_QUERY, notebookId: 'life', ...extra });
const drafts = (...entries: { note: NoteItem; base: NoteItem | null; }[]): WorkingNotes => Object.fromEntries(entries.map(entry => [entry.note.path, entry]));

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
  const facets = (): Record<string, NotebookFacets> => ({ life: { total: 2, hidden: 0, statuses: { inbox: 2 }, tags: { work: 1 }, directories: { 'notes/life': 2 } } });

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
    expect(overlayDraftPaths(['notes/life/a.md'], query({ status: 'inbox' }), staged)).toEqual(['notes/life/new.md']);
  });

  it('answers a lookup with the staged draft, in the requested order', () => {
    const staged = drafts({ note: note('notes/life/a.md', { title: 'Draft' }), base: note('notes/life/a.md') });
    const result = overlayDraftLookup(['notes/life/a.md', 'notes/life/b.md'], [row('notes/life/b.md'), row('notes/life/a.md')], staged);
    expect(result.map(item => item.title)).toEqual(['Draft', 'notes/life/b.md']);
  });

  it("replaces a drafted note's links and adds a node for a note the server has never seen", () => {
    const graph = { nodes: [{ id: 'notes/life/a.md', title: 'A', notebookId: 'life', tags: [], inDegree: 0, outDegree: 1, val: 3 }], links: [{ source: 'notes/life/a.md', target: 'notes/life/gone.md' }] };
    const result = overlayGraphDrafts(graph, [{ path: 'notes/life/a.md', notebookId: 'life', title: 'A', tags: [], content: '[b](../life/b.md)' }, { path: 'notes/life/b.md', notebookId: 'life', title: 'B', tags: [], content: '' }]);
    expect(result.nodes.map(node => node.id)).toEqual(['notes/life/a.md', 'notes/life/b.md']);
    expect(result.links).toEqual([{ source: 'notes/life/a.md', target: 'notes/life/b.md' }]);
  });
});
