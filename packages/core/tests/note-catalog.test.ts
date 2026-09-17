import { describe, expect, it } from 'vitest';
import type { NotebookConfig, WorkspaceConfig } from '../src/types.js';
import type { NoteListItem } from '../src/note-query.js';
import { DEFAULT_NOTE_QUERY } from '../src/note-query.js';
import { lookupNotes, noteAgenda, noteFacets, noteGraph, parseNoteQuery, queryNotePaths, queryNotes, type NoteCatalog } from '../src/note-catalog.js';

const config: WorkspaceConfig = {
  schema_version: 1,
  workspace: { title: 'Test', default_notebook: 'work' },
  notebooks: [
    { id: 'work', title: 'Work', root: 'notes/work', statuses: ['inbox', 'done'] },
    { id: 'life', title: 'Life', root: 'notes/life' },
  ] as NotebookConfig[],
};

const bodies: Record<string, string> = {
  'notes/work/alpha.md': 'Alpha body with keyword\n\n- [ ] ship it 📅 2026-09-20\n',
  'notes/work/deep/beta.md': 'Beta body\n\n[alpha](../alpha.md)\n',
  'notes/work/archived.md': 'Old body\n',
  'notes/life/gamma.md': 'Gamma body keyword\n',
};
const item = (path: string, notebookId: string, extra: Partial<NoteListItem> = {}): NoteListItem => ({
  id: path, path, notebookId, title: path.split('/').pop()!.replace('.md', ''), tags: [], metadata: {}, ...extra,
});
const items: NoteListItem[] = [
  item('notes/work/alpha.md', 'work', { status: 'inbox', tags: ['a', 'b'], metadata: { updated: '2026-09-02', created: '2026-09-01' } }),
  item('notes/work/deep/beta.md', 'work', { status: 'done', tags: ['b'], metadata: { updated: '2026-09-03' } }),
  item('notes/work/archived.md', 'work', { status: 'archived', tags: ['a'], metadata: { hiden: true, updated: '2026-09-04' } }),
  item('notes/life/gamma.md', 'life', { tags: ['c'], metadata: { updated: '2026-09-01', created: '2026-09-01' } }),
];

function catalog(): NoteCatalog & { contentReads: string[] } {
  const contentReads: string[] = [];
  return {
    contentReads,
    revision: async () => 'rev1',
    config: async () => config,
    index: async notebook => items.filter(note => note.notebookId === notebook.id),
    contents: async notes => {
      contentReads.push(...notes.map(note => note.path));
      return new Map(notes.map(note => [note.path, bodies[note.path] ?? '']));
    },
    memo: (_kind, _notebooks, compute) => compute(),
  };
}

const query = (overrides: Partial<typeof DEFAULT_NOTE_QUERY> = {}) => ({ ...DEFAULT_NOTE_QUERY, ...overrides });

describe('note query parsing', () => {
  it('reads repeated filters and rejects unsafe or out-of-range options', () => {
    const parsed = parseNoteQuery({ notebookId: 'work', folder: ['notes/work'], descendants: '0', tag: ['a', 'b'], tagMode: 'all', status: 'inbox', showHidden: '1', q: 'text', limit: '10', content: '1' });
    expect(parsed.query).toMatchObject({ notebookId: 'work', folders: ['notes/work'], descendants: false, tags: ['a', 'b'], tagMode: 'all', status: 'inbox', showHidden: true, q: 'text' });
    expect(parseNoteQuery({ notebookId: 'work', noStatus: '1' }).query.withoutStatus).toBe(true);
    expect(parsed.options).toMatchObject({ limit: 10, content: true });
    expect(() => parseNoteQuery({})).toThrow(/notebookId/);
    expect(() => parseNoteQuery({ notebookId: 'work', folder: ['../escape'] })).toThrow();
    expect(() => parseNoteQuery({ notebookId: 'work', limit: '500' })).toThrow();
    expect(() => parseNoteQuery({ notebookId: 'work', sort: 'size' })).toThrow();
    expect(() => parseNoteQuery({ notebookId: 'work', q: 'x'.repeat(501) })).toThrow();
  });
});

