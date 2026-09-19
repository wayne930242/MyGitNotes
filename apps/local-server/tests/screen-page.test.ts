import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { SCREEN_PAGE_FILE } from '@mygitnotes/core';

let root: string, server: Server, url: string;
const page = { version: 2, rows: [{ id: 'row', kind: 'custom', name: '閱讀', view: 'small', notebookId: 'a', items: [{ id: 'one', kind: 'note', notebookId: 'a', path: 'notes/a/guide.md' }, { id: 'two', kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 0 }] }] };
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'screen-yaml-'));
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'pipe' });
  await writeFile(path.join(root, '.github-notes.yaml'), 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n  - id: b\n    title: B\n    root: notes/b\n');
  for (const [key, value] of Object.entries({ GITHUB_NOTES_SOURCE: 'local', GITHUB_NOTES_LOCAL_PATH: root, VERCEL: '', APP_URL: '' })) vi.stubEnv(key, value);
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number; }).port}/api/screen-page`;
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const put = (value: unknown, revision = 'missing') => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: value, revision }) });

it('persists a notebook-owned YAML layout and rejects stale writes', async () => {
  expect(await fetch(url).then(r => r.json())).toMatchObject({ page: { version: 2, rows: [] }, writable: true, revision: 'missing' });
  const saved = await put(page);
  expect(saved.status).toBe(200);
  const record = await saved.json();
  expect(record.page).toEqual(page);
  expect(await readFile(path.join(root, SCREEN_PAGE_FILE), 'utf8')).toContain('name: 閱讀');
  expect((await put({ version: 2, rows: [] })).status).toBe(409);
  expect(await fetch(url).then(r => r.json())).toMatchObject({ page, revision: record.revision });
  const competing = await Promise.all(['first', 'second'].map(name => put({ ...page, rows: [{ ...page.rows[0], name }] }, record.revision)));
  expect(competing.map(response => response.status).sort()).toEqual([200, 409]);
  // Configuration participates in the existing Git review interface.
  const diff = await fetch(url.replace('/screen-page', `/git/diff?path=${SCREEN_PAGE_FILE}`));
  expect(diff.status).toBe(200);
  expect((await diff.json()).diff).toContain(`+++ ${SCREEN_PAGE_FILE}`);
});
it('migrates a version 1 layout on read and rejects lanes holding another notebook', async () => {
  const legacy = 'version: 1\nrows:\n  - id: row\n    name: Mixed\n    view: small\n    kind: custom\n    items:\n      - { id: one, kind: note, notebookId: a, path: notes/a/one.md }\n      - { id: two, kind: note, notebookId: b, path: notes/b/two.md }\n';
  await writeFile(path.join(root, SCREEN_PAGE_FILE), legacy);
  const record = await fetch(url).then(r => r.json());
  expect(record.page.rows.map((row: { id: string; notebookId: string; items: { id: string; }[]; }) => [row.id, row.notebookId, row.items.map(item => item.id)])).toEqual([['row', 'a', ['one']], ['row-b', 'b', ['two']]]);
  expect(await readFile(path.join(root, SCREEN_PAGE_FILE), 'utf8')).toBe(legacy);
  const foreign = { version: 2, rows: [{ ...page.rows[0], items: [{ id: 'x', kind: 'note', notebookId: 'b', path: 'notes/b/x.md' }] }] };
  expect((await put(foreign, record.revision)).status).toBe(400);
  expect((await put(record.page, record.revision)).status).toBe(200);
  expect(await readFile(path.join(root, SCREEN_PAGE_FILE), 'utf8')).toContain('version: 2');
});
it('protects Core, rejects symlink targets and reports invalid YAML without replacing it', async () => {
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/core'], { cwd: root });
  expect((await put(page)).status).toBe(403);
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: root });
  await symlink('.github-notes.yaml', path.join(root, SCREEN_PAGE_FILE));
  expect((await fetch(url)).status).toBe(403);
  expect((await put(page)).status).toBe(403);
  await rm(path.join(root, SCREEN_PAGE_FILE));
  await writeFile(path.join(root, SCREEN_PAGE_FILE), 'version: nope\n');
  expect((await fetch(url)).status).toBe(422);
  expect(await readFile(path.join(root, SCREEN_PAGE_FILE), 'utf8')).toBe('version: nope\n');
});
