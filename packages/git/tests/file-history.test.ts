import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { placeVersions, readVersionFile, versionFilePath } from '@mygitnotes/core';
import { runGit, stageAndCommit } from '../src/git-service.js';
import { commitSelectedFiles, commitVersionChange, listChanges } from '../src/change-management.js';
import { commitDetails, fileHistory, HISTORY_READ_MAX_BYTES, readFileAt, readHistoryBlob, worktreeBlob } from '../src/file-history.js';

let root: string;
const write = (file: string, text: string | Buffer) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};
const head = async () => (await runGit(['rev-parse', 'HEAD'], root)).stdout;
const versionsOf = (file: string) => readVersionFile(fs.readFileSync(path.join(root, versionFilePath(file)), 'utf8')).versions;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-history-'));
  await runGit(['init', '-b', 'main'], root);
  await runGit(['config', 'user.name', 'Test'], root);
  await runGit(['config', 'user.email', 'test@example.com'], root);
  write('notes/ex/old.md', '# Plan\none\n');
  write('notes/ex/other.md', 'other\n');
  await stageAndCommit(root, ['notes/ex/old.md', 'notes/ex/other.md'], 'Start the plan');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it('lists a file’s commits across a rename with its path and object in each, and reads it as each held it', async () => {
  const first = await head();
  await runGit(['mv', 'notes/ex/old.md', 'notes/ex/plan.md'], root);
  await runGit(['commit', '-m', 'Rename the plan'], root);
  write('notes/ex/plan.md', '# Plan\none\ntwo\n');
  await stageAndCommit(root, ['notes/ex/plan.md'], 'docs(notes): edit plan.md (Agent, 2026-10-07)\n\nAgent-Edit: 2026-10-07');
  write('notes/ex/other.md', 'changed\n');
  await stageAndCommit(root, ['notes/ex/other.md'], 'Unrelated');

  const { entries, more } = await fileHistory(root, 'notes/ex/plan.md', 1);
  expect(more).toBe(false);
  expect(entries.map(entry => [entry.subject, entry.path, entry.agent])).toEqual([['docs(notes): edit plan.md (Agent, 2026-10-07)', 'notes/ex/plan.md', true], ['Rename the plan', 'notes/ex/plan.md', false], ['Start the plan', 'notes/ex/old.md', false]]);
  expect(entries[2]).toMatchObject({ commit: first, parents: [], author: 'Test', body: '' });
  expect(entries[0].blob).toBe(await worktreeBlob(root, 'notes/ex/plan.md'));
  expect(await readFileAt(root, first, 'notes/ex/old.md')).toEqual({ blob: entries[2].blob, content: '# Plan\none\n' });
  expect(await readFileAt(root, first, 'notes/ex/plan.md')).toBeUndefined();
  expect(await readHistoryBlob(root, entries[0].blob!)).toMatchObject({ content: '# Plan\none\ntwo\n' });
  expect((await fileHistory(root, 'notes/ex/plan.md', 1, 2)).more).toBe(true);
  expect(await commitDetails(root, entries[1].commit)).toMatchObject({ paths: ['notes/ex/plan.md'] });
  expect(await commitDetails(root, first)).toMatchObject({ paths: ['notes/ex/old.md', 'notes/ex/other.md'] });
});

it('shows a notice instead of binary or oversized content', async () => {
  write('notes/ex/big.txt', 'x'.repeat(HISTORY_READ_MAX_BYTES + 1));
  write('notes/ex/bin.md', Buffer.from([1, 0, 2]));
  await stageAndCommit(root, ['notes/ex/big.txt', 'notes/ex/bin.md'], 'Add files');
  expect(await readFileAt(root, await head(), 'notes/ex/big.txt')).toMatchObject({ notice: 'too-large' });
  expect(await readFileAt(root, await head(), 'notes/ex/bin.md')).toMatchObject({ notice: 'binary' });
  expect(await readFileAt(root, 'not-a-commit', 'notes/ex/bin.md')).toBeUndefined();
});

