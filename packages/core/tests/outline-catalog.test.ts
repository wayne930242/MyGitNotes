import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyResource } from '../src/classifier.js';
import { parseNoteFile, serializeNoteFile } from '../src/note-file.js';
import { DEFAULT_NOTE_QUERY, entryKind } from '../src/note-query.js';
import { lookupNotes, noteAgenda, noteFacets, noteGraph, parseNoteQuery, queryNotes, workspaceCatalog } from '../src/note-catalog.js';
import { readNoteFile, scanNotebookEntries, scanNotebookNotes, writeNoteFile } from '../src/note-service.js';
import { githubFixture } from './fixtures/github.js';
import { gitlabFixture } from './fixtures/gitlab.js';
import { openRemoteHome } from '../src/remote-factory.js';

vi.setConfig({ testTimeout: 30000 });

const notebook = { id: 'ex', title: 'Example', root: 'notes/ex' };
const manifest = 'schema_version: 3\nworkspace: {title: QA, default_notebook: ex}\nnotebooks:\n  - {id: ex, title: Example, root: notes/ex}\n';
const outlinePath = 'notes/ex/Research plan.outline.md';
const body = '- Research **plan**\n  Annotation\n  - Read [note](a.md) and [reference](https://example.com/)\n- [ ] Experiment 📅 2026-10-05\n';
const files = { '.github-notes.yaml': manifest, 'notes/ex/a.md': '# A\n', [outlinePath]: `---\ntitle: Research\nid: duplicate\ntags: [research]\nstatus: working\n---\n${body}`, 'notes/ex/one.compilation.yml': 'version: 1\nid: duplicate\ntitle: One\narrangement: lane\nitems: []\n', 'notes/ex/two.compilation.yml': 'version: 1\nid: duplicate\ntitle: Two\narrangement: lane\nitems: []\n' };
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function catalogOf(f: ReturnType<typeof githubFixture>) {
  const reader = f.reader();
  const config = await reader.config();
  return workspaceCatalog(config, [{ id: reader.id, notebooks: config.notebooks, catalog: reader.catalog() }]);
}

