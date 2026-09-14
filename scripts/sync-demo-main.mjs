import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mergeWorkspaceCore } from './lib/workspace-agent-merge.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const output = (key, value) => {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
};
try {
  if (git('status', '--porcelain')) throw Error('Release checkout must be clean.');
  git('fetch', 'origin', 'core', 'main');
  const core = git('rev-parse', 'origin/core');
  const expected = process.env.CORE_REVISION || core;
  if (expected !== core) { output('synced', 'false'); console.log('A newer Core revision superseded this run.'); process.exit(0); }
  const previousBase = git('merge-base', 'origin/core', 'origin/main');
  const oldTemplates = git('ls-tree', '-r', '--name-only', previousBase, '--', 'examples/demo-workspace/notes').split('\n').filter(Boolean);
  git('checkout', '-B', 'release-main', 'origin/main');
  const merge = mergeWorkspaceCore(process.cwd(), core);
  if (merge.conflictedFiles.length) throw Error(`Core merge conflicts: ${merge.conflictedFiles.join(', ')}`);
  const template = 'examples/demo-workspace';
  const copied = [];
  const safeTarget = relative => {
    const target = path.resolve(relative);
    let ancestor = target;
    while (!fs.existsSync(ancestor)) {
      try { if (fs.lstatSync(ancestor).isSymbolicLink()) throw Error(`Dangling workspace symlink: ${relative}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      ancestor = path.dirname(ancestor);
    }
    const real = path.relative(fs.realpathSync('.'), fs.realpathSync(ancestor));
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
  copy('.github-notes.yaml');
  if (fs.existsSync(path.join(template, '.github-notes-screen.yaml'))) copy('.github-notes-screen.yaml');
  walk('notes');
  for (const old of oldTemplates) {
    const relative = old.slice(template.length + 1);
    if (copied.includes(relative)) continue;
    if (fs.existsSync(safeTarget(relative))) {
      if (fs.readFileSync(relative, 'utf8') !== execFileSync('git', ['show', `${previousBase}:${old}`], { encoding: 'utf8' })) throw Error(`Removed template has workspace edits: ${relative}`);
      fs.unlinkSync(relative); copied.push(relative);
    }
  }
  git('add', '--', ...copied);
  if (merge.pending || git('diff', '--cached', '--name-only')) git('commit', '-m', 'chore(workspace): merge Core and sync canonical examples');
  const sha = git('rev-parse', 'HEAD');
  git('merge-base', '--is-ancestor', core, sha);
  // Confirm the tested Core is still current and preserve concurrent note commits.
  git('fetch', 'origin', 'core');
  if (git('rev-parse', 'origin/core') !== core) { output('synced', 'false'); console.log('Core advanced during synchronization.'); process.exit(0); }
  git('push', 'origin', 'HEAD:refs/heads/main');
  output('main_sha', sha); output('synced', 'true');
} catch (error) {
  try { git('merge', '--abort'); } catch {}
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
}
