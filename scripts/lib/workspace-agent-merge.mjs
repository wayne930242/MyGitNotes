import { execFileSync } from 'node:child_process';

export const workspaceAgentRoots = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.agents', '.codex', '.claude', '.agent'];
export const workspaceOwnedRoots = [...workspaceAgentRoots, '.github-notes-screen.yaml', '.github-notes-study.yaml', '.github-notes-focus.yaml'];

/** Merge without committing; the caller validates before committing or publishing. */
export function mergeWorkspaceCore(repoRoot, revision) {
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  if (git('status', '--porcelain').trim()) throw new Error('Workspace must be clean before merging Core.');
  const before = git('rev-parse', 'HEAD').trim();
  // Literal root paths include the complete namespace, including user deletions.
  const roots = workspaceOwnedRoots.filter(root =>
    git('ls-tree', '--name-only', before, '--', root).trim() || git('ls-tree', '--name-only', revision, '--', root).trim());
  let mergeError;
  try {
    git('merge', '--no-ff', '--no-commit', '--no-overwrite-ignore', '-Xno-renames', revision);
  } catch (error) { mergeError = error; }
  // A pre-merge failure must not trigger restoration or turn into a successful update.
  try { git('rev-parse', '--verify', 'MERGE_HEAD'); }
  catch { if (mergeError) throw mergeError; return { pending: false, conflictedFiles: [] }; }
  if (mergeError && !git('diff', '--name-only', '--diff-filter=U', '-z')) throw mergeError;
  if (roots.length) git('restore', `--source=${before}`, '--staged', '--worktree', '--', ...roots);
  const conflictedFiles = git('diff', '--name-only', '--diff-filter=U', '-z').split('\0').filter(Boolean);
  return { pending: true, conflictedFiles };
}