describe('native outline kind', () => {
  it('derives classification only from the suffix, including unconfigured discovery', () => {
    expect(classifyResource(outlinePath).type).toBe('outline');
    expect(classifyResource(outlinePath, { schema_version: 3, workspace: { title: 'QA', default_notebook: 'ex' }, notebooks: [notebook] })).toMatchObject({ type: 'outline', notebookId: 'ex' });
    expect(classifyResource('elsewhere/a.outline.md', { schema_version: 3, workspace: { title: 'QA', default_notebook: 'ex' }, notebooks: [notebook] }).type).toBe('product_source');
    expect(entryKind({ path: outlinePath })).toBe('outline');
    expect(parseNoteFile('---\ntype: outline\n---\n- text\n', 'ordinary.md').extra).toEqual({});
    expect(parseNoteQuery({ notebookId: 'ex', kind: 'outline' }).query.kind).toBe('outline');
  });

  it.each(['- 研究\n  Annotation\n', '- 研究\r\n  Annotation\r\n', '---\ninvalid: [\n---\n- source\n'])('preserves ordinary Markdown source on read: %j', source => {
    const parsed = parseNoteFile(source, 'notes/ex/研究.v2.outline.md');
    expect(parsed).toMatchObject({ title: '研究.v2', content: source, extra: { kind: 'outline' } });
    expect(parseNoteFile(source, 'notes/ex/研究.v2.md').extra).toEqual({});
  });

  it('keeps normal frontmatter and title precedence without adding a type flag', () => {
    const parsed = parseNoteFile(files[outlinePath], outlinePath);
    expect(parsed).toMatchObject({ title: 'Research', content: body, metadata: { tags: ['research'] }, extra: { kind: 'outline' } });
    expect(parseNoteFile('# Heading\n- item\n', outlinePath).title).toBe('Heading');
    const saved = serializeNoteFile(outlinePath, parsed.metadata, body, false, new Date('2026-10-05T00:00:00Z'), files[outlinePath]);
    expect(parseNoteFile(saved, outlinePath).content).toBe(body);
    expect(parseNoteFile(saved, outlinePath).metadata).not.toHaveProperty('type');
  });

  it('keeps a new empty marker and source indentation through outline saves without changing ordinary-note trimming', () => {
    const now = new Date('2026-10-05T00:00:00Z');
    const raw = serializeNoteFile(outlinePath, { title: 'Blank' }, '- ', true, now);
    expect(parseNoteFile(raw, outlinePath).content).toBe('- \n');
    const content = '  - Indented\r\n    annotation  \r\n  - \r\n';
    const saved = serializeNoteFile(outlinePath, { title: 'Blank' }, content, false, now, raw);
    expect(parseNoteFile(saved, outlinePath).content).toBe(content);
    const edited = content + '- Next\r\n';
    const again = serializeNoteFile(outlinePath, { title: 'Blank' }, edited, false, now, saved);
    expect(parseNoteFile(again, outlinePath).content).toBe(edited);
    expect(parseNoteFile(serializeNoteFile('ordinary.md', {}, '- ', true, now), 'ordinary.md').content).toBe('-\n');
  });

  it('separates queries/facets and compilation IDs while retaining graph, agenda and lookup', async () => {
    const catalog = await catalogOf(githubFixture(files));
    const query = { ...DEFAULT_NOTE_QUERY, notebookId: 'ex' };
    const options = { limit: 50, content: true };
    const outlines = await queryNotes(catalog, { ...query, kind: 'outline' }, options);
    expect(outlines.notes).toHaveLength(1);
    expect(outlines.notes[0]).toMatchObject({ path: outlinePath, kind: 'outline', content: body });
    expect(outlines.notes[0].invalid).toBeUndefined();
    expect((await queryNotes(catalog, query, options)).notes.every(note => !note.kind)).toBe(true);
    expect((await queryNotes(catalog, { ...query, kind: 'all' }, options)).notes).toHaveLength(5);
    const facets = (await noteFacets(catalog, false)).notebooks.ex;
    expect(facets).toMatchObject({ total: 2, compilations: { total: 2 }, outlines: { total: 1, tags: { research: 1 }, statuses: { working: 1 } } });
    expect(facets.tags).not.toHaveProperty('research');
    expect((await lookupNotes(catalog, [{ notebookId: 'ex', path: outlinePath }], true)).notes[0].kind).toBe('outline');
    expect((await noteGraph(catalog)).nodes.some(note => note.path === outlinePath)).toBe(true);
    expect((await noteAgenda(catalog, 'ex', false)).tasks.some(task => task.notePath === outlinePath)).toBe(true);
  });

  it('creates, reads, edits tags/status and rejects collisions/stale GitHub saves', async () => {
    const f = githubFixture(files);
    const target = 'notes/ex/new.outline.md';
    await f.reader().commitNotes([{ path: target, content: body, metadata: { title: 'New', tags: ['t'] }, createOnly: true }], f.head(), 'Add outline');
    const note = await f.reader().note(target);
    expect(note).toMatchObject({ kind: 'outline', title: 'New' });
    expect(note.content.trimStart()).toBe(body);
    const saved = await f.reader().save(target, body, { ...note.metadata, tags: ['updated'], status: 'done' }, f.head());
    expect(saved.note).toMatchObject({ kind: 'outline', tags: ['updated'], status: 'done' });
    await expect(f.reader().save(target, body, {}, 'stale')).rejects.toMatchObject({ status: 409 });
    await expect(f.reader().commitNotes([{ path: target, content: body, metadata: {}, createOnly: true }], f.head(), 'Again')).rejects.toMatchObject({ status: 409 });
  });

  it('uses the native GitLab catalog and one guarded commit for each outline save', async () => {
    const f = gitlabFixture();
    const reader = () => openRemoteHome({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'fixture-token', f.request).reader;
    const target = 'notes/ex/new.outline.md';
    await reader().commitNotes([{ path: target, content: body, metadata: { title: 'GitLab', tags: ['research'] }, createOnly: true }], f.head, 'Add outline');
    expect(f.writes).toBe(1);
    const note = await reader().note(target);
    expect(note).toMatchObject({ kind: 'outline', title: 'GitLab' });
    expect(note.content.trimStart()).toBe(body);
    const r = reader();
    const config = await r.config();
    const catalog = await workspaceCatalog(config, [{ id: r.id, notebooks: config.notebooks, catalog: r.catalog() }]);
    expect((await queryNotes(catalog, { ...DEFAULT_NOTE_QUERY, notebookId: 'ex', kind: 'outline' }, { limit: 50, content: false })).notes.map(item => item.path)).toEqual([target]);
    expect((await noteFacets(catalog, false)).notebooks.ex.outlines.total).toBe(1);
    expect((await r.notes('ex')).some(item => item.path === target)).toBe(false);
    await reader().save(target, note.content, { ...note.metadata, status: 'done' }, f.head);
    expect(f.writes).toBe(2);
    await expect(reader().save(target, body, {}, 'stale')).rejects.toMatchObject({ status: 409 });
    await expect(reader().commitNotes([{ path: target, content: body, metadata: {}, createOnly: true }], f.head, 'Again')).rejects.toMatchObject({ status: 409 });
    expect(f.writes).toBe(2);
    f.readOnly();
    await expect(reader().save(target, body, {}, f.head)).rejects.toMatchObject({ status: 403 });
    expect(f.writes).toBe(2);
  });

  it('scans local native entries without expanding default ordinary-note listings', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outline-kind-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, notebook.root), { recursive: true });
    writeNoteFile(root, 'notes/ex/a.md', '# A\n', {}, 'ex', notebook.root);
    const saved = writeNoteFile(root, outlinePath, body, { title: 'Local', tags: ['t'] }, 'ex', notebook.root);
    expect(saved).toMatchObject({ kind: 'outline' });
    expect(saved.content.trimStart()).toBe(body);
    expect(scanNotebookNotes(root, notebook).map(note => note.path)).toEqual(['notes/ex/a.md']);
    expect(scanNotebookEntries(root, notebook).find(note => note.path === outlinePath)?.kind).toBe('outline');
    expect(readNoteFile(root, outlinePath, 'ex', notebook.root).content).toBe(saved.content);
    const renamed = 'notes/ex/plain.md';
    fs.renameSync(path.join(root, outlinePath), path.join(root, renamed));
    expect(readNoteFile(root, renamed, 'ex', notebook.root).kind).toBeUndefined();
    expect(readNoteFile(root, renamed, 'ex', notebook.root).content).toBe(saved.content);
  });
});