it('commits a note and its new version together, naming the head it was made on and the author date it set', async () => {
  const before = await head();
  write('notes/ex/old.md', '# Plan\nrevised\n');
  write('notes/ex/other.md', 'unrelated edit\n');
  const selected = (await listChanges(root)).filter(file => file.path === 'notes/ex/old.md');
  await commitSelectedFiles(root, selected, 'Revise the plan', { path: 'notes/ex/old.md', label: { name: 'Draft' }, today: '2026-10-07' });
  expect((await runGit(['show', '--name-only', '--format=', 'HEAD'], root)).stdout.split('\n').sort()).toEqual([versionFilePath('notes/ex/old.md'), 'notes/ex/old.md'].sort());
  expect((await runGit(['rev-parse', 'HEAD^'], root)).stdout).toBe(before);
  const [version] = versionsOf('notes/ex/old.md');
  expect(version).toMatchObject({ parent: before, sequence: 1, date: '2026.10.07', name: 'Draft', blob: await worktreeBlob(root, 'notes/ex/old.md') });
  expect((await runGit(['show', '-s', '--format=%aI', 'HEAD'], root)).stdout).toBe(new Date(version.authored).toISOString().replace('.000Z', '+00:00'));
  // Unrelated work stays uncommitted.
  expect((await listChanges(root)).map(file => file.path)).toEqual(['notes/ex/other.md']);
  const { entries } = await fileHistory(root, 'notes/ex/old.md', 1);
  expect(placeVersions([version], entries).get(await head())).toEqual([version]);
});

it('finds a version again after a rebase changed its commit, by the author date it kept', async () => {
  write('notes/ex/old.md', '# Plan\nmine\n');
  await commitSelectedFiles(root, (await listChanges(root)).filter(file => file.path === 'notes/ex/old.md'), 'Mine', { path: 'notes/ex/old.md', label: {}, today: '2026-10-07' });
  const [version] = versionsOf('notes/ex/old.md');
  // Another commit arrives underneath, and the version's commit is replayed on top of it.
  await runGit(['branch', 'upstream', 'HEAD~1'], root);
  await runGit(['checkout', '-q', 'upstream'], root);
  write('notes/ex/other.md', 'upstream\n');
  await stageAndCommit(root, ['notes/ex/other.md'], 'Upstream');
  await runGit(['checkout', '-q', 'main'], root);
  await runGit(['rebase', '-q', 'upstream'], root);
  const { entries } = await fileHistory(root, 'notes/ex/old.md', 1);
  expect(entries[0].parents[0]).not.toBe(version.parent);
  expect(placeVersions([version], entries).get(entries[0].commit)).toEqual([version]);
});

it('changes version files in a commit of their own', async () => {
  const commit = await head();
  write('notes/ex/other.md', 'pending\n');
  await commitVersionChange(root, ['notes/ex/old.md', 'notes/ex/other.md'], records => {
    for (const record of records.values()) record.versions.push({ blob: commit, commit, authored: '2026-10-07T00:00:00Z', sequence: 1, date: '2026.10.07', created: '2026-10-07T00:00:00.000Z' });
  }, 'docs(versions): record');
  expect((await runGit(['show', '--name-only', '--format=', 'HEAD'], root)).stdout.split('\n').sort()).toEqual([versionFilePath('notes/ex/old.md'), versionFilePath('notes/ex/other.md')]);
  expect((await listChanges(root)).map(file => file.path)).toEqual(['notes/ex/other.md']);
  await commitVersionChange(root, ['notes/ex/old.md'], records => void records.get('notes/ex/old.md')!.versions.splice(0), 'docs(versions): delete');
  expect(fs.existsSync(path.join(root, versionFilePath('notes/ex/old.md')))).toBe(false);
  expect((await runGit(['ls-files', versionFilePath('notes/ex/old.md')], root)).stdout).toBe('');
});
