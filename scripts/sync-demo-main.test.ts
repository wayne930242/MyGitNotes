import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const script = path.resolve('scripts/sync-demo-main.mjs');
let root: string, remote: string, checkout: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8', stdio: 'pipe' }).trim();
const remoteGit = (...args: string[]) => execFileSync('git', ['--git-dir', remote, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
const write = (file: string, content: string) => { const target = path.join(checkout, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
const run = (revision = git('rev-parse', 'core')) => execFileSync(process.execPath, [script], { cwd: checkout, env: { ...process.env, CORE_REVISION: revision, GITHUB_OUTPUT: '' }, encoding: 'utf8', stdio: 'pipe' });
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-release-')); remote = path.join(root, 'origin.git'); checkout = path.join(root, 'checkout'); fs.mkdirSync(checkout);
  execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
  git('init', '-b', 'core'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com'); git('remote', 'add', 'origin', remote);
  write('product.txt', 'baseline\n'); write('.github/vercel-sparse-paths.txt', '# product\n.github/vercel-sparse-paths.txt\nproduct.txt\n'); write('examples/demo-workspace/.mygitnotes.yaml', 'fixture\n'); write('examples/demo-workspace/notes/example/welcome.md', '# Baseline\n');
  git('add', '.'); git('commit', '-m', 'core baseline'); git('push', 'origin', 'core');
  git('checkout', '-q', '--orphan', 'main'); git('rm', '-rq', '--cached', '.');
  for (const file of ['product.txt', 'examples', '.github']) fs.rmSync(path.join(checkout, file), { recursive: true, force: true });
  write('.mygitnotes.yaml', 'fixture\n'); write('notes/example/welcome.md', '# Baseline\n'); write('notes/personal.md', '# Keep personal note\n');
  git('add', '.'); git('commit', '-m', 'content-only main'); git('push', 'origin', 'main');
  git('checkout', '-qf', 'core'); git('clean', '-fdq'); write('product.txt', 'new core\n'); write('examples/demo-workspace/notes/example/welcome.md', '# Updated tutorial\n');
  git('add', '.'); git('commit', '-m', 'core update'); git('push', 'origin', 'core');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('release transaction', () => {
  it('skips superseded Core runs before changing main', () => {
    const old = remoteGit('rev-parse', 'main');
    expect(run(git('rev-parse', 'core~1'))).toContain('synced=false');
    expect(remoteGit('rev-parse', 'main')).toBe(old);
  });
  it('refuses a main that still tracks Core product paths', () => {
    git('checkout', '-q', 'main'); write('product.txt', 'product\n'); git('add', 'product.txt'); git('commit', '-qm', 'fork-model main'); git('push', '-q', 'origin', 'main'); git('checkout', '-q', 'core');
    const old = remoteGit('rev-parse', 'main');
    expect(() => run()).toThrow(/pnpm convert-workspace/);
    expect(remoteGit('rev-parse', 'main')).toBe(old);
  });
  it('rejects publication when another commit advances main during push', () => {
    const old = remoteGit('rev-parse', 'main');
    const tree = remoteGit('rev-parse', 'main^{tree}');
    const concurrent = execFileSync('git', ['--git-dir', remote, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit-tree', tree, '-p', old, '-m', 'concurrent note save'], { encoding: 'utf8' }).trim();
    const hook = path.join(checkout, '.git/hooks/pre-push');
    fs.writeFileSync(hook, `#!/bin/sh\ngit --git-dir='${remote}' update-ref refs/heads/main ${concurrent} ${old}\n`); fs.chmodSync(hook, 0o755);
    expect(() => run()).toThrow();
    expect(remoteGit('rev-parse', 'main')).toBe(concurrent);
  });
  it('fails clearly when Core does not track its product path list', () => {
    git('checkout', 'core'); git('rm', '-q', '.github/vercel-sparse-paths.txt'); git('commit', '-qm', 'drop list'); git('push', '-q', 'origin', 'core');
    const old = remoteGit('rev-parse', 'main');
    expect(() => run()).toThrow(/vercel-sparse-paths\.txt/);
    expect(remoteGit('rev-parse', 'main')).toBe(old);
  });
  it('keeps main content-only, syncs examples and deploys the Core revision', () => {
    git('checkout', '-q', 'main'); write('notes/example/retired.md', '# Retired\n'); git('add', '.'); git('commit', '-qm', 'retired note'); git('push', '-q', 'origin', 'main');
    git('checkout', '-qf', 'core'); git('clean', '-fdq');
    write('examples/demo-workspace/.github-notes-screen.yaml', 'version: 1\n');
    write('examples/demo-workspace/notes/example/retired.md', '# Retired\n');
    git('add', '.'); git('commit', '-qm', 'retired template'); git('push', '-q', 'origin', 'core');
    const first = run();
    expect(first).toContain(`deploy_sha=${git('rev-parse', 'core')}`);
    expect(remoteGit('log', '-1', '--format=%B', 'main')).toContain(`Core-Revision: ${git('rev-parse', 'core')}`);
    expect(remoteGit('show', 'main:.github-notes-screen.yaml')).toBe('version: 1');
    git('rm', '-q', 'examples/demo-workspace/notes/example/retired.md', 'examples/demo-workspace/.github-notes-screen.yaml'); git('commit', '-qm', 'drop template'); git('push', '-q', 'origin', 'core');
    expect(run()).toContain('synced=true');
    expect(remoteGit('ls-tree', '-r', '--name-only', 'main').split('\n').sort()).toEqual(['.github-notes-screen.yaml', '.mygitnotes.yaml', 'notes/example/welcome.md', 'notes/personal.md']);
    expect(remoteGit('show', 'main:notes/example/welcome.md')).toBe('# Updated tutorial');
    expect(remoteGit('show', 'main:notes/personal.md')).toBe('# Keep personal note');
    expect(() => remoteGit('merge-base', 'main', 'core')).toThrow();
    expect(git('status', '--porcelain')).toBe('');
    expect(git('worktree', 'list').split('\n')).toHaveLength(1);
  });
});
