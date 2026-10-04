import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { BOOKMARKS_FILE, serializeWorkspaceDocument } from '@mygitnotes/core';
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
const seed = () => writeFile(path.join(root, BOOKMARKS_FILE), serializeWorkspaceDocument(page));
const resolveTargets = (targets: unknown[]) => fetch(`${base}/bookmarks/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId: 'a', targets }) });
it('reads without creating files and rejects all retired writes with a typed 410', async () => {
  expect(await fetch(`${base}/bookmarks`).then(r => r.json())).toMatchObject({ page: { version: 1, notebooks: [] }, revision: 'missing', writable: false });
  const responses = await Promise.all([put(page), put(page), put(null)]);
  for (const response of responses) {
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: 'legacy-authoring-retired' });
  }
  expect(await readFile(path.join(root, BOOKMARKS_FILE)).catch(() => null)).toBeNull();
  await seed();
  expect((await fetch(`${base}/bookmarks`).then(r => r.json())).page).toEqual(page);
});
it('cannot replace corrupt current data even with the correct revision', async () => {
  const raw = 'version: 8\nnotebooks: []\n';
  await writeFile(path.join(root, BOOKMARKS_FILE), raw);
  expect((await fetch(`${base}/bookmarks`)).status).toBe(422);
  expect((await put(page, revisionOf(raw))).status).toBe(410);
  expect(await readFile(path.join(root, BOOKMARKS_FILE), 'utf8')).toBe(raw);
});
it('retires the resolver on writable and read-only branches without writing', async () => {
  for (const branch of ['main', 'core']) {
    execFileSync('git', ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: root });
    expect((await put(page)).status).toBe(410);
    const response = await resolveTargets([{ id: 'note', target: { kind: 'note', path: 'guide.md' } }]);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: 'legacy-authoring-retired' });
  }
  expect(await readFile(path.join(root, BOOKMARKS_FILE)).catch(() => null)).toBeNull();
});
it('moves retained metadata atomically while old authoring stays retired; deletion retains refs', async () => {
  await seed();
  const original = await fetch(`${base}/bookmarks`).then(r => r.json());
  const files = await fetch(`${base}/files?notebookId=a`).then(r => r.json());
  const mutate = (revision: string, command: unknown) => fetch(`${base}/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, command }) });
  const move = await mutate(files.revision, { kind: 'move', notebookId: 'a', path: 'notes/a/guide.md', destination: 'notes/a/one/guide.md' });
  expect(move.status).toBe(200);
  expect((await put(page, original.revision)).status).toBe(410);
  const after = await fetch(`${base}/bookmarks`).then(r => r.json());
  expect(after.page.notebooks[0].bookmarks[0].target.path).toBe('one/guide.md');
  const updated = await fetch(`${base}/files?notebookId=a`).then(r => r.json());
  expect((await mutate(updated.revision, { kind: 'delete', notebookId: 'a', path: 'notes/a/one/guide.md' })).status).toBe(200);
  expect((await fetch(`${base}/bookmarks`).then(r => r.json())).page).toEqual(after.page);
});
it('an external legacy source edit invalidates a reviewed move', async () => {
  const files = await fetch(`${base}/files?notebookId=a`).then(r => r.json());
  await seed();
  const move = await fetch(`${base}/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: files.revision, command: { kind: 'move', notebookId: 'a', path: 'notes/a/guide.md', destination: 'notes/a/one/guide.md' } }) });
  expect(move.status).toBe(409);
  expect(await readFile(path.join(root, 'notes/a/guide.md'), 'utf8')).toContain('# Guide');
});
it('direct note deletion and restoration retain bookmarks and cannot edit the metadata artifact', async () => {
  await seed();
  const raw = await readFile(path.join(root, BOOKMARKS_FILE), 'utf8');
  expect((await fetch(`${base}/notes?path=notes/a/guide.md&notebookId=a&noCommit=true`, { method: 'DELETE' })).status).toBe(200);
  expect((await fetch(`${base}/notes/read?path=notes/a/guide.md&notebookId=a`)).status).toBe(404);
  const restored = await fetch(`${base}/notes/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId: 'a', path: 'notes/a/guide.md', content: '# Guide', metadata: {} }) });
  expect(restored.status).toBe(200);
  expect(await readFile(path.join(root, BOOKMARKS_FILE), 'utf8')).toBe(raw);
  for (const method of ['POST', 'DELETE']) {
    const response = await fetch(`${base}/notes?path=${BOOKMARKS_FILE}&notebookId=a&noCommit=true`, { method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId: 'a', path: BOOKMARKS_FILE, content: 'overwrite', metadata: {}, noCommit: true }) } : {}) });
    expect([400, 403]).toContain(response.status);
  }
  expect(await readFile(path.join(root, BOOKMARKS_FILE), 'utf8')).toBe(raw);
});
it.each(['read', 'write', 'delete', 'restore'])('HTTP note %s rejects a symlink to bookmark metadata without changing bytes', async operation => {
  await seed();
  const raw = await readFile(path.join(root, BOOKMARKS_FILE), 'utf8');
  await symlink(path.join(root, BOOKMARKS_FILE), path.join(root, 'notes/a/alias.md'));
  const file = 'notes/a/alias.md';
  const response = operation === 'read' ? await fetch(`${base}/notes/read?path=${file}&notebookId=a`) : operation === 'delete' ? await fetch(`${base}/notes?path=${file}&notebookId=a&noCommit=true`, { method: 'DELETE' }) : await fetch(`${base}/notes${operation === 'restore' ? '/restore' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId: 'a', path: file, content: 'broken', metadata: {}, noCommit: true }) });
  expect(response.status).toBe(403);
  expect(await readFile(path.join(root, BOOKMARKS_FILE), 'utf8')).toBe(raw);
});
it.each([[false, '/'], [true, '/'], [false, '\\'], [true, '\\']] as const)('HTTP note writes reject a directory alias when bookmark file exists=%s using %s', async (exists, separator) => {
  if (exists) await seed();
  await symlink(root, path.join(root, 'notes/a/alias'));
  const response = await fetch(`${base}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId: 'a', path: `notes/a/alias${separator}${BOOKMARKS_FILE}`, content: 'broken', metadata: {}, noCommit: true }) });
  expect(response.status).toBe(403);
  const raw = await readFile(path.join(root, BOOKMARKS_FILE), 'utf8').catch(() => null);
  if (exists) expect(raw).toContain('version: 1');
  else expect(raw).toBeNull();
});
it('rejects even malformed legacy resolver requests as retired', async () => {
  for (const target of [{ kind: 'note', path: '../private.md' }, { kind: 'note', path: '.agents/secret.md' }, { kind: 'url', url: 'javascript:alert(1)' }]) expect((await resolveTargets([{ id: 'bad', target }])).status).toBe(410);
});
