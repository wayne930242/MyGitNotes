import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { FOCUS_PAGE_FILE } from '@mygitnotes/core';

let root: string, server: Server, base: string, url: string;
const page = { version: 1, focuses: [{ id: 'weekly', notebookId: 'a', name: '週報', division: 'major-left', panes: [
  { tabs: [{ kind: 'note', path: 'notes/a/guide.md' }] }, { tabs: [{ kind: 'lane', id: 'row' }] }, { tabs: [] },
] }] };
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'focus-yaml-'));
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'pipe' });
  await writeFile(path.join(root, '.github-notes.yaml'), 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n  - id: b\n    title: B\n    root: notes/b\n');
  for (const [key, value] of Object.entries({ GITHUB_NOTES_SOURCE: 'local', GITHUB_NOTES_LOCAL_PATH: root, VERCEL: '', APP_URL: '' })) vi.stubEnv(key, value);
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as {port: number}).port}/api`;
  url = `${base}/focus-page`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const put = (value: unknown, revision = 'missing') => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: value, revision }) });

it('persists named Focus YAML, rejects stale or invalid writes and joins Git review', async () => {
  expect(await fetch(url).then(r => r.json())).toMatchObject({ page: { version: 1, focuses: [] }, writable: true, revision: 'missing', path: FOCUS_PAGE_FILE });
  const saved = await put(page); expect(saved.status).toBe(200);
  const record = await saved.json(); expect(record.page).toEqual(page);
  expect(await readFile(path.join(root, FOCUS_PAGE_FILE), 'utf8')).toContain('name: 週報');
  expect((await put({ version: 1, focuses: [] })).status).toBe(409);
  const duplicate = { ...page, focuses: [page.focuses[0], { ...page.focuses[0], id: 'copy' }] };
  expect((await put(duplicate, record.revision)).status).toBe(400);
  const mismatched = { ...page, focuses: [{ ...page.focuses[0], division: 'single' }] };
  expect((await put(mismatched, record.revision)).status).toBe(400);
  const competing = await Promise.all(['first', 'second'].map(name => put({ ...page, focuses: [{ ...page.focuses[0], name }] }, record.revision)));
  expect(competing.map(response => response.status).sort()).toEqual([200, 409]);
  const diff = await fetch(`${base}/git/diff?path=${FOCUS_PAGE_FILE}`);
  expect(diff.status).toBe(200);
  expect((await diff.json()).diff).toContain(`+++ ${FOCUS_PAGE_FILE}`);
  const changes = await fetch(`${base}/git/changes`).then(r => r.json());
  expect(changes.changes).toContainEqual(expect.objectContaining({ path: FOCUS_PAGE_FILE, available: true }));
});
it('protects Core, rejects symlink targets and reports invalid YAML without replacing it', async () => {
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/core'], { cwd: root });
  expect((await put(page)).status).toBe(403);
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: root });
  await symlink('.github-notes.yaml', path.join(root, FOCUS_PAGE_FILE));
  expect((await fetch(url)).status).toBe(403);
  expect((await put(page)).status).toBe(403);
  await rm(path.join(root, FOCUS_PAGE_FILE));
  await writeFile(path.join(root, FOCUS_PAGE_FILE), 'version: nope\n');
  expect((await fetch(url)).status).toBe(422);
  expect(await readFile(path.join(root, FOCUS_PAGE_FILE), 'utf8')).toBe('version: nope\n');
});
it('rewrites Focus tabs when the file manager moves a note', async () => {
  await mkdir(path.join(root, 'notes/a/one'), { recursive: true });
  await writeFile(path.join(root, 'notes/a/guide.md'), '# Guide\n');
  execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
  expect((await put(page)).status).toBe(200);
  const { revision } = await fetch(`${base}/files?notebookId=a`).then(r => r.json());
  const moved = await fetch(`${base}/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, command: { kind: 'move', notebookId: 'a', path: 'notes/a/guide.md', destination: 'notes/a/one/guide.md' } }) });
  expect(moved.status).toBe(200);
  const stored = await fetch(url).then(r => r.json());
  expect(stored.page.focuses[0].panes[0].tabs).toEqual([{ kind: 'note', path: 'notes/a/one/guide.md' }]);
});
it('rejects tabs outside the Focus notebook and hides them in a stored file', async () => {
  await writeFile(path.join(root, '.github-notes-screen.yaml'), 'version: 2\nrows:\n  - id: other-row\n    notebookId: b\n    kind: custom\n    name: B\n    view: small\n    items: []\n');
  const outside = (tab: unknown) => ({ version: 1, focuses: [{ id: 'f', notebookId: 'a', name: 'F', division: 'single', panes: [{ tabs: [tab] }] }] });
  expect((await put(outside({ kind: 'note', path: 'notes/b/outside.md' }))).status).toBe(400);
  expect((await put(outside({ kind: 'lane', id: 'other-row' }))).status).toBe(400);
  expect(await readFile(path.join(root, FOCUS_PAGE_FILE), 'utf8').catch(() => null)).toBeNull();
  expect((await put(outside({ kind: 'note', path: 'notes/a/inside.md' }))).status).toBe(200);
  await writeFile(path.join(root, FOCUS_PAGE_FILE), 'version: 1\nfocuses:\n  - id: f\n    notebookId: a\n    name: F\n    division: single\n    panes:\n      - tabs:\n          - kind: note\n            path: notes/a/inside.md\n          - kind: note\n            path: notes/b/outside.md\n');
  const stored = await fetch(url).then(r => r.json());
  expect(stored.page.focuses[0].panes[0].tabs).toEqual([{ kind: 'note', path: 'notes/a/inside.md' }]);
  expect((await put(stored.page, stored.revision)).status).toBe(200);
});
