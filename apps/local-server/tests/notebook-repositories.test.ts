import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { repositoryRef, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';

/** A worktree on main with the given files committed. */
function worktree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-notebook-repos-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  git('add', '.');
  git('commit', '-m', 'fixture');
  return root;
}

const manifest = `schema_version: 2
workspace:
  title: Two repositories
  default_notebook: life
notebooks:
  - id: life
    title: Life
    root: notes/life
  - id: trpg
    title: TRPG
    root: notes/life
    source: { type: github, repository: owner/trpg }
  - id: lost
    title: Lost
    root: notes/lost
    source: { type: github, repository: owner/lost }
`;

let roots: string[] = [];
let server: Server;
let base: string;
beforeEach(() => {
  vi.stubEnv('APP_URL', '');
  vi.stubEnv('VERCEL', '');
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  roots = [];
  vi.unstubAllEnvs();
});

async function serve() {
  const home = worktree({ '.mygitnotes.yaml': manifest, 'notes/life/note.md': '# Home note\n' });
  const trpg = worktree({ 'notes/life/note.md': '# TRPG note\n' });
  roots = [home, trpg];
  const configSource: WorkspaceConfigSource = { mode: 'local', settings: async () => ({ home: repositoryRef({ type: 'local', path: home }), localPath: ref => ref.id === 'github:owner/trpg@main' ? trpg : undefined, manifest: inHomeRepository => inHomeRepository() }) };
  server = createServer(createApp(home, configSource));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
  return { home, trpg };
}
const get = (url: string) => fetch(`${base}${url}`).then(async response => ({ status: response.status, body: await response.json() }));

describe('notebooks in their own local repositories', () => {
  it('lists each repository, reports an unmapped one and keeps same-path notes apart', async () => {
    await serve();
    const workspace = (await get('/api/workspace')).body;
    expect(workspace.repositories.map((repository: { id: string; notebooks: string[]; }) => [repository.notebooks, repository.id.startsWith('local:') ? 'home' : repository.id])).toEqual([[['life'], 'home'], [['trpg'], 'github:owner/trpg@main'], [['lost'], 'github:owner/lost@main']]);
    expect(workspace.repositories[1]).toMatchObject({ repository: 'owner/trpg', branch: 'main', write: true });
    expect(workspace.repositories[2]).toMatchObject({ write: false, unavailable: { reason: 'unmapped' } });
    expect((await get('/api/notes/read?path=notes/life/note.md&notebookId=life')).body.note.content).toContain('Home note');
    expect((await get('/api/notes/read?path=notes/life/note.md&notebookId=trpg')).body.note.content).toContain('TRPG note');
    expect((await get('/api/notes/read?path=notes/life/note.md')).status).toBe(400);
    const lost = await get('/api/notes/read?path=notes/lost/note.md&notebookId=lost');
    expect(lost.status).toBe(503);
    expect(lost.body.error).toMatch(/^Lost: No worktree is mapped/);
    const all = (await get('/api/notes/query?notebookId=all&limit=10')).body;
    expect(all.notes.map((note: { notebookId: string; path: string; }) => `${note.notebookId}:${note.path}`).sort()).toEqual(['life:notes/life/note.md', 'trpg:notes/life/note.md']);
  });

  it('writes and commits a note in its notebook repository only', async () => {
    const { home, trpg } = await serve();
    const saved = await fetch(`${base}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId: 'trpg', path: 'notes/life/new.md', content: '# New', metadata: { title: 'New' }, commitMessage: 'docs: add new' }) });
    expect(saved.status).toBe(200);
    expect(fs.existsSync(path.join(trpg, 'notes/life/new.md'))).toBe(true);
    expect(fs.existsSync(path.join(home, 'notes/life/new.md'))).toBe(false);
    expect(execFileSync('git', ['log', '--format=%s', '-1'], { cwd: trpg, encoding: 'utf8' }).trim()).toBe('docs: add new');
    expect(execFileSync('git', ['log', '--format=%s', '-1'], { cwd: home, encoding: 'utf8' }).trim()).toBe('fixture');
  });
});

describe('workspace documents in notebook repositories', () => {
  it('reads and writes Screen in the repository a request names, the home repository by default', async () => {
    const { home, trpg } = await serve();
    const trpgId = 'github:owner/trpg@main';
    const empty = (await get(`/api/screen-page?repository=${encodeURIComponent(trpgId)}`)).body;
    expect(empty).toMatchObject({ repository: trpgId, page: { version: 2, rows: [] }, writable: true });
    const page = { version: 2, rows: [{ id: 'lane', notebookId: 'trpg', kind: 'custom', name: 'Campaign', view: 'small', items: [] }] };
    const saved = await fetch(`${base}/api/screen-page`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page, revision: empty.revision, repository: trpgId }) });
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(path.join(trpg, '.github-notes-screen.yaml'), 'utf8')).toContain('Campaign');
    expect(fs.existsSync(path.join(home, '.github-notes-screen.yaml'))).toBe(false);
    expect((await get('/api/screen-page')).body).toMatchObject({ page: { rows: [] } });
    expect((await get('/api/study?repository=github%3Aowner%2Flost%40main')).status).toBe(503);
  });
});

describe('Git changes in each worktree', () => {
  it('lists changes by repository and commits each worktree on its own', async () => {
    const { home, trpg } = await serve();
    fs.writeFileSync(path.join(home, 'notes/life/note.md'), '# Home changed\n');
    fs.writeFileSync(path.join(trpg, 'notes/life/note.md'), '# TRPG changed\n');
    const { changes } = (await get('/api/git/changes')).body;
    const trpgId = 'github:owner/trpg@main';
    expect(changes.map((change: { repository: string; path: string; }) => [change.repository.startsWith('local:') ? 'home' : change.repository, change.path]).sort()).toEqual([[trpgId, 'notes/life/note.md'], ['home', 'notes/life/note.md']]);
    const trpgChange = changes.find((change: { repository: string; }) => change.repository === trpgId);
    const diff = (await get(`/api/git/file-diff?path=notes/life/note.md&side=working&repository=${encodeURIComponent(trpgId)}`)).body.diff;
    expect(diff).toContain('TRPG changed');
    const committed = await fetch(`${base}/api/git/commit-staged`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository: trpgId, files: ['notes/life/note.md'], revisions: { 'notes/life/note.md': trpgChange.revision }, message: 'docs: trpg only', selected: true }) });
    expect(committed.status).toBe(200);
    expect(execFileSync('git', ['log', '--format=%s', '-1'], { cwd: trpg, encoding: 'utf8' }).trim()).toBe('docs: trpg only');
    expect(execFileSync('git', ['status', '--short'], { cwd: home, encoding: 'utf8' })).toContain('notes/life/note.md');
    const sync = await fetch(`${base}/api/git/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository: trpgId }) });
    expect(sync.status).toBe(409);
  });
});
