import { describe, expect, it } from 'vitest';
import type { NotebookConfig, WorkspaceConfig } from '../src/types.js';
import type { NoteListItem } from '../src/note-query.js';
import { DEFAULT_NOTE_QUERY } from '../src/note-query.js';
import { type CatalogRepository, lookupNotes, noteAgenda, type NoteCatalog, noteFacets, noteGraph, parseNoteQuery, parseRevisions, queryNotePaths, queryNotes, workspaceCatalog } from '../src/note-catalog.js';
import { type RevisionSet, StaleRevisionError } from '../src/repository.js';

const config: WorkspaceConfig = { schema_version: 1, workspace: { title: 'Test', default_notebook: 'work' }, notebooks: [{ id: 'work', title: 'Work', root: 'notes/work', statuses: ['inbox', 'done'] }, { id: 'life', title: 'Life', root: 'notes/life' }] as NotebookConfig[] };

const bodies: Record<string, string> = { 'notes/work/alpha.md': 'Alpha body with keyword\n\n- [ ] ship it 📅 2026-09-20\n', 'notes/work/deep/beta.md': 'Beta body\n\n[alpha](../alpha.md)\n', 'notes/work/archived.md': 'Old body\n', 'notes/life/gamma.md': 'Gamma body keyword\n' };
const item = (path: string, notebookId: string, extra: Partial<NoteListItem> = {}): NoteListItem => ({ id: path, path, notebookId, title: path.split('/').pop()!.replace('.md', ''), tags: [], metadata: {}, ...extra });
const items: NoteListItem[] = [item('notes/work/alpha.md', 'work', { status: 'inbox', tags: ['a', 'b'], metadata: { updated: '2026-09-02', created: '2026-09-01' } }), item('notes/work/deep/beta.md', 'work', { status: 'done', tags: ['b'], metadata: { updated: '2026-09-03' } }), item('notes/work/archived.md', 'work', { status: 'archived', tags: ['a'], metadata: { hiden: true, updated: '2026-09-04' } }), item('notes/life/gamma.md', 'life', { tags: ['c'], metadata: { updated: '2026-09-01', created: '2026-09-01' } })];

const WORK = 'github:owner/work@main', LIFE = 'github:owner/life@main';
const revisions: RevisionSet = { [WORK]: 'a'.repeat(40), [LIFE]: 'b'.repeat(40) };

