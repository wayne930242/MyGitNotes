import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { coreProductPaths } from './lib/workspace-conversion.mjs';

const gitIn = cwd => (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const git = gitIn(process.cwd());
const output = (key, value) => {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
};
const TRAILER = 'Core-Revision';
const templateRoot = 'examples/demo-workspace';

/** Copies the canonical demo examples from Core into the workspace at `root` and stages them there. */
function syncExamples(root, previousCore) {
  const template = path.resolve(templateRoot);
  const oldTemplates = previousCore ? git('ls-tree', '-r', '--name-only', previousCore, '--', `${templateRoot}/notes`).split('\n').filter(Boolean) : [];
  const copied = [];
  const safeTarget = relative => {
    const target = path.resolve(root, relative);
    let ancestor = target;
    while (!fs.existsSync(ancestor)) {
      try {
        if (fs.lstatSync(ancestor).isSymbolicLink()) throw Error(`Dangling workspace symlink: ${relative}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      ancestor = path.dirname(ancestor);
    }
    const real = path.relative(fs.realpathSync(root), fs.realpathSync(ancestor));
    if (real.startsWith('../') || path.isAbsolute(real)) throw Error(`Workspace symlink escapes repository: ${relative}`);
    return target;
  };
  const copy = relative => {
    const target = safeTarget(relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(template, relative), target);
    copied.push(relative);
  };
  const walk = directory => {
    for (const entry of fs.readdirSync(path.join(template, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile()) copy(relative);
      else throw Error(`Template must contain regular files: ${relative}`);
    }
  };
  // This script owns the public demo; normal bootstrap preserves existing user files.
  copy('.mygitnotes.yaml');
  if (fs.existsSync(path.join(template, '.github-notes-screen.yaml'))) copy('.github-notes-screen.yaml');
  walk('notes');
  for (const old of oldTemplates) {
    const relative = old.slice(templateRoot.length + 1);
    if (copied.includes(relative)) continue;
    const target = safeTarget(relative);
    if (fs.existsSync(target)) {
      if (fs.readFileSync(target, 'utf8') !== execFileSync('git', ['show', `${previousCore}:${old}`], { encoding: 'utf8' })) throw Error(`Removed template has workspace edits: ${relative}`);
      fs.unlinkSync(target);
      copied.push(relative);
    }
  }
  gitIn(root)('add', '--', ...copied);
}

let worktree;
try {
  if (git('status', '--porcelain')) throw Error('Release checkout must be clean.');
  git('fetch', 'origin', 'core', 'main');
  const core = git('rev-parse', 'origin/core');
  const expected = process.env.CORE_REVISION || core;
  if (expected !== core) {
    output('synced', 'false');
    console.log('A newer Core revision superseded this run.');
    process.exit(0);
  }
  // The demo main holds only workspace content; a main that still carries the product converts first.
  if (git('ls-tree', '-r', '--name-only', 'origin/main', '--', ...coreProductPaths(git, core))) throw Error('origin/main still tracks Core product paths. Run `pnpm convert-workspace` on it first.');
  let previousCore = git('log', '-1', `--grep=^${TRAILER}: `, `--format=%(trailers:key=${TRAILER},valueonly)`, 'origin/main') || undefined;
  try {
    previousCore ??= git('merge-base', 'origin/core', 'origin/main');
  } catch {}
  worktree = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'demo-main-'));
  git('worktree', 'add', '-B', 'release-main', worktree, 'origin/main');
  syncExamples(worktree, previousCore);
  const workspace = gitIn(worktree);
  if (workspace('diff', '--cached', '--name-only')) workspace('commit', '-m', `chore(workspace): sync canonical examples\n\n${TRAILER}: ${core}`);
  const sha = workspace('rev-parse', 'HEAD');
  // Confirm the tested Core is still current and preserve concurrent note commits.
  git('fetch', 'origin', 'core');
  if (git('rev-parse', 'origin/core') !== core) {
    output('synced', 'false');
    console.log('Core advanced during synchronization.');
    process.exit(0);
  }
  workspace('push', 'origin', 'HEAD:refs/heads/main');
  output('main_sha', sha);
  output('deploy_sha', core);
  output('synced', 'true');
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  if (worktree) {
    try {
      git('worktree', 'remove', '--force', worktree);
    } catch {}
  }
}
