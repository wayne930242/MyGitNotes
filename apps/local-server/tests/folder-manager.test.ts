import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { applyLocalFolderPlan, localFolderSnapshot } from '../src/folder-manager.js';
import { planFolderChange } from '@mygitnotes/core';

let root: string, server: Server, base: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-folder-'));
  vi.stubEnv('GITHUB_NOTES_SOURCE', 'local');
  vi.stubEnv('GITHUB_NOTES_LOCAL_PATH', root);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_URL', '');
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  fs.mkdirSync(path.join(root, 'notes/a/one/child'), { recursive: true });
  fs.mkdirSync(path.join(root, 'notes/a/two'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github-notes.yaml'), 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n');
  fs.writeFileSync(path.join(root, 'notes/a/one/note.md'), '# Keep me\n');
  fs.writeFileSync(path.join(root, 'notes/a/two/_dir.yml'), 'title: Two\n');
  git('add', '.');
  git('commit', '-m', 'fixture');
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const getRevision = () => fetch(`${base}/api/folder-manager`).then(r => r.json()).then(data => data.revision);
const post = async (command: unknown, revision?: string) => fetch(`${base}/api/folder-manager`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, revision: revision || await getRevision() }) });

it('creates, nests, reorders and removes folders without deleting notes or staging unrelated work', async () => {
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'Unrelated');
  git('add', 'unrelated.txt');
  expect((await post({ kind: 'create', notebookId: 'a', parent: '', name: 'new', title: 'New' })).status).toBe(200);
  expect((await post({ kind: 'move', notebookId: 'a', path: 'one', parent: 'two' })).status).toBe(200);
  expect(fs.readFileSync(path.join(root, 'notes/a/two/one/note.md'), 'utf8')).toBe('# Keep me\n');
  expect((await post({ kind: 'delete', notebookId: 'a', path: 'two/one', destination: '' })).status).toBe(200);
  expect(fs.readFileSync(path.join(root, 'notes/a/note.md'), 'utf8')).toBe('# Keep me\n');
  expect(fs.existsSync(path.join(root, 'notes/a/child'))).toBe(true);
  expect(git('diff', '--cached', '--name-only').toString().trim()).toBe('unrelated.txt');
});
it('rejects stale revisions, collisions, protected descendants and non-main writes', async () => {
  const revision = await getRevision();
  fs.writeFileSync(path.join(root, 'notes/a/one/note.md'), 'Newer content');
  const command = { kind: 'delete', notebookId: 'a', path: 'one', destination: '' };
  expect((await post(command, revision)).status).toBe(409);
  fs.writeFileSync(path.join(root, 'notes/a/note.md'), 'Destination');
  expect((await post(command)).ok).toBe(false);
  expect(fs.readFileSync(path.join(root, 'notes/a/note.md'), 'utf8')).toBe('Destination');
  fs.symlinkSync(path.join(root, 'notes/a/two'), path.join(root, 'notes/a/one/link'));
  expect((await post({ kind: 'move', notebookId: 'a', path: 'one', parent: 'two' })).ok).toBe(false);
  git('checkout', '-b', 'core');
  expect((await post({ kind: 'create', notebookId: 'a', parent: '', name: 'forbidden' })).status).toBe(403);
});
it('rolls back completed writes when a later write fails', () => {
  const before = localFolderSnapshot(root);
  const after = planFolderChange(before, { kind: 'move', notebookId: 'a', path: 'one', parent: 'two' });
  const rename = fs.renameSync.bind(fs);
  let calls = 0;
  vi.spyOn(fs, 'renameSync').mockImplementation((...args) => {
    if (++calls === 2) throw new Error('Injected disk failure');
    return rename(...args);
  });
  expect(() => applyLocalFolderPlan(root, before, after)).toThrow('Injected disk failure');
  expect(localFolderSnapshot(root)).toEqual(before);
});

it.each(['', 'two'])('moving contents on deletion preserves destination metadata and nested metadata: %s', async destination => {
  const target = path.join(root, 'notes/a', destination);
  fs.writeFileSync(path.join(target, '_dir.yml'), 'title: Destination\ncustom: preserve exactly\n');
  fs.writeFileSync(path.join(root, 'notes/a/one/_dir.yml'), 'title: Deleted folder\norder: 99\n');
  fs.writeFileSync(path.join(root, 'notes/a/one/child/_dir.yml'), 'title: Child\ncustom: keep child\n');
  const response = await post({ kind: 'delete', notebookId: 'a', path: 'one', destination });
  expect(response.status).toBe(200);
  expect(fs.existsSync(path.join(root, 'notes/a/one'))).toBe(false);
  expect(fs.readFileSync(path.join(target, '_dir.yml'), 'utf8')).toBe('title: Destination\ncustom: preserve exactly\n');
  expect(fs.readFileSync(path.join(target, 'child/_dir.yml'), 'utf8')).toBe('title: Child\ncustom: keep child\n');
  expect(fs.readFileSync(path.join(target, 'note.md'), 'utf8')).toBe('# Keep me\n');
});