/** Two repositories: `work` is served by one and `life` by the other. */
async function catalog(expected: RevisionSet = {}): Promise<NoteCatalog & { contentReads: string[]; memoKinds: string[]; }> {
  const contentReads: string[] = [], memoKinds: string[] = [];
  const repository = (id: string, notebookId: string): CatalogRepository => ({
    id,
    notebooks: config.notebooks.filter(notebook => notebook.id === notebookId),
    catalog: {
      revision: async () => revisions[id],
      index: async notebook => items.filter(note => note.notebookId === notebook.id),
      contents: async notes => {
        contentReads.push(...notes.map(note => note.path));
        return new Map(notes.map(note => [note.path, bodies[note.path] ?? '']));
      },
      memo: (kind, _notebooks, compute) => {
        memoKinds.push(kind);
        return compute();
      },
    },
  });
  return Object.assign(await workspaceCatalog(config, [repository(WORK, 'work'), repository(LIFE, 'life')], expected), { contentReads, memoKinds });
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
    const first = await queryNotes(await catalog(), query({ notebookId: 'work' }), { limit: 1, content: false });
    expect(first.notes.map(note => note.path)).toEqual(['notes/work/deep/beta.md']);
    expect(first.total).toBe(2);
    const second = await queryNotes(await catalog(), query({ notebookId: 'work' }), { limit: 1, content: false, cursor: first.nextCursor! });
    expect(second.notes.map(note => note.path)).toEqual(['notes/work/alpha.md']);
    expect(second.nextCursor).toBeNull();
    await expect(queryNotes(await catalog(), query({ notebookId: 'life' }), { limit: 1, content: false, cursor: first.nextCursor! })).rejects.toThrow(/Cursor/);
    await expect(queryNotes(await catalog(), query({ notebookId: 'work' }), { limit: 1, content: false, cursor: 'not-a-cursor' })).rejects.toThrow(/cursor/i);
  });

  it('includes hidden notes only when asked and filters folders, tags and status', async () => {
    const hidden = await queryNotes(await catalog(), query({ notebookId: 'work', showHidden: true }), { limit: 50, content: false });
    expect(hidden.total).toBe(3);
    const folder = await queryNotes(await catalog(), query({ notebookId: 'work', folders: ['notes/work'], descendants: false }), { limit: 50, content: false });
    expect(folder.notes.map(note => note.path)).toEqual(['notes/work/alpha.md']);
    const tags = await queryNotes(await catalog(), query({ notebookId: 'all', tags: ['a', 'b'], tagMode: 'all' }), { limit: 50, content: false });
    expect(tags.notes.map(note => note.path)).toEqual(['notes/work/alpha.md']);
    const status = await queryNotes(await catalog(), query({ notebookId: 'work', status: 'done' }), { limit: 50, content: false });
    expect(status.notes.map(note => note.path)).toEqual(['notes/work/deep/beta.md']);
    const excluded = await queryNotes(await catalog(), query({ notebookId: 'work', exclude: ['notes/work/alpha.md'] }), { limit: 50, content: false });
    expect(excluded.notes.map(note => note.path)).toEqual(['notes/work/deep/beta.md']);
  });

  it('searches content only for the requested match mode and attaches content on demand', async () => {
    const source = await catalog();
    const text = await queryNotes(source, query({ notebookId: 'all', q: 'keyword' }), { limit: 50, content: false });
    expect(text.notes.map(note => note.path)).toEqual(['notes/work/alpha.md', 'notes/life/gamma.md']);
    expect(source.contentReads.length).toBeGreaterThan(0);

    const titles = await catalog();
    const byTitle = await queryNotes(titles, query({ notebookId: 'all', q: 'keyword', match: 'title' }), { limit: 50, content: false });
    expect(byTitle.total).toBe(0);
    expect(titles.contentReads).toEqual([]);

    const withContent = await queryNotes(await catalog(), query({ notebookId: 'life' }), { limit: 50, content: true });
    expect(withContent.notes[0].content).toBe(bodies['notes/life/gamma.md']);
  });

  it('attaches a matched-content snippet when the search hits the body, even without requesting content', async () => {
    const contentMatch = await queryNotes(await catalog(), query({ notebookId: 'all', q: 'keyword' }), { limit: 50, content: false });
    const alpha = contentMatch.notes.find(note => note.path === 'notes/work/alpha.md')!;
    expect(alpha.matchSnippet).toContain('keyword');
    expect(alpha.content).toBeUndefined();

    const titleMatch = await queryNotes(await catalog(), query({ notebookId: 'work', q: 'alpha', match: 'title' }), { limit: 50, content: false });
    expect(titleMatch.notes[0].matchSnippet).toBeUndefined();

    const pathOnlyMatch = await queryNotes(await catalog(), query({ notebookId: 'work', q: 'deep/beta' }), { limit: 50, content: false });
    expect(pathOnlyMatch.notes[0].matchSnippet).toBeUndefined();
  });

  it('returns every matching path for path selection', async () => {
    const paths = await queryNotePaths(await catalog(), query({ notebookId: 'all', tags: ['b'] }));
    expect(paths).toMatchObject({ revisions, total: 2 });
    expect(paths.notes).toEqual([{ notebookId: 'work', path: 'notes/work/deep/beta.md' }, { notebookId: 'work', path: 'notes/work/alpha.md' }]);
  });
});

describe('facets, lookup, agenda and graph', () => {
  it('counts visible notes, statuses, tags and directories per notebook', async () => {
    const facets = await noteFacets(await catalog(), false);
    expect(facets.notebooks.work).toMatchObject({ total: 2, hidden: 1, statuses: { inbox: 1, done: 1 }, tags: { a: 1, b: 2 } });
    expect(facets.notebooks.work.directories).toEqual({ 'notes/work': 1, 'notes/work/deep': 1 });
    expect((await noteFacets(await catalog(), true)).notebooks.work.total).toBe(3);
  });

  it('looks up notes by path, keeping request order and skipping unknown paths', async () => {
    const result = await lookupNotes(await catalog(), [{ notebookId: 'life', path: 'notes/life/gamma.md' }, { notebookId: 'work', path: 'notes/work/missing.md' }, { notebookId: 'work', path: 'notes/work/alpha.md' }, { notebookId: 'life', path: 'notes/work/alpha.md' }], true);
    expect(result.notes.map(note => note.path)).toEqual(['notes/life/gamma.md', 'notes/work/alpha.md']);
    expect(result.notes[0].content).toBe(bodies['notes/life/gamma.md']);
    await expect(lookupNotes(await catalog(), [], false)).rejects.toThrow(/1 and 200/);
    await expect(lookupNotes(await catalog(), ['notes/life/gamma.md'], false)).rejects.toThrow(/notebook and path/);
  });

  it('collects tasks and dated notes for the requested scope', async () => {
    const agenda = await noteAgenda(await catalog(), 'work', false);
    expect(agenda.tasks.map(task => task.notePath)).toEqual(['notes/work/alpha.md']);
    expect(agenda.tasks[0]).toMatchObject({ due: '2026-09-20', checked: false, lineIndex: 2 });
    expect(agenda.dated.map(note => note.path)).toEqual(['notes/work/alpha.md', 'notes/work/deep/beta.md']);
    expect(agenda.dated.every(note => note.content === undefined)).toBe(true);
  });

  it('builds the workspace graph from note links', async () => {
    const graph = await noteGraph(await catalog());
    expect(graph.revisions).toEqual(revisions);
    expect(graph.links).toEqual([{ source: 'notes/work/deep/beta.md', target: 'notes/work/alpha.md' }]);
    expect(graph.nodes.map(node => node.id)).toContain('notes/work/archived.md');
  });
});

