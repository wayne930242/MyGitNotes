import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getCurrentBranch, getFirstAndLastCommitDates, getGitStatus, getRecentCommits, runGit, stageAndCommit } from '../src/git-service.js';

const execFileAsync = promisify(execFile);

/** Commits with an explicit author/committer date, for deterministic history tests. */
async function commitAt(repoRoot: string, files: string[], message: string, isoDate: string): Promise<void> {
  await execFileAsync('git', ['add', '--', ...files], { cwd: repoRoot });
  await execFileAsync('git', ['commit', '-m', message], { cwd: repoRoot, env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate } });
}

describe('Guarded Git Service', () => {
  let testRepo: string;

  beforeEach(async () => {
    testRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-notes-git-test-'));
    await runGit(['init', '-b', 'core'], testRepo);
    await runGit(['config', 'user.name', 'Test User'], testRepo);
    await runGit(['config', 'user.email', 'test@example.com'], testRepo);
  });

  afterEach(() => {
    if (fs.existsSync(testRepo)) {
      fs.rmSync(testRepo, { recursive: true, force: true });
    }
  });

  it('correctly reports current branch', async () => {
    const branch = await getCurrentBranch(testRepo);
    expect(branch).toBe('core');
  });

  it('reports clean status on initial commit', async () => {
    fs.writeFileSync(path.join(testRepo, 'README.md'), '# Test');
    await stageAndCommit(testRepo, ['README.md'], 'initial commit');

    const status = await getGitStatus(testRepo);
    expect(status.isClean).toBe(true);
    expect(status.branch).toBe('core');
  });

  it('detects modified and untracked files', async () => {
    fs.writeFileSync(path.join(testRepo, 'file1.txt'), 'one');
    await stageAndCommit(testRepo, ['file1.txt'], 'add file1');

    fs.writeFileSync(path.join(testRepo, 'file1.txt'), 'one updated');
    fs.writeFileSync(path.join(testRepo, 'untracked.txt'), 'hello');

    const status = await getGitStatus(testRepo);
    expect(status.isClean).toBe(false);
    expect(status.modified).toContain('file1.txt');
    expect(status.untracked).toContain('untracked.txt');
  });

  it('returns commit history properly', async () => {
    fs.writeFileSync(path.join(testRepo, 'file.txt'), 'v1');
    await stageAndCommit(testRepo, ['file.txt'], 'first commit');

    fs.writeFileSync(path.join(testRepo, 'file.txt'), 'v2');
    await stageAndCommit(testRepo, ['file.txt'], 'second commit');

    const commits = await getRecentCommits(testRepo, 5);
    expect(commits).toHaveLength(2);
    expect(commits[0].message).toBe('second commit');
    expect(commits[1].message).toBe('first commit');
  });

  it('keeps exact Unicode, spaces and rename paths in status', async () => {
    fs.mkdirSync(path.join(testRepo, '資料夾'));
    fs.writeFileSync(path.join(testRepo, '資料夾/原始.md'), 'original');
    await stageAndCommit(testRepo, ['資料夾/原始.md'], 'original');
    await runGit(['mv', '資料夾/原始.md', '資料夾/已搬移.md'], testRepo);
    fs.writeFileSync(path.join(testRepo, '資料夾/ 空白 \n.md'), 'new');
    const status = await getGitStatus(testRepo);
    expect(status.staged).toEqual(['資料夾/已搬移.md']);
    expect(status.untracked).toEqual(['資料夾/ 空白 \n.md']);
  });

  it('returns the first and last commit dates for a path, as ISO 8601 UTC', async () => {
    fs.writeFileSync(path.join(testRepo, 'note.md'), 'v1');
    await commitAt(testRepo, ['note.md'], 'first', '2026-09-12T09:00:00+00:00');
    fs.writeFileSync(path.join(testRepo, 'note.md'), 'v2');
    await commitAt(testRepo, ['note.md'], 'second', '2026-09-13T10:30:00+00:00');
    fs.writeFileSync(path.join(testRepo, 'note.md'), 'v3');
    await commitAt(testRepo, ['note.md'], 'third', '2026-09-15T18:00:00+00:00');

    const { first, last } = await getFirstAndLastCommitDates(testRepo, 'note.md');
    expect(first).toBe('2026-09-12T09:00:00.000Z');
    expect(last).toBe('2026-09-15T18:00:00.000Z');
  });

  it('returns an empty result for a path with no history', async () => {
    const dates = await getFirstAndLastCommitDates(testRepo, 'missing.md');
    expect(dates).toEqual({});
  });
});
