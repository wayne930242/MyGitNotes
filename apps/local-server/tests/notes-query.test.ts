import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, Server } from 'node:http';
import { createApp } from '../src/app.js';

let root: string; let server: Server; let base: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-query-'));
  vi.stubEnv('GITHUB_NOTES_SOURCE', 'local'); vi.stubEnv('GITHUB_NOTES_LOCAL_PATH', root); vi.stubEnv('VERCEL', ''); vi.stubEnv('APP_URL', '');
  vi.stubEnv('SESSION_SECRET', 's'.repeat(64)); vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  write('notes/.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n  - id: other\n    title: Other\n    root: notes/other\n');
  write('notes/example/alpha.md', '---\ntags: [work]\nstatus: inbox\nupdated: 2026-09-02\n---\n# Alpha\n\n- [ ] ship 📅 2026-09-20\n');
  write('notes/example/deep/beta.md', '---\ntags: [work, deep]\nstatus: done\nupdated: 2026-09-03\n---\n# Beta\n\n[Alpha](../alpha.md)\n');
  write('notes/example/hidden.md', '---\nhiden: true\nupdated: 2026-09-04\n---\n# Hidden\n');
  write('notes/other/gamma.md', '---\nupdated: 2026-09-01\n---\n# Gamma\n\nkeyword in the body\n');
  git('add', '.'); git('commit', '-m', 'fixture');
  server = createServer(createApp(root)); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });

const json = async (url: string, init?: RequestInit) => {
  const response = await fetch(`${base}${url}`, init);
  return { status: response.status, body: await response.json() as any };
};

describe('note query routes', () => {
  it('pages a notebook and continues with its cursor', async () => {
    const first = await json('/api/notes/query?notebookId=example&limit=1');
    expect(first.body.total).toBe(2);
    expect(first.body.notes.map((note: any) => note.path)).toEqual(['notes/example/deep/beta.md']);
    expect(first.body.notes[0].content).toBeUndefined();
    const second = await json(`/api/notes/query?notebookId=example&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    expect(second.body.notes.map((note: any) => note.path)).toEqual(['notes/example/alpha.md']);
    expect(second.body.nextCursor).toBeNull();
    expect((await json(`/api/notes/query?notebookId=other&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`)).status).toBe(400);
  });

  it('applies filters, search, content and path selection', async () => {
    expect((await json('/api/notes/query?notebookId=example&showHidden=1')).body.total).toBe(3);
    expect((await json('/api/notes/query?notebookId=example&tag=deep')).body.notes.map((note: any) => note.path)).toEqual(['notes/example/deep/beta.md']);
    expect((await json('/api/notes/query?notebookId=example&folder=notes/example&descendants=0')).body.notes.map((note: any) => note.path)).toEqual(['notes/example/alpha.md']);
    expect((await json('/api/notes/query?notebookId=all&q=keyword')).body.notes.map((note: any) => note.path)).toEqual(['notes/other/gamma.md']);
    expect((await json('/api/notes/query?notebookId=all&q=keyword&match=title')).body.total).toBe(0);
    expect((await json('/api/notes/query?notebookId=other&content=1')).body.notes[0].content).toContain('keyword in the body');
    expect((await json('/api/notes/query?notebookId=example&select=paths&sort=title&order=asc')).body.paths).toEqual(['notes/example/alpha.md', 'notes/example/deep/beta.md']);
    expect((await json('/api/notes/query?notebookId=other&noStatus=1')).body.notes.map((note: any) => note.path)).toEqual(['notes/other/gamma.md']);
    expect((await json('/api/notes/query?notebookId=example&noStatus=1')).body.total).toBe(0);
    expect((await json('/api/notes/query?limit=1')).status).toBe(400);
  });

  it('serves facets, lookup, agenda and graph', async () => {
    const facets = (await json('/api/notes/facets')).body;
    expect(facets.notebooks.example).toMatchObject({ total: 2, hidden: 1, statuses: { inbox: 1, done: 1 }, tags: { work: 2, deep: 1 } });
    expect(facets.notebooks.example.directories).toEqual({ 'notes/example': 1, 'notes/example/deep': 1 });

    const lookup = await json('/api/notes/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: ['notes/example/alpha.md', 'notes/example/absent.md'], content: true }) });
    expect(lookup.body.notes.map((note: any) => note.path)).toEqual(['notes/example/alpha.md']);
    expect(lookup.body.notes[0].content).toContain('# Alpha');

    const agenda = (await json('/api/notes/agenda?notebookId=example')).body;
    expect(agenda.tasks).toHaveLength(1);
    expect(agenda.tasks[0]).toMatchObject({ notePath: 'notes/example/alpha.md', due: '2026-09-20', checked: false });
    expect(agenda.dated.map((note: any) => note.path)).toContain('notes/example/alpha.md');
    expect((await json('/api/notes/agenda')).status).toBe(400);

    const graph = (await json('/api/notes/graph')).body;
    expect(graph.links).toEqual([{ source: 'notes/example/deep/beta.md', target: 'notes/example/alpha.md' }]);
    expect(graph.nodes.map((node: any) => node.id)).toContain('notes/example/hidden.md');
  });
});
