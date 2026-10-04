import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { classifyResource } from '../src/classifier.js';
import { DEFAULT_NOTE_QUERY } from '../src/note-query.js';
import { lookupNotes, noteAgenda, noteFacets, noteGraph, queryNotePaths, queryNotes, workspaceCatalog } from '../src/note-catalog.js';
import { readNoteFile, scanNotebookEntries, scanNotebookNotes, writeNoteFile } from '../src/note-service.js';
import type { NotebookConfig } from '../src/types.js';
import { githubFixture } from './fixtures/github.js';

vi.setConfig({ testTimeout: 30000 });

const compilation = (id: string, extra = '', items = '  - { id: i1, kind: note, path: notes/ex/a.md }') => `version: 1\nid: ${id}\ntitle: Title ${id}\narrangement: lane\n${extra}items:\n${items}\n`;
const manifest = 'schema_version: 3\nworkspace:\n  title: QA\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n  - id: other\n    title: Other\n    root: notes/other\n';
const query = (overrides: Partial<typeof DEFAULT_NOTE_QUERY> = {}) => ({ ...DEFAULT_NOTE_QUERY, notebookId: 'ex', ...overrides });
const options = { limit: 50, content: false };

async function catalogOf(f: ReturnType<typeof githubFixture>) {
  const reader = f.reader();
  const config = await reader.config();
  return workspaceCatalog(config, [{ id: reader.id, notebooks: config.notebooks, catalog: reader.catalog() }]);
}

