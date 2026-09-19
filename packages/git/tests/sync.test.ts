import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getUpstreamStatus, runGit } from '../src/git-service.js';
import { SyncError, syncWorkspace } from '../src/sync.js';

let base: string, remote: string, local: string, other: string;
const git = async (cwd: string, ...args: string[]) => (await runGit(args, cwd)).stdout;
const write = (cwd: string, file: string, content: string) => fs.writeFileSync(path.join(cwd, file), content);
const read = (cwd: string, file: string) => fs.readFileSync(path.join(cwd, file), 'utf8');
async function commit(cwd: string, file: string, content: string, message = `edit ${file}`) {
  write(cwd, file, content);
  await git(cwd, 'add', '-A');
  await git(cwd, 'commit', '-m', message);
}
async function clone(name: string) {
  const dir = path.join(base, name);
  await runGit(['clone', remote, dir], base);
  await git(dir, 'config', 'user.name', 'Test');
  await git(dir, 'config', 'user.email', 'test@example.com');
  return dir;
}
const failure = (promise: Promise<unknown>) =>
  promise.then(() => {
    throw new Error('Expected sync to fail');
  }, (error: SyncError) => error);

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-sync-'));
  remote = path.join(base, 'remote.git');
  await runGit(['init', '--bare', '-b', 'main', remote], base);
  const seed = path.join(base, 'seed');
  await runGit(['init', '-b', 'main', seed], base);
  await git(seed, 'config', 'user.name', 'Test');
  await git(seed, 'config', 'user.email', 'test@example.com');
  await commit(seed, 'a.md', 'one\ntwo\nthree\n', 'fixture');
  await git(seed, 'remote', 'add', 'origin', remote);
  await git(seed, 'push', '-u', 'origin', 'main');
  local = await clone('local');
  other = await clone('other');
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe('syncWorkspace', () => {
  it('reports an up-to-date workspace', async () => {
    expect(await getUpstreamStatus(local)).toEqual({ upstream: 'origin/main', ahead: 0, behind: 0 });
    expect(await syncWorkspace(local)).toEqual({ upstream: 'origin/main', pulled: 0, pushed: 0 });
  });

  it('pulls only, pushes only, and rebases local commits onto remote commits', async () => {
    await commit(other, 'remote.md', 'remote\n');
    await git(other, 'push');
    expect(await syncWorkspace(local)).toMatchObject({ pulled: 1, pushed: 0 });
    expect(read(local, 'remote.md')).toBe('remote\n');

    await commit(local, 'local.md', 'local\n');
    expect(await getUpstreamStatus(local)).toMatchObject({ ahead: 1, behind: 0 });
    expect(await syncWorkspace(local)).toMatchObject({ pulled: 0, pushed: 1 });

    await git(other, 'pull');
    await commit(other, 'second.md', 'second\n');
    await git(other, 'push');
    await commit(local, 'third.md', 'third\n');
    expect(await syncWorkspace(local)).toMatchObject({ pulled: 1, pushed: 1 });
    expect(await git(local, 'rev-list', '--merges', 'HEAD')).toBe('');
    expect(await git(remote, 'ls-tree', '--name-only', 'main')).toBe('a.md\nlocal.md\nremote.md\nsecond.md\nthird.md');
    expect(await getUpstreamStatus(local)).toMatchObject({ ahead: 0, behind: 0 });
  });

  it('refuses uncommitted tracked changes before fetching and allows untracked files', async () => {
    await commit(other, 'remote.md', 'remote\n');
    await git(other, 'push');
    const tracking = await git(local, 'rev-parse', 'origin/main');
    write(local, 'a.md', 'edited\n');
    const error = await failure(syncWorkspace(local));
    expect(error).toMatchObject({ code: 'DIRTY', files: ['a.md'] });
    expect(await git(local, 'rev-parse', 'origin/main')).toBe(tracking);
    await git(local, 'checkout', '--', 'a.md');
    write(local, 'draft.md', 'untracked\n');
    expect(await syncWorkspace(local)).toMatchObject({ pulled: 1 });
    expect(read(local, 'draft.md')).toBe('untracked\n');
  });

  it('requires main and an upstream branch', async () => {
    await git(local, 'branch', '--unset-upstream');
    expect(await failure(syncWorkspace(local))).toMatchObject({ code: 'NO_UPSTREAM' });
    await git(local, 'checkout', '-b', 'core');
    expect(await failure(syncWorkspace(local))).toMatchObject({ code: 'INVALID_BRANCH' });
  });

  describe('conflicts', () => {
    beforeEach(async () => {
      await commit(other, 'a.md', 'one\nremote\nthree\n');
      await git(other, 'push');
      write(local, 'local.md', 'kept\n');
      await commit(local, 'a.md', 'one\nlocal\nthree\n');
    });

    it('aborts the rebase and restores the previous state', async () => {
      const head = await git(local, 'rev-parse', 'HEAD');
      expect(await failure(syncWorkspace(local))).toMatchObject({ code: 'CONFLICT', files: ['a.md'] });
      expect(await git(local, 'rev-parse', 'HEAD')).toBe(head);
      expect(await git(local, 'branch', '--show-current')).toBe('main');
      expect(await git(local, 'status', '--porcelain')).toBe('');
      expect(await git(local, 'for-each-ref', 'refs/github-notes')).toBe('');
      expect(read(local, 'a.md')).toBe('one\nlocal\nthree\n');
    });

    it('keeps the remote side of conflicting hunks and backs up the previous HEAD', async () => {
      const head = await git(local, 'rev-parse', 'HEAD');
      const result = await syncWorkspace(local, 'remote');
      expect(result).toMatchObject({ pulled: 1, pushed: 1, backup: expect.stringMatching(/^refs\/github-notes\/sync-backups\//) });
      expect(await git(local, 'rev-parse', result.backup!)).toBe(head);
      expect(read(local, 'a.md')).toBe('one\nremote\nthree\n');
      expect(await git(remote, 'show', 'main:local.md')).toBe('kept');
    });

    it('keeps the local side of conflicting hunks and pushes it', async () => {
      expect(await syncWorkspace(local, 'local')).toMatchObject({ pulled: 1, pushed: 1 });
      expect(await git(remote, 'show', 'main:a.md')).toBe('one\nlocal\nthree');
    });
  });

  it('leaves delete conflicts to the user after aborting the chosen strategy', async () => {
    await git(other, 'rm', 'a.md');
    await git(other, 'commit', '-m', 'remove a');
    await git(other, 'push');
    await commit(local, 'a.md', 'one\nlocal\nthree\n');
    const head = await git(local, 'rev-parse', 'HEAD');
    expect(await failure(syncWorkspace(local))).toMatchObject({ code: 'CONFLICT', files: ['a.md'] });
    expect(await failure(syncWorkspace(local, 'local'))).toMatchObject({ code: 'UNRESOLVED', files: ['a.md'] });
    expect(await git(local, 'rev-parse', 'HEAD')).toBe(head);
    expect(await git(local, 'status', '--porcelain')).toBe('');
    expect(await git(local, 'for-each-ref', 'refs/github-notes')).toBe('');
  });

  it('preserves Core update merges and the merged Core commits', async () => {
    const mergeCore = async (file: string) => {
      await git(local, 'checkout', 'core');
      await commit(local, file, `${file}\n`);
      await git(local, 'checkout', 'main');
      await git(local, 'merge', '--no-ff', 'core', '-m', `merge ${file}`);
    };
    await git(local, 'branch', 'core', 'HEAD');
    await mergeCore('core-1.md');
    await git(local, 'push');
    await mergeCore('core-2.md');
    await git(other, 'pull');
    await commit(other, 'remote.md', 'remote\n');
    await git(other, 'push');
    expect(await syncWorkspace(local)).toMatchObject({ pulled: 1, pushed: 2 });
    expect((await git(remote, 'rev-list', '--merges', 'main')).split('\n')).toHaveLength(2);
    expect(await git(remote, 'rev-parse', 'main^2')).toBe(await git(local, 'rev-parse', 'core'));
    expect(await git(remote, 'show', 'main:remote.md')).toBe('remote');
  });

  it('reports a rejected push and keeps the rebased commits', async () => {
    const hook = path.join(remote, 'hooks', 'pre-receive');
    fs.writeFileSync(hook, '#!/bin/sh\necho "push denied by policy" >&2\nexit 1\n', { mode: 0o755 });
    await commit(local, 'local.md', 'local\n');
    const error = await failure(syncWorkspace(local));
    expect(error).toMatchObject({ code: 'FAILED' });
    expect(error.message).toContain('push denied by policy');
    expect(await getUpstreamStatus(local)).toMatchObject({ ahead: 1 });
  });
});
