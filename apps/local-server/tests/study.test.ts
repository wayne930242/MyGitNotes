import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { STUDY_FILE, createStudyNote, emptyStudyWorkspace, applyStudyAction } from '@github-notes/core';

let root: string, server: Server, url: string;
const source = { notebookId: 'a', path: 'notes/a/guide.md', title: 'Question', metadata: {}, content: 'Question\n\n---\n\nAnswer' };
const note = createStudyNote(source, new Date('2026-09-14T04:00:00Z'));
const study = applyStudyAction(emptyStudyWorkspace(), note, note.cards[0].id, { kind: 'review', rating: 3 }, new Date('2026-09-14T04:00:00Z'));
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'study-yaml-'));
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'pipe' });
  await writeFile(path.join(root, '.github-notes.yaml'), 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n');
  for (const [key, value] of Object.entries({ GITHUB_NOTES_SOURCE: 'local', GITHUB_NOTES_LOCAL_PATH: root, VERCEL: '', APP_URL: '' })) vi.stubEnv(key, value);
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as {port: number}).port}/api/study`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const put = (value: unknown, revision = 'missing') => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ study: value, revision }) });

it('persists a study events and memory state and rejects stale writes', async () => {
  expect(await fetch(url).then(r => r.json())).toMatchObject({ study: { version: 1, notes: [], events: [] }, writable: true, revision: 'missing' });
  const saved = await put(study); expect(saved.status).toBe(200);
  const record = await saved.json(); expect(record.study).toEqual(study);
  expect(await readFile(path.join(root, STUDY_FILE), 'utf8')).toContain('algorithm: ts-fsrs@5.4.2');
  expect((await put(emptyStudyWorkspace())).status).toBe(409);
  expect(await fetch(url).then(r => r.json())).toMatchObject({ study, revision: record.revision });
  const competing = await Promise.all(['first', 'second'].map(name => put({ ...study, notes: [{ ...study.notes[0], title: name }] }, record.revision)));
  expect(competing.map(response => response.status).sort()).toEqual([200, 409]);
  // Study data participates in the existing Git review interface.
  const diff = await fetch(url.replace('/study', `/git/diff?path=${STUDY_FILE}`));
  expect(diff.status).toBe(200);
  expect((await diff.json()).diff).toContain(`+++ ${STUDY_FILE}`);
});
it('protects Core, rejects symlink targets and reports invalid YAML without replacing it', async () => {
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/core'], { cwd: root });
  expect((await put(study)).status).toBe(403);
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: root });
  await symlink('.github-notes.yaml', path.join(root, STUDY_FILE));
  expect((await fetch(url)).status).toBe(403);
  expect((await put(study)).status).toBe(403);
  await rm(path.join(root, STUDY_FILE));
  await writeFile(path.join(root, STUDY_FILE), 'version: nope\n');
  expect((await fetch(url)).status).toBe(422);
  expect(await readFile(path.join(root, STUDY_FILE), 'utf8')).toBe('version: nope\n');
});
