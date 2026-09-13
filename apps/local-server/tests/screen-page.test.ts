import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { SCREEN_PAGE_FILE } from '@github-notes/core';

let root: string, server: Server, url: string;
const page = { version: 1, rows: [{ id: 'row', kind: 'custom', name: '閱讀', view: 'small', items: [
  { id: 'one', kind: 'note', notebookId: 'a', path: 'notes/a/guide.md' },
  { id: 'two', kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 0 },
] }] };
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'screen-yaml-'));
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'pipe' });
  await writeFile(path.join(root, '.github-notes.yaml'), 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n');
  for (const [key, value] of Object.entries({ GITHUB_NOTES_SOURCE: 'local', GITHUB_NOTES_LOCAL_PATH: root, VERCEL: '', APP_URL: '' })) vi.stubEnv(key, value);
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as {port: number}).port}/api/screen-page`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const put = (value: unknown, revision = 'missing') => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: value, revision }) });

it('persists a cross-notebook YAML layout and rejects stale writes', async () => {
  expect(await fetch(url).then(r => r.json())).toMatchObject({ page: { version: 1, rows: [] }, writable: true, revision: 'missing' });
  const saved = await put(page); expect(saved.status).toBe(200);
  const record = await saved.json(); expect(record.page).toEqual(page);
  expect(await readFile(path.join(root, SCREEN_PAGE_FILE), 'utf8')).toContain('name: 閱讀');
  expect((await put({ version: 1, rows: [] })).status).toBe(409);
  expect(await fetch(url).then(r => r.json())).toMatchObject({ page, revision: record.revision });
  const competing = await Promise.all(['first', 'second'].map(name => put({ ...page, rows: [{ ...page.rows[0], name }] }, record.revision)));
  expect(competing.map(response => response.status).sort()).toEqual([200, 409]);
  // Configuration participates in the existing Git review interface.
  const diff = await fetch(url.replace('/screen-page', `/git/diff?path=${SCREEN_PAGE_FILE}`));
  expect(diff.status).toBe(200);
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
