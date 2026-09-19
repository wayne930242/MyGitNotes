import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { planWorkspaceConversion } from './lib/workspace-conversion.mjs';

// Converts a fork-model main into workspace content only: one commit, no history rewrite, no push.
const arg = name => { const index = process.argv.indexOf(name); if (index < 0) return; const value = process.argv[index + 1]; if (!value || value.startsWith('--')) throw Error(`${name} requires a value.`); return value; };
try {
  const repoRoot = path.resolve(arg('--workspace') ?? process.cwd());
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
  if (fs.realpathSync(git('rev-parse', '--show-toplevel')) !== fs.realpathSync(repoRoot)) throw Error('The workspace path must be the repository root.');
  if (git('branch', '--show-current') !== 'main') throw Error("Run the conversion on the workspace branch 'main'.");
  if (git('status', '--porcelain')) throw Error('Commit or clean the working tree before converting.');
  if (!git('ls-files', '--', 'pnpm-workspace.yaml')) throw Error("'main' already holds only workspace content.");
  let coreRevision = arg('--core');
  if (!coreRevision) {
    const remotes = git('remote').split('\n');
    const remote = remotes.includes('upstream') ? 'upstream' : remotes.includes('origin') ? 'origin' : undefined;
    if (!remote) throw Error('No upstream or origin remote. Pass --core <revision>.');
    git('fetch', remote, 'core');
    coreRevision = `${remote}/core`;
  }
  // The Core revision main last merged decides which shared-namespace files are unmodified product copies.
  const merged = git('merge-base', 'HEAD', coreRevision);
  const { remove, kept } = planWorkspaceConversion(repoRoot, merged);
  for (let index = 0; index < remove.length; index += 500) git('rm', '-q', '--', ...remove.slice(index, index + 500));
  git('commit', '-q', '-m', `chore(workspace): keep only workspace content on main\n\nRemoves the product files merged from Core ${merged.slice(0, 7)}. The product now lives on 'core'.`);
  console.log(`[convert-workspace] Removed ${remove.length} product file(s) in ${git('rev-parse', '--short', 'HEAD')}.`);
  if (kept.length) console.log(`[convert-workspace] Kept workspace-owned files inside Core namespaces:\n${kept.map(file => `  ${file}`).join('\n')}`);
  console.log("[convert-workspace] Next: check out 'core' in a separate worktree, set MYGITNOTES_LOCAL_PATH there to this checkout, and delete leftover ignored build output here (node_modules, dist).");
} catch (error) {
  console.error(`[convert-workspace] ${error.stderr?.toString().trim() || error.message}`);
  process.exitCode = 1;
}
