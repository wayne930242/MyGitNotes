import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, Server } from 'node:http';
import { createApp } from '../src/app.js';
import { deriveAlias, notebookKey } from '@mygitnotes/core';

let root: string;
/** The key of a home-repository notebook; a local worktree's alias is its directory's name. */
const nb = (id: string) => notebookKey(deriveAlias(root, new Set()), id);
let server: Server;
let base: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-query-'));
  vi.stubEnv('GITHUB_NOTES_SOURCE', 'local');
  vi.stubEnv('GITHUB_NOTES_LOCAL_PATH', root);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_URL', '');
  vi.stubEnv('SESSION_SECRET', 's'.repeat(64));
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  write('notes/.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n  - id: other\n    title: Other\n    root: notes/other\n');
  write('notes/example/alpha.md', '---\ntags: [work]\nstatus: inbox\nupdated: 2026-09-02\n---\n# Alpha\n\n- [ ] ship 📅 2026-09-20\n');
  write('notes/example/deep/beta.md', '---\ntags: [work, deep]\nstatus: done\nupdated: 2026-09-03\n---\n# Beta\n\n[Alpha](../alpha.md)\n');
  write('notes/example/hidden.md', '---\nhiden: true\nupdated: 2026-09-04\n---\n# Hidden\n');
  write('notes/other/gamma.md', '---\nupdated: 2026-09-01\n---\n# Gamma\n\nkeyword in the body\n');
  git('add', '.');
  git('commit', '-m', 'fixture');
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (root) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const json = async (url: string, init?: RequestInit) => {
  const response = await fetch(`${base}${url}`, init);
  return { status: response.status, body: await response.json() as any };
};

