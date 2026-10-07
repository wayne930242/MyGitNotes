import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import syncFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readVersionFile, versionFilePath } from '@mygitnotes/core';
import { createApp } from '../src/app.js';

let root: string, server: Server, base: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const write = async (file: string, text: string) => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
};
const commit = async (file: string, text: string, message: string) => {
  await write(file, text);
  git('add', file);
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
};
const json = (url: string, body?: unknown) => fetch(`${base}${url}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const versionsOf = async (file: string) => readVersionFile(await readFile(path.join(root, versionFilePath(file)), 'utf8')).versions;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'note-history-'));
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  await write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n');
  git('add', '.github-notes.yaml');
  git('commit', '-q', '-m', 'Workspace');
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

it('lists a note’s history, reads it at a commit, and records, renames and deletes versions in their own commits', async () => {
  const first = await commit('notes/a/plan.md', '# Plan\none\n', 'Start the plan');
  const second = await commit('notes/a/plan.md', '# Plan\none\ntwo\n', 'docs(notes): edit plan.md (Agent, 2026-10-07)\n\nAgent-Edit: 2026-10-07');
  await commit('notes/a/other.md', 'other\n', 'Other');

  const history = await json('/history?notebookId=a&path=notes/a/plan.md').then(response => response.json());
  expect(history).toMatchObject({ path: 'notes/a/plan.md', more: false, versions: [], writable: true });
  expect(history.entries.map((entry: { commit: string; agent: boolean; }) => [entry.commit, entry.agent])).toEqual([[second, true], [first, false]]);
  expect(await json(`/history/file?notebookId=a&path=notes/a/plan.md&commit=${first}`).then(response => response.json())).toMatchObject({ content: '# Plan\none\n' });

  const created = await json('/versions', { notebookId: 'a', path: 'notes/a/plan.md', action: 'create', commit: first, name: 'Outline', note: 'Only the headings.', today: new Date().toISOString().slice(0, 10) });
  expect(created.status).toBe(200);
  expect((await created.json()).versions).toMatchObject([{ commit: first, sequence: 1, name: 'Outline', note: 'Only the headings.' }]);
  expect(git('show', '--name-only', '--format=%s', 'HEAD').split('\n').filter(Boolean)).toEqual(['docs(versions): record a version of plan.md', versionFilePath('notes/a/plan.md')]);
  // The version file's commit is not part of the note's own history.
  expect((await json('/history?notebookId=a&path=notes/a/plan.md').then(response => response.json())).entries).toHaveLength(2);
  expect((await json('/versions', { notebookId: 'a', path: 'notes/a/plan.md', action: 'create', commit: first })).status).toBe(409);

  await json('/versions', { notebookId: 'a', path: 'notes/a/plan.md', action: 'update', sequence: 1, name: 'Skeleton' });
  expect(await versionsOf('notes/a/plan.md')).toMatchObject([{ sequence: 1, name: 'Skeleton' }]);
  expect((await json('/versions', { notebookId: 'a', path: 'notes/a/plan.md', action: 'update', sequence: 1, name: 'two\nlines' })).status).toBe(400);

  // A version's content is readable by its blob; other blobs are not.
  const [version] = await versionsOf('notes/a/plan.md');
  expect(await json(`/history/file?notebookId=a&path=notes/a/plan.md&blob=${version.blob}`).then(response => response.json())).toMatchObject({ content: '# Plan\none\n' });
  const other = git('rev-parse', 'HEAD:notes/a/other.md');
  expect((await json(`/history/file?notebookId=a&path=notes/a/plan.md&blob=${other}`)).status).toBe(403);

  await json('/versions', { notebookId: 'a', path: 'notes/a/plan.md', action: 'delete', sequence: 1 });
  expect(syncFs.existsSync(path.join(root, versionFilePath('notes/a/plan.md')))).toBe(false);
  expect(git('status', '--porcelain')).toBe('');
});

it('marks the other files a commit changed when asked, and refuses files outside notes and agent files', async () => {
  await write('notes/a/one.md', 'one\n');
  await write('notes/a/two.md', 'two\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Both');
  const both = git('rev-parse', 'HEAD');
  expect(await json(`/history/commit?notebookId=a&path=notes/a/one.md&commit=${both}`).then(response => response.json())).toMatchObject({ files: ['notes/a/two.md'] });
  await json('/versions', { notebookId: 'a', path: 'notes/a/one.md', action: 'create', commit: both, include: ['notes/a/two.md'], name: 'Pair' });
  expect(await versionsOf('notes/a/two.md')).toMatchObject([{ commit: both, name: 'Pair' }]);
  expect((await json('/versions', { notebookId: 'a', path: 'notes/a/one.md', action: 'create', commit: both, include: ['.github-notes.yaml'] })).status).toBe(400);
  expect((await json('/history?path=.github-notes.yaml')).status).toBe(403);
  expect((await json(`/history?path=${versionFilePath('notes/a/one.md')}`)).status).toBe(403);
  await commit('AGENTS.md', '# Rules\n', 'Rules');
  expect((await json('/history?path=AGENTS.md').then(response => response.json())).entries).toHaveLength(1);
});

it('commits a note and its new version together from the quick commit', async () => {
  await commit('notes/a/plan.md', '# Plan\n', 'Start');
  const before = git('rev-parse', 'HEAD');
  await write('notes/a/plan.md', '# Plan\nrevised\n');
  const [change] = await json('/git/changes').then(response => response.json()).then(body => body.changes);
  const response = await json('/git/commit-staged', { files: [change.path], revisions: { [change.path]: change.revision }, message: 'Revise', selected: true, version: { path: 'notes/a/plan.md', name: 'v-next', today: new Date().toISOString().slice(0, 10) } });
  expect(response.status).toBe(200);
  expect(git('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual([versionFilePath('notes/a/plan.md'), 'notes/a/plan.md'].sort());
  expect(await versionsOf('notes/a/plan.md')).toMatchObject([{ parent: before, name: 'v-next' }]);
});

it('moves a note’s version file with the note and removes it with the note until the note is restored', async () => {
  await commit('notes/a/done/keep.md', 'keep\n', 'Folder');
  await commit('notes/a/plan.md', '# Plan\n', 'Start');
  await json('/versions', { notebookId: 'a', path: 'notes/a/plan.md', action: 'create', commit: git('rev-parse', 'HEAD') });
  const files = await json('/files?notebookId=a').then(response => response.json());
  const moved = await json('/files', { command: { kind: 'move', notebookId: 'a', path: 'notes/a/plan.md', destination: 'notes/a/done/plan.md' }, revision: files.revision });
  expect(moved.status, await moved.clone().text()).toBe(200);
  expect(syncFs.existsSync(path.join(root, versionFilePath('notes/a/done/plan.md')))).toBe(true);
  expect(syncFs.existsSync(path.join(root, versionFilePath('notes/a/plan.md')))).toBe(false);
  // The moved version file is a change that can be committed with the move.
  expect((await json('/git/changes').then(response => response.json())).changes.filter((change: { path: string; available: boolean; }) => change.path.startsWith('.mygitnotes/') && change.available)).toHaveLength(2);

  git('add', '-A');
  git('commit', '-q', '-m', 'Move');
  const deleted = await fetch(`${base}/notes?path=notes/a/done/plan.md&noCommit=true`, { method: 'DELETE' });
  expect(deleted.status).toBe(200);
  expect(syncFs.existsSync(path.join(root, versionFilePath('notes/a/done/plan.md')))).toBe(false);
  await json('/notes/restore', { path: 'notes/a/done/plan.md', notebookId: 'a', content: '# Plan\n', metadata: {} });
  expect(syncFs.existsSync(path.join(root, versionFilePath('notes/a/done/plan.md')))).toBe(true);
});
