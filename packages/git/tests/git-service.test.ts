import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {
  runGit,
  getCurrentBranch,
  getGitStatus,
  stageAndCommit,
  getRecentCommits,
} from '../src/git-service.js';

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
});