describe('note query routes', () => {
  it('pages a notebook and continues with its cursor', async () => {
    const first = await json(`/api/notes/query?notebookId=${nb('example')}&limit=1`);
    expect(first.body.total).toBe(2);
    expect(first.body.notes.map((note: any) => note.path)).toEqual(['notes/example/deep/beta.md']);
    expect(first.body.notes[0].content).toBeUndefined();
    const second = await json(`/api/notes/query?notebookId=${nb('example')}&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    expect(second.body.notes.map((note: any) => note.path)).toEqual(['notes/example/alpha.md']);
    expect(second.body.nextCursor).toBeNull();
    expect((await json(`/api/notes/query?notebookId=${nb('other')}&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`)).status).toBe(400);
  });

  it('applies filters, search, content and path selection', async () => {
    expect((await json(`/api/notes/query?notebookId=${nb('example')}&showHidden=1`)).body.total).toBe(3);
    expect((await json(`/api/notes/query?notebookId=${nb('example')}&tag=deep`)).body.notes.map((note: any) => note.path)).toEqual(['notes/example/deep/beta.md']);
    expect((await json(`/api/notes/query?notebookId=${nb('example')}&folder=notes/example&descendants=0`)).body.notes.map((note: any) => note.path)).toEqual(['notes/example/alpha.md']);
    expect((await json('/api/notes/query?notebookId=all&q=keyword')).body.notes.map((note: any) => note.path)).toEqual(['notes/other/gamma.md']);
    expect((await json('/api/notes/query?notebookId=all&q=keyword&match=title')).body.total).toBe(0);
    expect((await json(`/api/notes/query?notebookId=${nb('other')}&content=1`)).body.notes[0].content).toContain('keyword in the body');
    expect((await json(`/api/notes/query?notebookId=${nb('example')}&select=paths&sort=title&order=asc`)).body.notes).toEqual([{ notebookId: nb('example'), path: 'notes/example/alpha.md' }, { notebookId: nb('example'), path: 'notes/example/deep/beta.md' }]);
    expect((await json(`/api/notes/query?notebookId=${nb('other')}&noStatus=1`)).body.notes.map((note: any) => note.path)).toEqual(['notes/other/gamma.md']);
    expect((await json(`/api/notes/query?notebookId=${nb('example')}&noStatus=1`)).body.total).toBe(0);
    expect((await json('/api/notes/query?limit=1')).status).toBe(400);
  });

  it('serves facets, lookup, agenda and graph', async () => {
    const facets = (await json('/api/notes/facets')).body;
    expect(facets.notebooks[nb('example')]).toMatchObject({ total: 2, hidden: 1, statuses: { inbox: 1, done: 1 }, tags: { work: 2, deep: 1 } });
    expect(facets.notebooks[nb('example')].directories).toEqual({ 'notes/example': 1, 'notes/example/deep': 1 });

    const lookup = await json('/api/notes/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: [{ notebookId: nb('example'), path: 'notes/example/alpha.md' }, { notebookId: nb('example'), path: 'notes/example/absent.md' }], content: true }) });
    expect(lookup.body.notes.map((note: any) => note.path)).toEqual(['notes/example/alpha.md']);
    expect(lookup.body.notes[0].content).toContain('# Alpha');

    const agenda = (await json(`/api/notes/agenda?notebookId=${nb('example')}`)).body;
    expect(agenda.tasks).toHaveLength(1);
    expect(agenda.tasks[0]).toMatchObject({ notePath: 'notes/example/alpha.md', due: '2026-09-20', checked: false });
    expect(agenda.dated.map((note: any) => note.path)).toContain('notes/example/alpha.md');
    expect((await json('/api/notes/agenda')).status).toBe(400);

    const graph = (await json('/api/notes/graph')).body;
    expect(graph.links).toEqual([{ source: `${nb('example')}:notes/example/deep/beta.md`, target: `${nb('example')}:notes/example/alpha.md` }]);
    expect(graph.nodes.map((node: any) => node.id)).toContain(`${nb('example')}:notes/example/hidden.md`);
  });
});

describe('outlines over native local note routes', () => {
  const send = (method: string, url: string, body?: unknown) => json(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  it('creates, edits, queries, copies, deletes and restores an outline without changing ordinary-note counts', async () => {
    const file = 'notes/example/plan.outline.md';
    const content = '- Plan\n  Annotation\n  - Read [Alpha](alpha.md)\n';
    const head = git('rev-parse', 'HEAD').toString().trim();
    const created = await send('POST', '/api/notes', { path: file, content, metadata: { title: 'Plan', tags: ['outline'], status: 'working' }, notebookId: nb('example'), createOnly: true, noCommit: true });
    expect(created.status).toBe(200);
    expect(created.body.note).toMatchObject({ kind: 'outline', title: 'Plan', tags: ['outline'], status: 'working' });
    expect(git('rev-parse', 'HEAD').toString().trim()).toBe(head);
    expect((await json(`/api/notes/query?notebookId=${nb('example')}`)).body.total).toBe(2);
    expect((await json(`/api/notes/query?notebookId=${nb('example')}&kind=outline&tag=outline&status=working`)).body.total).toBe(1);
    expect((await json('/api/notes/facets')).body.notebooks[nb('example')]).toMatchObject({ total: 2, outlines: { total: 1, tags: { outline: 1 }, statuses: { working: 1 } } });
    expect((await send('POST', '/api/notes', { path: file, content, metadata: {}, notebookId: nb('example'), createOnly: true })).status).toBe(409);
    const changed = await send('POST', '/api/notes', { path: file, content, metadata: { title: 'Renamed title', tags: ['changed'], status: 'done' }, notebookId: nb('example'), noCommit: true });
    expect(changed.body.note).toMatchObject({ path: file, kind: 'outline', title: 'Renamed title', tags: ['changed'], status: 'done' });
    const copy = 'notes/example/copy.outline.md';
    expect((await send('POST', '/api/notes', { path: copy, content, metadata: { title: 'Copy' }, notebookId: nb('example'), createOnly: true, noCommit: true })).status).toBe(200);
    expect((await json(`/api/notes/read?notebookId=${nb('example')}&path=${copy}`)).body.note.kind).toBe('outline');
    const before = fs.readFileSync(path.join(root, file), 'utf8');
    git('add', file, copy);
    git('commit', '-m', 'Outline fixture');
    expect((await send('DELETE', `/api/notes?path=${file}&notebookId=${nb('example')}&noCommit=true`)).status).toBe(200);
    expect((await json(`/api/notes/query?notebookId=${nb('example')}&kind=outline`)).body.total).toBe(1);
    expect((await send('POST', '/api/notes/restore', { path: file, notebookId: nb('example') })).status).toBe(200);
    expect(fs.readFileSync(path.join(root, file), 'utf8')).toBe(before);
    expect((await json(`/api/notes/read?notebookId=${nb('example')}&path=${file}`)).body.note.kind).toBe('outline');
    expect(fs.existsSync(path.join(root, '.mygitnotes-bookmarks.yaml'))).toBe(false);
  });
});

describe('compilations over the note routes', () => {
  const compilation = (id: string, extra = '') => `version: 1\nid: ${id}\ntitle: Title ${id}\narrangement: lane\n${extra}items:\n  - { id: i1, kind: note, path: notes/example/alpha.md }\n`;
  const send = (method: string, url: string, body?: unknown) => json(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  it('lists compilations apart from notes and counts them in the facets', async () => {
    write('notes/example/reading.compilation.yml', compilation('reading', 'tags: [clue]\nstatus: working\n'));
    write('notes/example/deep/broken.compilation.yml', 'version: 1\nid: broken\ntitle: Broken\narrangement: nope\nitems: []\n');
    git('add', '.');
    git('commit', '-m', 'compilations');
    expect((await json(`/api/notes/query?notebookId=${nb('example')}`)).body.notes.every((note: any) => note.kind === undefined)).toBe(true);
    const listed = (await json(`/api/notes/query?notebookId=${nb('example')}&kind=compilation`)).body;
    expect(listed.notes.map((note: any) => [note.path, note.kind, note.invalid ? 'invalid' : 'ok']).sort()).toEqual([['notes/example/deep/broken.compilation.yml', 'compilation', 'invalid'], ['notes/example/reading.compilation.yml', 'compilation', 'ok']]);
    expect(listed.notes.find((note: any) => note.path.endsWith('reading.compilation.yml'))).toMatchObject({ title: 'Title reading', tags: ['clue'], status: 'working' });
    expect((await json(`/api/notes/query?notebookId=${nb('example')}&kind=compilation&tag=clue`)).body.notes.map((note: any) => note.path)).toEqual(['notes/example/reading.compilation.yml']);
    expect((await json(`/api/notes/query?notebookId=${nb('example')}&kind=all&select=paths`)).body.total).toBe(4);
    expect((await json(`/api/notes/query?notebookId=${nb('example')}&kind=folder`)).status).toBe(400);
    const facets = (await json('/api/notes/facets')).body.notebooks[nb('example')];
    expect(facets.total).toBe(2);
    expect(facets.compilations).toEqual({ total: 2, statuses: { working: 1, '': 1 }, tags: { clue: 1 } });
    expect((await json('/api/notes/graph')).body.nodes.map((node: any) => node.id).some((id: string) => id.includes('compilation'))).toBe(false);
    expect((await json(`/api/notes/agenda?notebookId=${nb('example')}`)).body.dated.some((note: any) => note.path.includes('compilation'))).toBe(false);
  });

  it('creates, copies and deletes a compilation through the note routes', async () => {
    const file = 'notes/example/fresh.compilation.yml';
    const created = await send('POST', '/api/notes', { path: file, content: compilation('fresh'), metadata: { tags: ['new'] }, notebookId: nb('example'), createOnly: true, commitMessage: 'docs(notes): add fresh' });
    expect(created.body.error ?? '').toBe('');
    expect(created.status).toBe(200);
    expect(created.body.note).toMatchObject({ kind: 'compilation', id: 'fresh', tags: ['new'] });
    expect(fs.readFileSync(path.join(root, 'notes/example/fresh.compilation.yml'), 'utf8')).toContain('tags:\n  - new');
    expect((await send('POST', '/api/notes', { path: file, content: compilation('fresh'), metadata: {}, notebookId: nb('example'), createOnly: true })).status).toBe(409);
    const copyPath = 'notes/example/fresh-copy.compilation.yml';
    const copy = await send('POST', '/api/notes', { path: copyPath, content: compilation('fresh-copy'), metadata: {}, notebookId: nb('example'), createOnly: true });
    expect(copy.status).toBe(200);
    const read = (await json(`/api/notes/read?path=${copyPath}&notebookId=${nb('example')}`)).body.note;
    expect(read).toMatchObject({ kind: 'compilation', title: 'Title fresh-copy' });
    expect((await json(`/api/notes/query?notebookId=${nb('example')}&kind=compilation`)).body.total).toBe(2);
    expect((await send('DELETE', `/api/notes?path=${copyPath}&notebookId=${nb('example')}`)).status).toBe(200);
    expect(fs.existsSync(path.join(root, copyPath))).toBe(false);
    expect((await json(`/api/notes/query?notebookId=${nb('example')}&kind=compilation`)).body.total).toBe(1);
  });

  it('saves a compilation that does not parse and reports it as invalid instead of hiding it', async () => {
    const saved = await send('POST', '/api/notes', { path: 'notes/example/bad.compilation.yml', content: 'version: 1\nitems: {', metadata: {}, notebookId: nb('example'), createOnly: true });
    expect(saved.status).toBe(200);
    expect(saved.body.note).toMatchObject({ kind: 'compilation', invalid: expect.stringContaining('YAML') });
    const listed = (await json(`/api/notes/query?notebookId=${nb('example')}&kind=compilation`)).body.notes;
    expect(listed.find((note: any) => note.path.endsWith('bad.compilation.yml'))?.invalid).toContain('YAML');
  });
});
