import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { applyLocalFilePlan, localFileSnapshot } from '../src/file-manager.js';
import { assetHash, planFileChange } from '@mygitnotes/core';
let root: string, server: Server, base: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
const write = (file: string, content: string | Buffer) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-files-'));
  vi.stubEnv('MYGITNOTES_SOURCE', 'local');
  vi.stubEnv('MYGITNOTES_LOCAL_PATH', root);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_URL', '');
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n  - id: b\n    title: B\n    root: notes/b\n');
  write('notes/a/one/note.md', '# Note\n');
  write('notes/a/two/_dir.yml', 'title: Two\n');
  write('notes/a/.hidden.json', '{"a":1}\n');
  write('notes/b/other.md', '# Other');
  write('notes/a/one/image.png', Buffer.from([137, 80, 78, 71, 0, 255]));
  git('add', '.');
  git('commit', '-m', 'fixture');
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
const list = () => fetch(base + '/api/files?notebookId=a').then(r => r.json());
const post = async (command: Record<string, unknown>, revision?: string) => fetch(base + '/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: { notebookId: 'a', ...command }, revision: revision || (await list()).revision }) });

it('lists notebook files including hidden entries, reads raw text, creates and saves empty files', async () => {
  const listing = await list();
  expect(listing.entries.some((e: any) => e.path === 'notes/a/.hidden.json' && e.hidden)).toBe(true);
  expect(listing.entries.some((e: any) => e.path.startsWith('notes/b'))).toBe(false);
  expect((await post({ kind: 'create', path: 'notes/a/new.json' })).status).toBe(200);
  expect(fs.statSync(path.join(root, 'notes/a/new.json')).size).toBe(0);
  expect((await post({ kind: 'write', path: 'notes/a/new.json', content: '{"saved":true}\r\n' })).status).toBe(200);
  const read = await fetch(base + '/api/files/read?notebookId=a&path=notes/a/new.json').then(r => r.json());
  expect(read.content).toBe('{"saved":true}\r\n');
  expect(git('log', '--format=%s').toString().trim()).toBe('fixture');
});
it('moves binary files with a directory, preserves hash URLs, uploads and deletes', async () => {
  const original = fs.readFileSync(path.join(root, 'notes/a/one/image.png'));
  expect((await post({ kind: 'move', path: 'notes/a/one', destination: 'notes/a/two/one' })).status).toBe(200);
  const response = await fetch(base + '/raw-assets/by-hash/' + assetHash(original));
  expect(Buffer.from(await response.arrayBuffer())).toEqual(original);
  expect(response.headers.get('content-security-policy')).toContain('sandbox');
  expect((await post({ kind: 'upload', path: 'notes/a/upload.bin', base64: original.toString('base64') })).status).toBe(200);
  expect(fs.readFileSync(path.join(root, 'notes/a/upload.bin'))).toEqual(original);
  expect((await post({ kind: 'delete', path: 'notes/a/upload.bin' })).status).toBe(200);
  expect(fs.existsSync(path.join(root, 'notes/a/upload.bin'))).toBe(false);
});
it('rejects stale revisions, cross-notebook paths, symlinks, overwrite and read-only writes', async () => {
  const before = await list();
  write('notes/a/newer.txt', 'new');
  expect((await post({ kind: 'write', path: 'notes/a/.hidden.json', content: 'old' }, before.revision)).status).toBe(409);
  expect(fs.readFileSync(path.join(root, 'notes/a/.hidden.json'), 'utf8')).toContain('"a":1');
  expect((await post({ kind: 'create', path: 'notes/b/new.txt' })).status).toBe(400);
  expect((await post({ kind: 'create', path: 'notes/a/.hidden.json' })).status).toBe(400);
  fs.symlinkSync(path.join(root, 'notes/b'), path.join(root, 'notes/a/link'));
  expect((await post({ kind: 'create', path: 'notes/a/link/new.txt' })).status).toBe(400);
  expect((await fetch(base + '/api/files/read?notebookId=a&path=notes/b/other.md')).status).toBe(403);
  git('checkout', '-b', 'core');
  expect((await list()).writable).toBe(false);
  expect((await post({ kind: 'create', path: 'notes/a/no.txt' })).status).toBe(403);
});
it('restores the original binary and text snapshot after a write fails', () => {
  const before = localFileSnapshot(root), after = planFileChange(before, { kind: 'move', notebookId: 'a', path: 'notes/a/one', destination: 'notes/a/two/one' });
  const rename = fs.renameSync.bind(fs);
  let calls = 0;
  vi.spyOn(fs, 'renameSync').mockImplementation((...args) => {
    if (++calls === 2) throw new Error('Injected failure');
    return rename(...args);
  });
  expect(() => applyLocalFilePlan(root, before, after)).toThrow('Injected failure');
  expect(localFileSnapshot(root)).toEqual(before);
});
it('browses large binary files without loading their contents and reports the read limit separately', async () => {
  write('notes/a/large.bin', Buffer.alloc(6 * 1024 * 1024));
  const listing = await list();
  expect(listing.entries.find((entry: any) => entry.path === 'notes/a/large.bin').size).toBe(6 * 1024 * 1024);
  const assets = await fetch(base + '/api/assets?notebookId=a');
  expect(assets.status).toBe(200);
  expect((await assets.json()).assets.find((entry: any) => entry.path === 'notes/a/large.bin').size).toBe(6 * 1024 * 1024);
  expect((await fetch(base + '/api/files/read?notebookId=a&path=notes/a/large.bin')).status).toBe(413);
  expect((await post({ kind: 'write', path: 'notes/a/.hidden.json', content: '{"saved":true}\n' })).status).toBe(200);
  expect(fs.statSync(path.join(root, 'notes/a/large.bin')).size).toBe(6 * 1024 * 1024);
  expect((await post({ kind: 'move', path: 'notes/a/one/note.md', destination: 'notes/a/two/note.md' })).status).toBe(200);
  expect(fs.statSync(path.join(root, 'notes/a/large.bin')).size).toBe(6 * 1024 * 1024);
});
it('includes hidden files in the normal Git review and commit flow', async () => {
  await post({ kind: 'write', path: 'notes/a/.hidden.json', content: '{"a":2}\n' });
  const response = await fetch(base + '/api/git/diff?path=notes/a/.hidden.json');
  expect(response.status).toBe(200);
  expect((await response.json()).diff).toContain('"a":2');
  const { changes } = await fetch(base + '/api/git/changes').then(r => r.json());
  const change = changes.find((entry: any) => entry.path === 'notes/a/.hidden.json');
  expect(change.available).toBe(true);
  const committed = await fetch(base + '/api/git/commit-staged', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selected: true, files: [change.path], revisions: { [change.path]: change.revision }, message: 'Update hidden file' }) });
  expect(committed.status).toBe(200);
  expect(git('show', 'HEAD:notes/a/.hidden.json').toString()).toContain('"a":2');
});
