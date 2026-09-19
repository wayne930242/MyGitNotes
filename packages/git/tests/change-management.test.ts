import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGit, stageAndCommit } from '../src/git-service.js';
import { changeFile, commitSelectedFiles, commitStagedFiles, fileDiff, listChanges } from '../src/change-management.js';

let root: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-changes-'));
  await runGit(['init', '-b', 'main'], root);
  await runGit(['config', 'user.name', 'Test'], root);
  await runGit(['config', 'user.email', 'test@example.com'], root);
  fs.writeFileSync(path.join(root, 'a.md'), 'original a\n');
  fs.writeFileSync(path.join(root, 'b.md'), 'original b\n');
  await stageAndCommit(root, ['a.md', 'b.md'], 'fixture');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it('commits selected working files while preserving unrelated staged and working content', async () => {
  fs.writeFileSync(path.join(root, 'a.md'), 'selected a');
  fs.writeFileSync(path.join(root, 'b.md'), 'staged b');
  await runGit(['add', '--', 'b.md'], root);
  fs.writeFileSync(path.join(root, 'b.md'), 'later b');
  const selected = (await listChanges(root)).filter(file => file.path === 'a.md');
  await commitSelectedFiles(root, selected, 'selected only');
  expect((await runGit(['show', 'HEAD:a.md'], root)).stdout).toBe('selected a');
  expect((await runGit(['show', 'HEAD:b.md'], root)).stdout).toBe('original b');
  expect((await runGit(['show', ':b.md'], root)).stdout).toBe('staged b');
  expect(fs.readFileSync(path.join(root, 'b.md'), 'utf8')).toBe('later b');
});

it('rejects a stale selection before staging any selected file', async () => {
  fs.writeFileSync(path.join(root, 'a.md'), 'reviewed');
  fs.writeFileSync(path.join(root, 'b.md'), 'reviewed');
  const selected = await listChanges(root);
  fs.writeFileSync(path.join(root, 'b.md'), 'newer');
  await expect(commitSelectedFiles(root, selected, 'stale')).rejects.toThrow();
  expect((await listChanges(root)).every(file => !file.staged)).toBe(true);
});

it('stages a snapshot, shows both diffs, and commits only the staged version', async () => {
  fs.writeFileSync(path.join(root, 'a.md'), 'staged a\n');
  const change = (await listChanges(root))[0];
  await changeFile(root, change.path, 'stage', change.revision);
  fs.writeFileSync(path.join(root, 'a.md'), 'later a\n');
  fs.writeFileSync(path.join(root, 'b.md'), 'other b\n');
  expect(await fileDiff(root, 'a.md', 'staged')).toContain('+staged a');
  expect(await fileDiff(root, 'a.md', 'working')).toContain('+later a');
  expect(await fileDiff(root, 'a.md', 'current')).toContain('-original a');
  expect(await fileDiff(root, 'a.md', 'current')).toContain('+later a');
  const staged = (await listChanges(root)).filter(file => file.staged);
  await commitStagedFiles(root, staged, 'selected snapshot');
  expect((await runGit(['show', 'HEAD:a.md'], root)).stdout).toBe('staged a');
  expect((await runGit(['show', 'HEAD:b.md'], root)).stdout).toBe('original b');
  expect(fs.readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('later a\n');
});

it('restores just one file, preserves another index entry and backs up a discarded new file', async () => {
  fs.writeFileSync(path.join(root, 'a.md'), 'changed a');
  fs.writeFileSync(path.join(root, 'b.md'), 'changed b');
  await runGit(['add', '--', 'b.md'], root);
  const a = (await listChanges(root)).find(file => file.path === 'a.md')!;
  await changeFile(root, a.path, 'restore', a.revision);
  expect(fs.readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('original a\n');
  expect((await runGit(['show', ':b.md'], root)).stdout).toBe('changed b');
  fs.writeFileSync(path.join(root, 'new.md'), 'new text');
  const fresh = (await listChanges(root)).find(file => file.path === 'new.md')!;
  expect(await fileDiff(root, fresh.path, 'working')).toContain('+new text');
  const result = await changeFile(root, fresh.path, 'restore', fresh.revision);
  expect(fs.existsSync(path.join(root, 'new.md'))).toBe(false);
  expect(fs.readFileSync(result.backup!, 'utf8')).toBe('new text');
});

it('rejects stale revisions, directory targets and omitted staged files', async () => {
  fs.writeFileSync(path.join(root, 'a.md'), 'first');
  const a = (await listChanges(root))[0];
  fs.writeFileSync(path.join(root, 'a.md'), 'newer');
  await expect(changeFile(root, a.path, 'restore', a.revision)).rejects.toThrow();
  await expect(changeFile(root, '.', 'restore', a.revision)).rejects.toThrow();
  await runGit(['add', '--', 'a.md'], root);
  await expect(commitStagedFiles(root, [], 'bad')).rejects.toThrow();
});

it('legacy selected-file commits preserve unrelated staged files', async () => {
  fs.writeFileSync(path.join(root, 'a.md'), 'chosen');
  fs.writeFileSync(path.join(root, 'b.md'), 'staged elsewhere');
  await runGit(['add', '--', 'b.md'], root);
  await stageAndCommit(root, ['a.md'], 'only a');
  expect((await runGit(['show', 'HEAD:b.md'], root)).stdout).toBe('original b');
  expect((await runGit(['show', ':b.md'], root)).stdout).toBe('staged elsewhere');
});

it('unstages a new file even after subsequent edits without discarding its working copy', async () => {
  fs.writeFileSync(path.join(root, 'new.md'), 'first');
  await runGit(['add', '--', 'new.md'], root);
  fs.writeFileSync(path.join(root, 'new.md'), 'second');
  const file = (await listChanges(root)).find(entry => entry.path === 'new.md')!;
  await changeFile(root, file.path, 'unstage', file.revision);
  expect(fs.readFileSync(path.join(root, 'new.md'), 'utf8')).toBe('second');
  expect((await listChanges(root)).find(entry => entry.path === 'new.md')).toMatchObject({ staged: false, unstaged: true });
});
