import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { BOOKMARKS_FILE, type BookmarksPage, repositoryRef, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';

let roots: string[], server: Server, base: string, repository: string;
const page = (id: string) => ({ version: 1, notebooks: [{ notebookId: id, groups: [{ id: 'empty', label: 'Empty group' }], bookmarks: [{ id: 'note', label: 'Note', groupId: null, target: { kind: 'note', path: 'missing.md' } }, { id: 'folder', label: 'Folder', groupId: null, target: { kind: 'folder', path: 'old' } }] }, { notebookId: 'unknown', groups: [], bookmarks: [{ id: 'unknown', label: 'Preserve me', groupId: null, target: { kind: 'url', url: 'https://example.test/' } }] }] });
const request = () => ({ repository, notebookId: 'a', selectedIds: ['note', 'folder'], path: 'notes/shared/imported.outline.md', title: 'Imported' });
const raw = (id: string) => '# exact CRLF source\r\n' + JSON.stringify(page(id), null, 2).replaceAll('\n', '\r\n') + '\r\n';
const post = (endpoint: string, body: unknown) => fetch(base + '/api/outline-import' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const preview = () =>
  post('/preview', request()).then(async response => {
    expect(response.status).toBe(200);
    return response.json();
  });
const apply = (token: string, extra = {}) => post('', { ...request(), token, acknowledgePartial: true, ...extra });
const write = (root: string, file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const manifest = 'schema_version: 3\nworkspace:\n  title: Import\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/shared\n  - id: b\n    title: B\n    root: notes/shared\n    source: { type: github, repository: owner/other }\n';

beforeEach(async () => {
  roots = ['a', 'b'].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'outline-import-')));
  for (const [index, root] of roots.entries()) {
    execFileSync('git', ['init', '-b', 'main', root], { stdio: 'pipe' });
    write(root, 'notes/shared/note.md', '# Note\n');
    write(root, BOOKMARKS_FILE, raw(index ? 'b' : 'a'));
  }
  write(roots[0], '.mygitnotes.yaml', manifest);
  const home = repositoryRef({ type: 'local', path: roots[0] });
  repository = home.id;
  const configSource: WorkspaceConfigSource = { mode: 'local', settings: async () => ({ home, localPath: ref => ref.id === 'github:owner/other@main' ? roots[1] : undefined, manifest: inHome => inHome() }) };
  vi.stubEnv('APP_URL', '');
  vi.stubEnv('VERCEL', '');
  server = createServer(createApp(roots[0], configSource));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('previews without writes, exports exact source, requires partial acknowledgement, creates once without a commit or source loss', async () => {
  const before = roots.map(root => fs.readFileSync(path.join(root, BOOKMARKS_FILE)));
  const record = await preview();
  expect(record).toMatchObject({ persistence: 'worktree', partial: true, convertedIds: ['note'], writable: true });
  expect(record.retained.map((item: { reason: string; }) => item.reason)).toEqual(['folder', 'other-owner']);
  expect(fs.existsSync(path.join(roots[0], request().path))).toBe(false);
  const exported = await fetch(base + '/api/outline-import/source?repository=' + encodeURIComponent(repository)).then(r => r.json());
  expect(Buffer.from(exported.base64, 'base64')).toEqual(before[0]);
  expect((await apply(record.token, { acknowledgePartial: false })).status).toBe(400);
  expect(fs.existsSync(path.join(roots[0], request().path))).toBe(false);
  const response = await apply(record.token);
  expect(response.status).toBe(200);
  expect(fs.readFileSync(path.join(roots[0], request().path), 'utf8')).toBe(record.markdown);
  expect((await apply(record.token)).status).toBe(409);
  expect(fs.existsSync(path.join(roots[1], request().path))).toBe(false);
  expect(roots.map(root => fs.readFileSync(path.join(root, BOOKMARKS_FILE)))).toEqual(before);
  expect(execFileSync('git', ['rev-list', '--all', '--count'], { cwd: roots[0], encoding: 'utf8' }).trim()).toBe('0');
});
it('imports the named non-home same-root repository only and rejects mismatched or missing identities', async () => {
  for (const input of [{ ...request(), repository: undefined }, { ...request(), notebookId: 'b' }, { ...request(), selectedIds: ['unknown'] }]) expect((await post('/preview', input)).status).toBeGreaterThanOrEqual(400);
  const input = { ...request(), repository: 'github:owner/other@main', notebookId: 'b' };
  const record = await post('/preview', input).then(r => r.json());
  expect((await post('', { ...input, token: record.token, acknowledgePartial: true })).status).toBe(200);
  expect(fs.existsSync(path.join(roots[1], input.path))).toBe(true);
  expect(fs.existsSync(path.join(roots[0], input.path))).toBe(false);
});
it.each(['source', 'config', 'destination', 'permission'])('rejects stale %s with no overwrite and no original-byte loss', async change => {
  const record = await preview();
  if (change === 'source') write(roots[0], BOOKMARKS_FILE, raw('a') + '# changed\r\n');
  if (change === 'config') write(roots[0], '.mygitnotes.yaml', manifest.replace('title: A', 'title: Changed'));
  if (change === 'destination') write(roots[0], request().path, 'keep existing');
  if (change === 'permission') execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/core'], { cwd: roots[0] });
  const before = fs.readFileSync(path.join(roots[0], BOOKMARKS_FILE));
  expect((await apply(record.token)).status).toBe(change === 'permission' ? 403 : 409);
  expect(fs.readFileSync(path.join(roots[0], BOOKMARKS_FILE))).toEqual(before);
  expect(fs.existsSync(path.join(roots[0], request().path))).toBe(change === 'destination');
});
it('allows read-only preview and refuses unsupported-only selections without creating an outline', async () => {
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/core'], { cwd: roots[0] });
  expect((await preview()).writable).toBe(false);
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: roots[0] });
  const input = { ...request(), selectedIds: ['folder'] };
  const record = await post('/preview', input).then(r => r.json());
  expect(record.markdown).toBeNull();
  expect((await post('', { ...input, token: record.token, acknowledgePartial: true })).status).toBe(422);
  expect(fs.existsSync(path.join(roots[0], input.path))).toBe(false);
});
it.each(['version: 99\nnotebooks: []\n', 'broken: [', Buffer.from([0xff, 0xfe])])('exports malformed/unknown-version bytes while refusing import', async malformed => {
  fs.writeFileSync(path.join(roots[0], BOOKMARKS_FILE), malformed);
  const result = await fetch(base + '/api/outline-import/source?repository=' + encodeURIComponent(repository)).then(r => r.json());
  expect(Buffer.from(result.base64, 'base64')).toEqual(Buffer.from(malformed));
  expect(result.page).toBeNull();
  expect(result.error).toBeTruthy();
  expect((await post('/preview', request())).status).toBe(422);
});
it('rejects symlink source, destination ancestors and protected destination paths', async () => {
  fs.symlinkSync(roots[1], path.join(roots[0], 'notes/shared/alias'));
  for (const destination of ['notes/shared/alias/import.outline.md', 'notes/shared/.private/import.outline.md', 'notes/shared/../../escape.outline.md']) expect((await post('/preview', { ...request(), path: destination })).status).toBeGreaterThanOrEqual(400);
  fs.unlinkSync(path.join(roots[0], BOOKMARKS_FILE));
  fs.symlinkSync(path.join(roots[1], BOOKMARKS_FILE), path.join(roots[0], BOOKMARKS_FILE));
  expect((await post('/preview', request())).status).toBe(403);
});
it('exclusive publication refuses a racing destination and cleans temporary files after a write fault', async () => {
  const record = await preview(), original = fs.linkSync;
  vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
    fs.writeFileSync(to, 'external racing writer', { flag: 'wx' });
    original(from, to);
  });
  expect((await apply(record.token)).status).toBe(409);
  expect(fs.readFileSync(path.join(roots[0], request().path), 'utf8')).toBe('external racing writer');
  expect(fs.readdirSync(path.join(roots[0], 'notes/shared')).some(file => file.endsWith('.tmp'))).toBe(false);
  vi.restoreAllMocks();
  fs.unlinkSync(path.join(roots[0], request().path));
  vi.spyOn(fs, 'linkSync').mockImplementation(() => {
    throw new Error('Injected publication failure');
  });
  expect((await apply(record.token)).status).toBe(500);
  expect(fs.existsSync(path.join(roots[0], request().path))).toBe(false);
  expect(fs.readFileSync(path.join(roots[0], BOOKMARKS_FILE), 'utf8')).toBe(raw('a'));
  expect(fs.readdirSync(path.join(roots[0], 'notes/shared')).some(file => file.endsWith('.tmp'))).toBe(false);
});
it('reports unsupported entries exactly rather than canonicalizing labels or query sets', async () => {
  const saved: BookmarksPage = { version: 1, notebooks: [{ notebookId: 'a', groups: [], bookmarks: [{ id: 'note', label: 'Note', groupId: null, target: { kind: 'note', path: 'missing.md' } }, { id: 'view', label: '  Original label  ', groupId: null, target: { kind: 'query', query: { q: 'exact', kind: 'note', tags: ['z', 'a', 'z'], folders: ['two', 'one'], descendants: true, tagMode: 'any', status: null, showHidden: false, neighbors: false, view: 'list', sort: { field: 'title', order: 'asc' } } } }] }] };
  const original = JSON.stringify(saved);
  write(roots[0], BOOKMARKS_FILE, original);
  const input = { ...request(), selectedIds: ['note', 'view'] };
  const record = await post('/preview', input).then(r => r.json());
  expect(record.retained[0].entry).toEqual(saved.notebooks[0].bookmarks[1]);
  expect((await post('', { ...input, token: record.token, acknowledgePartial: true })).status).toBe(200);
  expect(fs.readFileSync(path.join(roots[0], BOOKMARKS_FILE), 'utf8')).toBe(original);
});
it('missing and oversized source cannot create metadata or an output file', async () => {
  fs.unlinkSync(path.join(roots[0], BOOKMARKS_FILE));
  const missing = await fetch(base + '/api/outline-import/source?repository=' + encodeURIComponent(repository)).then(r => r.json());
  expect(missing).toMatchObject({ base64: null, page: null, revision: 'missing' });
  expect((await post('/preview', request())).status).toBe(404);
  expect(fs.existsSync(path.join(roots[0], BOOKMARKS_FILE))).toBe(false);
  fs.writeFileSync(path.join(roots[0], BOOKMARKS_FILE), Buffer.alloc(1024 * 1024 + 1));
  expect((await post('/preview', request())).status).toBe(413);
  expect(fs.existsSync(path.join(roots[0], request().path))).toBe(false);
});
it('serializes simultaneous applies so exactly one create succeeds', async () => {
  const record = await preview();
  expect((await Promise.all([apply(record.token), apply(record.token)])).map(r => r.status).sort()).toEqual([200, 409]);
});