describe('a catalog over several repositories', () => {
  it('reports the revisions of the repositories a query involves', async () => {
    expect((await queryNotes(await catalog(), query({ notebookId: 'work' }), { limit: 50, content: false })).revisions).toEqual({ [WORK]: revisions[WORK] });
    expect((await queryNotes(await catalog(), query({ notebookId: 'all' }), { limit: 50, content: false })).revisions).toEqual(revisions);
    expect((await lookupNotes(await catalog(), [{ notebookId: 'life', path: 'notes/life/gamma.md' }], false)).revisions).toEqual({ [LIFE]: revisions[LIFE] });
    expect((await noteFacets(await catalog(), false)).revisions).toEqual(revisions);
  });

  it('marks each dated agenda note with its own repository revision', async () => {
    const agenda = await noteAgenda(await catalog(), 'all', false);
    expect(Object.fromEntries(agenda.dated.map(note => [note.path, note.revision]))).toMatchObject({ 'notes/work/alpha.md': revisions[WORK], 'notes/life/gamma.md': revisions[LIFE] });
  });

  it('names every repository that moved on or left the workspace', async () => {
    await expect(catalog({ [WORK]: revisions[WORK], [LIFE]: 'c'.repeat(40), 'github:owner/gone@main': 'd'.repeat(40) })).rejects.toMatchObject({ status: 409, repositories: [LIFE, 'github:owner/gone@main'] });
    await expect(catalog({ [LIFE]: 'c'.repeat(40) })).rejects.toBeInstanceOf(StaleRevisionError);
    await expect(catalog(revisions)).resolves.toBeDefined();
  });

  it('remembers results of one repository and recomputes results spanning several', async () => {
    const one = await catalog();
    await noteAgenda(one, 'work', false);
    expect(one.memoKinds).toEqual(['agenda:0']);
    const both = await catalog();
    await noteGraph(both);
    expect(both.memoKinds).toEqual([]);
  });

  it('rejects a cursor after a repository moved on', async () => {
    const first = await queryNotes(await catalog(), query({ notebookId: 'all' }), { limit: 1, content: false });
    const moved = await workspaceCatalog(config, [{ id: WORK, notebooks: config.notebooks, catalog: { revision: async () => 'e'.repeat(40), index: async notebook => items.filter(note => note.notebookId === notebook.id), contents: async () => new Map(), memo: (_kind, _notebooks, compute) => compute() } }]);
    await expect(queryNotes(moved, query({ notebookId: 'all' }), { limit: 1, content: false, cursor: first.nextCursor! })).rejects.toThrow(/Cursor/);
  });

  it('reads revisions from a query string or a request body', () => {
    expect(parseRevisions(JSON.stringify(revisions))).toEqual(revisions);
    expect(parseRevisions(revisions)).toEqual(revisions);
    expect(parseRevisions(undefined)).toEqual({});
    expect(() => parseRevisions('{')).toThrow(/Invalid revisions/);
    expect(() => parseRevisions({ [WORK]: 'short' })).toThrow(/Invalid revisions/);
    expect(() => parseRevisions(['a'.repeat(40)])).toThrow(/Invalid revisions/);
  });
});

describe('notes with the same path in two repositories', () => {
  it('stay distinct in lookups and path queries', async () => {
    // Two repositories can each hold a notebook whose root is `notes/shared`.
    const shared = [{ id: 'one', title: 'One', root: 'notes/shared' }, { id: 'two', title: 'Two', root: 'notes/shared' }] as NotebookConfig[];
    const workspace: WorkspaceConfig = { ...config, notebooks: shared };
    const note = (notebookId: string) => item('notes/shared/a.md', notebookId, { title: notebookId });
    const repository = (id: string, notebook: NotebookConfig): CatalogRepository => ({ id, notebooks: [notebook], catalog: { revision: async () => 'f'.repeat(40), index: async nb => [note(nb.id)], contents: async notes => new Map(notes.map(n => [n.path, n.notebookId])), memo: (_kind, _notebooks, compute) => compute() } });
    const catalog = await workspaceCatalog(workspace, [repository('github:o/one@main', shared[0]), repository('github:o/two@main', shared[1])]);
    const found = await lookupNotes(catalog, [{ notebookId: 'two', path: 'notes/shared/a.md' }, { notebookId: 'one', path: 'notes/shared/a.md' }], false);
    expect(found.notes.map(n => n.title)).toEqual(['two', 'one']);
    const bodies = await lookupNotes(catalog, [{ notebookId: 'one', path: 'notes/shared/a.md' }, { notebookId: 'two', path: 'notes/shared/a.md' }], true);
    expect(bodies.notes.map(n => n.content)).toEqual(['one', 'two']);
    expect((await queryNotePaths(catalog, query({ notebookId: 'all', sort: 'title', order: 'asc' }))).notes).toEqual([{ notebookId: 'one', path: 'notes/shared/a.md' }, { notebookId: 'two', path: 'notes/shared/a.md' }]);
  });
});
