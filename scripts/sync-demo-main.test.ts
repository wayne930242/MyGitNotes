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
  write('product.txt', 'baseline\n'); write('examples/demo-workspace/.mygitnotes.yaml', 'fixture\n'); write('examples/demo-workspace/notes/example/welcome.md', '# Baseline\n');
  git('add', '.'); git('commit', '-m', 'core baseline'); git('push', 'origin', 'core');
  git('checkout', '-b', 'main'); write('.mygitnotes.yaml', 'fixture\n'); write('notes/example/welcome.md', '# Baseline\n'); write('notes/personal.md', '# Keep personal note\n');
  git('add', '.'); git('commit', '-m', 'workspace'); git('push', 'origin', 'main');
  git('checkout', 'core'); write('product.txt', 'new core\n'); write('examples/demo-workspace/notes/example/welcome.md', '# Updated tutorial\n');
  git('add', '.'); git('commit', '-m', 'core update'); git('push', 'origin', 'core');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('release transaction', () => {
  it('keeps main Agent settings when Core removes legacy settings', () => {
    git('checkout', 'core'); write('AGENTS.md', '# Legacy\n'); write('.agents/skills/demo/SKILL.md', '# Skill\n');
    git('add', '.'); git('commit', '-m', 'legacy settings'); git('push', 'origin', 'core');
    git('checkout', 'main'); git('merge', 'core', '--no-edit');
    write('AGENTS.md', '# Demo rules\n'); git('add', 'AGENTS.md'); git('commit', '-m', 'demo rules'); git('push', 'origin', 'main');
    git('checkout', 'core'); git('rm', '-r', 'AGENTS.md', '.agents'); git('commit', '-m', 'workspace ownership'); git('push', 'origin', 'core');
    expect(run()).toContain('synced=true');
    expect(remoteGit('show', 'main:AGENTS.md')).toBe('# Demo rules');
    expect(remoteGit('show', 'main:.agents/skills/demo/SKILL.md')).toBe('# Skill');
  });
  it('merges Core into main, copies canonical examples and retains other notes', () => {
    write('examples/demo-workspace/.github-notes-screen.yaml', 'version: 1\n');
    git('add', '.'); git('commit', '-m', 'screen fixture'); git('push', 'origin', 'core');
    const core = git('rev-parse', 'core');
    expect(run()).toContain('synced=true');
    const main = remoteGit('rev-parse', 'main');
    expect(remoteGit('merge-base', main, core)).toBe(core);
    expect(remoteGit('show', 'main:notes/example/welcome.md')).toBe('# Updated tutorial');
    expect(remoteGit('show', 'main:notes/personal.md')).toBe('# Keep personal note');
    expect(remoteGit('show', 'main:.github-notes-screen.yaml')).toBe('version: 1');
  });
  it('skips superseded Core runs before changing main', () => {
    const old = remoteGit('rev-parse', 'main');
    expect(run(git('rev-parse', 'core~1'))).toContain('synced=false');
    expect(remoteGit('rev-parse', 'main')).toBe(old);
  });
  it('stops a merge conflict without changing the remote workspace', () => {
    git('checkout', 'main'); write('product.txt', 'workspace customization\n'); git('add', 'product.txt'); git('commit', '-m', 'customize'); git('push', 'origin', 'main'); git('checkout', 'core');
    const old = remoteGit('rev-parse', 'main');
    expect(() => run()).toThrow();
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
});