describe('compilations in the remote catalog', () => {
  const files = { '.github-notes.yaml': manifest, 'notes/ex/a.md': '---\ntags: [clue]\ntitle: Alpha\n---\nBody mentions [b](work/b.md)\n- [ ] ship it 📅 2026-09-20\n', 'notes/ex/reading.compilation.yml': compilation('reading', 'tags: [reading]\nstatus: working\n'), 'notes/ex/deep/plan.compilation.yml': compilation('plan', 'status: archived\n'), 'notes/ex/broken.compilation.yml': 'version: 1\nid: broken\ntitle: Broken\ntags: [x]\narrangement: nope\nitems: []\n', 'notes/ex/outside.compilation.yml': compilation('outside', '', '  - { id: i1, kind: note, path: notes/other/z.md }'), 'notes/other/z.md': '# Z\n', 'notes/other/dup.compilation.yml': compilation('reading', '', '  - { id: i1, kind: note, path: notes/other/z.md }') };

  it('lists compilations as entries of kind compilation with their title, tags and status', async () => {
    const catalog = await catalogOf(githubFixture(files));
    const page = await queryNotes(catalog, query({ kind: 'compilation', showHidden: true }), options);
    const byPath = new Map(page.notes.map(note => [note.path, note]));
    expect(byPath.get('notes/ex/reading.compilation.yml')).toMatchObject({ kind: 'compilation', title: 'Title reading', tags: ['reading'], status: 'working', metadata: { id: 'reading', arrangement: 'lane', itemCount: 1 } });
    expect(byPath.get('notes/ex/deep/plan.compilation.yml')).toMatchObject({ kind: 'compilation', status: 'archived' });
    expect(page.notes.every(note => note.kind === 'compilation')).toBe(true);
  });

  it('keeps notes the default: a query without kind never returns a compilation', async () => {
    const catalog = await catalogOf(githubFixture(files));
    expect((await queryNotes(catalog, query(), options)).notes.map(note => note.path).sort()).toEqual(['notes/ex/a.md', 'notes/ex/work/b.md']);
    expect((await queryNotePaths(catalog, query({ kind: 'all' }))).notes.map(note => note.path).sort()).toEqual(['notes/ex/a.md', 'notes/ex/broken.compilation.yml', 'notes/ex/outside.compilation.yml', 'notes/ex/reading.compilation.yml', 'notes/ex/work/b.md']);
  });

  it('narrows compilations by tag, status, folder and search like notes', async () => {
    const catalog = await catalogOf(githubFixture(files));
    const paths = async (extra: Partial<typeof DEFAULT_NOTE_QUERY>) => (await queryNotes(catalog, query({ kind: 'compilation', showHidden: true, ...extra }), options)).notes.map(note => note.path);
    expect(await paths({ tags: ['reading'] })).toEqual(['notes/ex/reading.compilation.yml']);
    expect(await paths({ status: 'archived' })).toEqual(['notes/ex/deep/plan.compilation.yml']);
    expect(await paths({ folders: ['notes/ex/deep'] })).toEqual(['notes/ex/deep/plan.compilation.yml']);
    expect(await paths({ q: 'Title plan', match: 'title' })).toEqual(['notes/ex/deep/plan.compilation.yml']);
    expect(await paths({ q: 'arrangement: nope' })).toEqual(['notes/ex/broken.compilation.yml']);
  });

  it('counts compilations apart from notes in the facets', async () => {
    const facets = (await noteFacets(await catalogOf(githubFixture(files)), false)).notebooks.ex;
    expect(facets).toMatchObject({ total: 2, tags: { clue: 1 }, directories: { 'notes/ex': 1, 'notes/ex/work': 1 } });
    expect(facets.compilations).toEqual({ total: 3, statuses: { working: 1, '': 2 }, tags: { reading: 1, x: 1 } });
    expect((await noteFacets(await catalogOf(githubFixture(files)), true)).notebooks.ex.compilations.total).toBe(4);
  });

  it('leaves the agenda and the graph to notes', async () => {
    const catalog = await catalogOf(githubFixture(files));
    expect((await noteAgenda(catalog, 'ex', true)).dated.every(note => note.kind !== 'compilation')).toBe(true);
    const graph = await noteGraph(catalog);
    expect(graph.nodes.map(node => node.path).sort()).toEqual(['notes/ex/a.md', 'notes/ex/work/b.md', 'notes/other/z.md']);
  });

  it('looks compilations up by path with their YAML as content', async () => {
    const catalog = await catalogOf(githubFixture(files));
    const { notes } = await lookupNotes(catalog, [{ notebookId: 'ex', path: 'notes/ex/reading.compilation.yml' }], true);
    expect(notes).toHaveLength(1);
    expect(YAML.parse(notes[0].content!)).toMatchObject({ id: 'reading', arrangement: 'lane' });
  });

  it('reports a file that cannot open instead of dropping it', async () => {
    const catalog = await catalogOf(githubFixture(files));
    const page = await queryNotes(catalog, query({ kind: 'compilation' }), options);
    expect(page.notes.find(note => note.path === 'notes/ex/broken.compilation.yml')).toMatchObject({ title: 'Broken', tags: ['x'], invalid: expect.stringContaining('arrangement') });
    expect(page.notes.find(note => note.path === 'notes/ex/outside.compilation.yml')?.invalid).toContain('outside the notebook notes/ex');
  });

  it('reports a duplicate id on both files, across notebooks of one repository', async () => {
    const catalog = await catalogOf(githubFixture(files));
    const first = (await queryNotes(catalog, query({ kind: 'compilation' }), options)).notes.find(note => note.path === 'notes/ex/reading.compilation.yml');
    const second = (await queryNotes(catalog, query({ kind: 'compilation', notebookId: 'other' }), options)).notes.find(note => note.path === 'notes/other/dup.compilation.yml');
    expect(first?.invalid).toBe('Duplicate compilation id "reading" also used by notes/other/dup.compilation.yml');
    expect(second?.invalid).toBe('Duplicate compilation id "reading" also used by notes/ex/reading.compilation.yml');
  });

  it('opens a compilation by path and saves it through the note pipeline', async () => {
    const f = githubFixture(files);
    const reader = f.reader();
    const note = await reader.note('notes/ex/reading.compilation.yml');
    expect(note).toMatchObject({ kind: 'compilation', title: 'Title reading', tags: ['reading'], status: 'working' });
    expect(note.invalid).toBeUndefined();
    await expect(reader.note('notes/ex/index.html')).rejects.toMatchObject({ status: 403 });
    // A tag edit made through the note actions reaches the YAML.
    const saved = await reader.save('notes/ex/reading.compilation.yml', note.content, { ...note.metadata, tags: ['reading', 'done'] }, f.head());
    expect(saved.note).toMatchObject({ kind: 'compilation', tags: ['reading', 'done'] });
    expect(YAML.parse(f.text('notes/ex/reading.compilation.yml')!)).toMatchObject({ tags: ['reading', 'done'], status: 'working', items: [{ id: 'i1' }] });
    // Creating and committing drafts takes the same paths as a note.
    const created = compilation('fresh', 'tags: [new]\n');
    await f.reader().commitNotes([{ path: 'notes/ex/fresh.compilation.yml', content: created, metadata: { tags: ['new'] }, createOnly: true }], f.head(), 'docs(notes): add fresh');
    expect(YAML.parse(f.text('notes/ex/fresh.compilation.yml')!)).toMatchObject({ id: 'fresh', tags: ['new'] });
    await expect(f.reader().commitNotes([{ path: 'notes/ex/fresh.compilation.yml', content: created, metadata: {}, createOnly: true }], f.head(), 'again')).rejects.toMatchObject({ status: 409 });
    await expect(f.reader().commitNotes([{ path: 'notes/nowhere/x.compilation.yml', content: created, metadata: {}, createOnly: true }], f.head(), 'escape')).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a stale head when saving a compilation, as for a note', async () => {
    const f = githubFixture(files);
    const note = await f.reader().note('notes/ex/reading.compilation.yml');
    await expect(f.reader().save('notes/ex/reading.compilation.yml', note.content, note.metadata, 'stale')).rejects.toMatchObject({ status: 409 });
  });

  it('keeps compilations out of the note list that MCP reads', async () => {
    const reader = githubFixture(files).reader();
    const config = await reader.config();
    expect((await reader.notes('ex')).map(note => note.path).sort()).toEqual(['notes/ex/a.md', 'notes/ex/work/b.md']);
    expect((await reader.notePaths(config.notebooks[0])).sort()).toEqual(['notes/ex/a.md', 'notes/ex/work/b.md']);
  });
});

