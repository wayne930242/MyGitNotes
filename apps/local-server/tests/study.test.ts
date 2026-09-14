import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, symlink, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import syncFs from 'node:fs';
import { stringify } from 'yaml';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { STUDY_FILE, createStudyNote, emptyStudyWorkspace, applyStudyAction, parseNoteContent, readNoteFile } from '@github-notes/core';

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

async function stageFixture() {
  const raw = '---\ntitle: Question\ncustom: keep-me\nstatus: new\n---\n\nQuestion\n\n---\n\nAnswer  \n';
  await mkdir(path.join(root, 'notes/a'), { recursive: true });
  await writeFile(path.join(root, source.path), raw);
  await writeFile(path.join(root, '.github-notes-screen.yaml'), stringify({ version: 1, rows: [{ id: 'lane', name: 'Study', kind: 'dynamic', view: 'study',
    source: { kind: 'folder', notebookId: 'a', path: 'notes/a', recursive: true },
    progression: { stages: [{ status: 'new', intervalDays: 1 }, { status: 'learning', intervalDays: 3 }, { status: 'review', intervalDays: 7 }, { status: 'known', intervalDays: 30 }], easy: 'two' },
  }] }));
  return raw;
}
async function stageRequest(action = 'stage-review', extra: Record<string, unknown> = {}) {
  const current = await fetch(url).then(response => response.json());
  const note = readNoteFile(root, source.path, 'a');
  return { laneId: 'lane', path: source.path, notebookId: 'a', revision: current.revision, expected: { content: note.content, metadata: note.metadata }, action, ...(action === 'stage-review' ? { rating: 4 } : {}), ...extra };
}
const act = (body: unknown) => fetch(url + '/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
it('saves a stage transition with note status, preserves the body and undoes both', async () => {
  const raw = await stageFixture(), request = await stageRequest();
  const response = await act(request); expect(response.status).toBe(200);
  const saved = await response.json(); expect(saved.note.status).toBe('review');
  expect(saved.study.notes[0].stage.status).toBe('review');
  expect(parseNoteContent(await readFile(path.join(root, source.path), 'utf8')).content).toBe(parseNoteContent(raw).content);
  expect(saved.note.metadata.custom).toBe('keep-me');
  expect((await act(request)).status).toBe(409);
  const undone = await act(await stageRequest('undo', { eventId: saved.study.events[0].id }));
  expect(undone.status).toBe(200);
  expect((await undone.json()).note.status).toBe('new');
  expect(readNoteFile(root, source.path, 'a').status).toBe('new');
});
it('refuses a stale note without writing its stage history', async () => {
  await stageFixture(); const request = await stageRequest();
  await writeFile(path.join(root, source.path), '# Edited outside\n');
  expect((await act(request)).status).toBe(409);
  expect((await fetch(url).then(response => response.json())).study.events).toEqual([]);
  expect(await readFile(path.join(root, source.path), 'utf8')).toBe('# Edited outside\n');
});
it('restores the note if the study file cannot be published', async () => {
  const raw = await stageFixture(), request = await stageRequest();
  const rename = syncFs.renameSync;
  const spy = vi.spyOn(syncFs, 'renameSync').mockImplementation((from, to) => {
    if (String(to) === path.join(root, STUDY_FILE)) throw new Error('Injected storage failure');
    return rename(from, to);
  });
  try { expect((await act(request)).status).toBe(500); } finally { spy.mockRestore(); }
  expect(await readFile(path.join(root, source.path), 'utf8')).toBe(raw);
  expect((await fetch(url).then(response => response.json())).study.events).toEqual([]);
});
it('rejects stage actions on Core and note symlinks', async () => {
  const raw = await stageFixture(), request = await stageRequest();
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/core'], { cwd: root });
  expect((await act(request)).status).toBe(403);
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: root });
  await writeFile(path.join(root, 'target.md'), raw); await rm(path.join(root, source.path));
  await symlink(path.join(root, 'target.md'), path.join(root, source.path));
  expect((await act(request)).status).toBe(403);
});
