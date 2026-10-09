import { execFileSync } from 'node:child_process';
import { migrateWorkspace, PartialMigrationError, SUPPORTED_SCHEMA_VERSION } from '../packages/core/src/index.js';
import { memberWorktrees, resolveWorkspaceRoot } from './lib/workspace-root.js';

const git = (root: string, args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
/** True inside a Git worktree, a workspace in a subdirectory of one included. */
const isGitWorktree = (root: string) => {
  try {
    return git(root, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
};
/** The commit subject: a manifest that only moved its schema_version says so; a Screen conversion names that. */
const message = (touched: string[]) => touched.length === 1 && /(^|\/)\.(mygitnotes|github-notes)\.yaml$/.test(touched[0]) ? `chore: migrate the workspace manifest to schema ${SUPPORTED_SCHEMA_VERSION}` : 'chore: migrate Screen lanes to compilations';
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

/** The files are written and the Screen file is gone, so a re-run cannot see them: the user has to commit these. */
function reportUncommitted(repositories: { root: string; touched: string[]; reason?: string; }[]) {
  for (const { root, touched, reason } of repositories) {
    const files = touched.map(quote).join(' ');
    console.error(`[migrate-workspace] ${root}: the migration was written but not committed${reason ? ` (${reason})` : ''}. Commit it yourself:\n  git -C ${quote(root)} add --all -- ${files} && git -C ${quote(root)} commit -m ${quote(message(touched))} --only -- ${files}`);
  }
}

/** The files of `files` with uncommitted changes, untracked ones included. A directory that is not a Git worktree has none to lose. */
function dirtyFiles(root: string, files: string[]): string[] {
  if (!isGitWorktree(root)) return [];
  return git(root, ['status', '--porcelain', '-z', '--', ...files]).split('\0').filter(Boolean).map(entry => entry.slice(3));
}

try {
  const root = resolveWorkspaceRoot();
  // Every member worktree mygitnotes.server.yaml maps migrates from its own manifest.
  const { migrated, notesMissingTimestamps, repositories } = migrateWorkspace(root, { worktrees: memberWorktrees(root).slice(1), dirtyFiles });
  const uncommitted: { root: string; touched: string[]; reason: string; }[] = [];
  for (const repository of repositories) {
    const detail = `${repository.compilations} compilation(s)${repository.droppedFocusTabs ? `, ${repository.droppedFocusTabs} Focus tab(s) of deleted lanes dropped` : ''}`;
    if (!isGitWorktree(repository.root)) {
      console.log(`[migrate-workspace] ${repository.root}: ${detail}. Not a Git worktree, so nothing was committed.`);
      continue;
    }
    try {
      git(repository.root, ['add', '--all', '--', ...repository.touched]);
      git(repository.root, ['commit', '-m', message(repository.touched), '--only', '--', ...repository.touched]);
      console.log(`[migrate-workspace] ${repository.root}: ${detail}. Committed.`);
    } catch (error) {
      uncommitted.push({ root: repository.root, touched: repository.touched, reason: String((error as { stderr?: unknown; }).stderr || (error as Error).message).trim().split('\n')[0] });
    }
  }
  if (uncommitted.length) {
    reportUncommitted(uncommitted);
    process.exit(1);
  }
  console.log(migrated ? `[migrate-workspace] Migrated ${root}.` : `[migrate-workspace] ${root} is already current.`);
  if (notesMissingTimestamps > 0) console.log(`[migrate-workspace] ${notesMissingTimestamps} note(s) are missing created/updated. Run \`pnpm backfill-note-timestamps\` and review the diff.`);
} catch (error) {
  console.error(`[migrate-workspace] ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof PartialMigrationError) reportUncommitted(error.applied.filter(repository => isGitWorktree(repository.root)));
  process.exit(1);
}
