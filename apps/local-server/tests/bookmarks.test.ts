import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { BOOKMARKS_FILE, captureTextAnchor } from '@mygitnotes/core';
import { revisionOf } from '../src/workspace-files.js';
let root: string, server: Server, base: string;
const page = { version: 1, notebooks: [{ notebookId: 'a', groups: [], bookmarks: [{ id: 'guide', label: 'Guide', groupId: null, target: { kind: 'note', path: 'guide.md' } }] }] };
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'bookmarks-'));
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'pipe' });
  await writeFile(path.join(root, '.github-notes.yaml'), 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n');
  await mkdir(path.join(root, 'notes/a/one'), { recursive: true });
  await writeFile(path.join(root, 'notes/a/guide.md'), '# Guide\n\nParagraph.');
  for (const [key, value] of Object.entries({ GITHUB_NOTES_SOURCE: 'local', GITHUB_NOTES_LOCAL_PATH: root, VERCEL: '', APP_URL: '' })) vi.stubEnv(key, value);
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}/api`;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (root) await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const put = (value: unknown, revision = 'missing') => fetch(`${base}/bookmarks`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: value, revision }) });
const resolveTargets = (targets: unknown[]) => fetch(`${base}/bookmarks/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId: 'a', targets }) });
it('reads empty without creating files, round trips and rejects concurrent writes', async () => {
  expect(await fetch(`${base}/bookmarks`).then(r => r.json())).toMatchObject({ page: { version: 1, notebooks: [] }, revision: 'missing', writable: true });
  expect(await readFile(path.join(root, BOOKMARKS_FILE)).catch(() => null)).toBeNull();
  const responses = await Promise.all([put(page), put(page)]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  const record = await fetch(`${base}/bookmarks`).then(r => r.json());
  expect(record.page).toEqual(page);
  const duplicate = structuredClone(page);
  duplicate.notebooks[0].bookmarks.push({ ...duplicate.notebooks[0].bookmarks[0], id: 'other' });
  const response = await put(duplicate, record.revision);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'duplicate-target', existingId: expect.any(String) });
});
it('cannot replace corrupt current data even with the correct revision', async () => {
  const raw = 'version: 8\nnotebooks: []\n';
  await writeFile(path.join(root, BOOKMARKS_FILE), raw);
  expect((await fetch(`${base}/bookmarks`)).status).toBe(422);
  expect((await put(page, revisionOf(raw))).status).toBe(422);
  expect(await readFile(path.join(root, BOOKMARKS_FILE), 'utf8')).toBe(raw);
});
it('resolves saved positions, folders, external URLs and proven missing without writing', async () => {
  const anchor = captureTextAnchor('# Guide\n\nParagraph.', { from: 9, to: 19 }, 'paragraph');
  const response = await resolveTargets([{ id: 'position', target: { kind: 'position', path: 'guide.md', anchor } }, { id: 'folder', target: { kind: 'folder', path: 'one' } }, { id: 'missing', target: { kind: 'note', path: 'missing.md' } }, { id: 'url', target: { kind: 'url', url: 'https://example.org/' } }]);
  expect(response.status).toBe(200);
  const record = await response.json();
  expect(record.results.map((r: { resolution: { state: string; }; }) => r.resolution.state)).toEqual(['resolved', 'resolved', 'unresolved', 'external']);
  expect(record.results[0].resolution.contentRevision).toMatch(/^[a-f0-9]{64}$/);
  expect(await readFile(path.join(root, BOOKMARKS_FILE)).catch(() => null)).toBeNull();
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/core'], { cwd: root });
  expect((await put(page)).status).toBe(403);
  expect((await resolveTargets([{ id: 'note', target: { kind: 'note', path: 'guide.md' } }])).status).toBe(200);
});
it('moves metadata atomically and makes an old bookmark token stale; deletion retains refs', async () => {
  await put(page);
  const original = await fetch(`${base}/bookmarks`).then(r => r.json());
  const files = await fetch(`${base}/files?notebookId=a`).then(r => r.json());
  const mutate = (revision: string, command: unknown) => fetch(`${base}/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, command }) });
  const move = await mutate(files.revision, { kind: 'move', notebookId: 'a', path: 'notes/a/guide.md', destination: 'notes/a/one/guide.md' });
  expect(move.status).toBe(200);
  expect((await put(page, original.revision)).status).toBe(409);
  const after = await fetch(`${base}/bookmarks`).then(r => r.json());
  expect(after.page.notebooks[0].bookmarks[0].target.path).toBe('one/guide.md');
  const updated = await fetch(`${base}/files?notebookId=a`).then(r => r.json());
  expect((await mutate(updated.revision, { kind: 'delete', notebookId: 'a', path: 'notes/a/one/guide.md' })).status).toBe(200);
  expect((await fetch(`${base}/bookmarks`).then(r => r.json())).page).toEqual(after.page);
});
it('a bookmark edit invalidates a reviewed move and equivalent resolved anchors cannot be duplicated', async () => {
  const files = await fetch(`${base}/files?notebookId=a`).then(r => r.json());
  expect((await put(page)).status).toBe(200);
  const move = await fetch(`${base}/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: files.revision, command: { kind: 'move', notebookId: 'a', path: 'notes/a/guide.md', destination: 'notes/a/one/guide.md' } }) });
  expect(move.status).toBe(409);
  expect(await readFile(path.join(root, 'notes/a/guide.md'), 'utf8')).toContain('# Guide');
  const before = await fetch(`${base}/bookmarks`).then(r => r.json());
  const anchor = captureTextAnchor('# Guide\n\nParagraph.', { from: 9, to: 19 }, 'paragraph');
  const next = { version: 1, notebooks: [{ notebookId: 'a', groups: [], bookmarks: [{ id: 'one', label: 'One', groupId: null, target: { kind: 'position', path: 'guide.md', anchor } }, { id: 'two', label: 'Two', groupId: null, target: { kind: 'position', path: 'guide.md', anchor: { ...anchor, prefix: '', suffix: '' } } }] }] };
  expect((await put(next, before.revision)).status).toBe(409);
});
it('direct note deletion and restoration retain bookmarks and cannot edit the metadata artifact', async () => {
  await put(page);
  const raw = await readFile(path.join(root, BOOKMARKS_FILE), 'utf8');
  expect((await fetch(`${base}/notes?path=notes/a/guide.md&notebookId=a&noCommit=true`, { method: 'DELETE' })).status).toBe(200);
  const missing = await resolveTargets([{ id: 'guide', target: page.notebooks[0].bookmarks[0].target }]);
  expect((await missing.json()).results[0].resolution.state).toBe('unresolved');
  const restored = await fetch(`${base}/notes/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId: 'a', path: 'notes/a/guide.md', content: '# Guide', metadata: {} }) });
  expect(restored.status).toBe(200);
  expect(await readFile(path.join(root, BOOKMARKS_FILE), 'utf8')).toBe(raw);
  for (const method of ['POST', 'DELETE']) {
    const response = await fetch(`${base}/notes?path=${BOOKMARKS_FILE}&notebookId=a&noCommit=true`, { method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId: 'a', path: BOOKMARKS_FILE, content: 'overwrite', metadata: {}, noCommit: true }) } : {}) });
    expect([400, 403]).toContain(response.status);
  }
  expect(await readFile(path.join(root, BOOKMARKS_FILE), 'utf8')).toBe(raw);
});
it('rejects protected paths and unsafe URLs at the read-only resolver', async () => {
  for (const target of [{ kind: 'note', path: '../private.md' }, { kind: 'note', path: '.agents/secret.md' }, { kind: 'url', url: 'javascript:alert(1)' }]) expect((await resolveTargets([{ id: 'bad', target }])).status).toBe(400);
});