describe('note queries', () => {
  it('hides hidden notes, sorts, and pages with a cursor bound to the query', async () => {
    const first = await queryNotes(catalog(), query({ notebookId: 'work' }), { limit: 1, content: false });
    expect(first.notes.map(note => note.path)).toEqual(['notes/work/deep/beta.md']);
    expect(first.total).toBe(2);
    const second = await queryNotes(catalog(), query({ notebookId: 'work' }), { limit: 1, content: false, cursor: first.nextCursor! });
    expect(second.notes.map(note => note.path)).toEqual(['notes/work/alpha.md']);
    expect(second.nextCursor).toBeNull();
    await expect(queryNotes(catalog(), query({ notebookId: 'life' }), { limit: 1, content: false, cursor: first.nextCursor! })).rejects.toThrow(/Cursor/);
    await expect(queryNotes(catalog(), query({ notebookId: 'work' }), { limit: 1, content: false, cursor: 'not-a-cursor' })).rejects.toThrow(/cursor/i);
  });

  it('includes hidden notes only when asked and filters folders, tags and status', async () => {
    const hidden = await queryNotes(catalog(), query({ notebookId: 'work', showHidden: true }), { limit: 50, content: false });
    expect(hidden.total).toBe(3);
    const folder = await queryNotes(catalog(), query({ notebookId: 'work', folders: ['notes/work'], descendants: false }), { limit: 50, content: false });
    expect(folder.notes.map(note => note.path)).toEqual(['notes/work/alpha.md']);
    const tags = await queryNotes(catalog(), query({ notebookId: 'all', tags: ['a', 'b'], tagMode: 'all' }), { limit: 50, content: false });
    expect(tags.notes.map(note => note.path)).toEqual(['notes/work/alpha.md']);
    const status = await queryNotes(catalog(), query({ notebookId: 'work', status: 'done' }), { limit: 50, content: false });
    expect(status.notes.map(note => note.path)).toEqual(['notes/work/deep/beta.md']);
    const excluded = await queryNotes(catalog(), query({ notebookId: 'work', exclude: ['notes/work/alpha.md'] }), { limit: 50, content: false });
    expect(excluded.notes.map(note => note.path)).toEqual(['notes/work/deep/beta.md']);
  });

  it('searches content only for the requested match mode and attaches content on demand', async () => {
    const source = catalog();
    const text = await queryNotes(source, query({ notebookId: 'all', q: 'keyword' }), { limit: 50, content: false });
    expect(text.notes.map(note => note.path)).toEqual(['notes/work/alpha.md', 'notes/life/gamma.md']);
    expect(source.contentReads.length).toBeGreaterThan(0);

    const titles = catalog();
    const byTitle = await queryNotes(titles, query({ notebookId: 'all', q: 'keyword', match: 'title' }), { limit: 50, content: false });
    expect(byTitle.total).toBe(0);
    expect(titles.contentReads).toEqual([]);

    const withContent = await queryNotes(catalog(), query({ notebookId: 'life' }), { limit: 50, content: true });
    expect(withContent.notes[0].content).toBe(bodies['notes/life/gamma.md']);
  });

  it('returns every matching path for path selection', async () => {
    const paths = await queryNotePaths(catalog(), query({ notebookId: 'all', tags: ['b'] }));
    expect(paths).toMatchObject({ revision: 'rev1', total: 2 });
    expect(paths.paths).toEqual(['notes/work/deep/beta.md', 'notes/work/alpha.md']);
  });
});

describe('facets, lookup, agenda and graph', () => {
  it('counts visible notes, statuses, tags and directories per notebook', async () => {
    const facets = await noteFacets(catalog(), false);
    expect(facets.notebooks.work).toMatchObject({ total: 2, hidden: 1, statuses: { inbox: 1, done: 1 }, tags: { a: 1, b: 2 } });
    expect(facets.notebooks.work.directories).toEqual({ 'notes/work': 1, 'notes/work/deep': 1 });
    expect((await noteFacets(catalog(), true)).notebooks.work.total).toBe(3);
  });

  it('looks up notes by path, keeping request order and skipping unknown paths', async () => {
    const result = await lookupNotes(catalog(), ['notes/life/gamma.md', 'notes/work/missing.md', 'notes/work/alpha.md'], true);
    expect(result.notes.map(note => note.path)).toEqual(['notes/life/gamma.md', 'notes/work/alpha.md']);
    expect(result.notes[0].content).toBe(bodies['notes/life/gamma.md']);
    await expect(lookupNotes(catalog(), [], false)).rejects.toThrow(/1 and 200/);
  });

  it('collects tasks and dated notes for the requested scope', async () => {
    const agenda = await noteAgenda(catalog(), 'work', false);
    expect(agenda.tasks.map(task => task.notePath)).toEqual(['notes/work/alpha.md']);
    expect(agenda.tasks[0]).toMatchObject({ due: '2026-09-20', checked: false, lineIndex: 2 });
    expect(agenda.dated.map(note => note.path)).toEqual(['notes/work/alpha.md', 'notes/work/deep/beta.md']);
    expect(agenda.dated.every(note => note.content === undefined)).toBe(true);
  });

  it('builds the workspace graph from note links', async () => {
    const graph = await noteGraph(catalog());
    expect(graph.revision).toBe('rev1');
    expect(graph.links).toEqual([{ source: 'notes/work/deep/beta.md', target: 'notes/work/alpha.md' }]);
    expect(graph.nodes.map(node => node.id)).toContain('notes/work/archived.md');
  });
});