describe('compilations in a local worktree', () => {
  let root: string;
  const notebook: NotebookConfig = { id: 'ex', title: 'Example', root: 'notes/ex' };
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'compilations-'));
    write('notes/ex/a.md', '# A\n');
    write('notes/ex/sub/q.compilation.yml', compilation('q', 'tags: [t]\nstatus: todo\n'));
    write('notes/ex/bad.compilation.yml', 'items: {');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('scans compilations as entries on request and keeps the note scan to notes', () => {
    expect(scanNotebookNotes(root, notebook).map(note => note.path)).toEqual(['notes/ex/a.md']);
    const entries = scanNotebookEntries(root, notebook);
    expect(entries.map(note => note.path).sort()).toEqual(['notes/ex/a.md', 'notes/ex/bad.compilation.yml', 'notes/ex/sub/q.compilation.yml']);
    expect(entries.find(note => note.path.endsWith('q.compilation.yml'))).toMatchObject({ kind: 'compilation', id: 'q', title: 'Title q', tags: ['t'], status: 'todo' });
    expect(entries.find(note => note.path.endsWith('bad.compilation.yml'))).toMatchObject({ kind: 'compilation', title: 'bad', invalid: expect.stringContaining('YAML') });
    expect(entries.find(note => note.path === 'notes/ex/a.md')).not.toHaveProperty('kind');
  });

  it('reads a compilation with its YAML as content and writes it with the caller tags and status', () => {
    const note = readNoteFile(root, 'notes/ex/sub/q.compilation.yml', 'ex', 'notes/ex');
    expect(YAML.parse(note.content).id).toBe('q');
    const saved = writeNoteFile(root, 'notes/ex/sub/q.compilation.yml', note.content, { ...note.metadata, tags: ['t', 'u'], status: undefined }, 'ex', 'notes/ex');
    expect(saved).toMatchObject({ kind: 'compilation', tags: ['t', 'u'] });
    expect(saved.status).toBeUndefined();
    const stored = YAML.parse(fs.readFileSync(path.join(root, 'notes/ex/sub/q.compilation.yml'), 'utf8'));
    expect(stored).toMatchObject({ tags: ['t', 'u'], items: [{ id: 'i1' }] });
    expect(stored).not.toHaveProperty('status');
    expect(fs.readFileSync(path.join(root, 'notes/ex/sub/q.compilation.yml'), 'utf8')).not.toContain('created');
  });

  it('writes a new compilation without stamping note timestamps', () => {
    const saved = writeNoteFile(root, 'notes/ex/new.compilation.yml', compilation('new'), { tags: [] }, 'ex', 'notes/ex');
    expect(saved).toMatchObject({ kind: 'compilation', id: 'new' });
    expect(saved.metadata).not.toHaveProperty('created');
  });

  it('classifies the file as a compilation inside a notebook only', () => {
    const config = { schema_version: 3, workspace: { title: 'W', default_notebook: 'ex' }, notebooks: [notebook] };
    expect(classifyResource('notes/ex/sub/q.compilation.yml', config)).toEqual({ path: 'notes/ex/sub/q.compilation.yml', type: 'compilation', notebookId: 'ex' });
    expect(classifyResource('elsewhere/q.compilation.yml', config).type).not.toBe('compilation');
  });
});
