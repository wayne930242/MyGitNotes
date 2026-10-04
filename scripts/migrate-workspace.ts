import { execFileSync } from 'node:child_process';
import { loadRepositoryMappings, mapsRepository, migrateWorkspace, type MigrationWorktree, type WorkspaceConfig } from '../packages/core/src/index.js';
import { resolveWorkspaceRoot } from './lib/workspace-root.js';

const git = (root: string, args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
/** True inside a Git worktree, a workspace in a subdirectory of one included. */
const isGitWorktree = (root: string) => {
  try {
    return git(root, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
};
const MESSAGE = 'chore: migrate Screen lanes to compilations';

/** The files of `files` with uncommitted changes, untracked ones included. A directory that is not a Git worktree has none to lose. */
function dirtyFiles(root: string, files: string[]): string[] {
  if (!isGitWorktree(root)) return [];
  return git(root, ['status', '--porcelain', '-z', '--', ...files]).split('\0').filter(Boolean).map(entry => entry.slice(3));
}

try {
  const root = resolveWorkspaceRoot();
  // A notebook in its own repository migrates in the worktree mygitnotes.server.yaml maps to it.
  const mappings = loadRepositoryMappings(process.cwd());
  const worktrees = (config: WorkspaceConfig) => {
    const found: MigrationWorktree[] = [];
    for (const notebook of config.notebooks) {
      const { source } = notebook;
      if (!source) continue;
      const mapped = mappings.find(mapping => mapsRepository(mapping, source))?.path;
      if (!mapped) {
        console.log(`[migrate-workspace] Skipped notebook ${notebook.id}: no worktree is mapped for ${source.repository} in mygitnotes.server.yaml. Run this command again once it is mapped.`);
        continue;
      }
      const existing = found.find(worktree => worktree.root === mapped);
      if (existing) existing.notebooks.push(notebook);
      else found.push({ root: mapped, notebooks: [notebook] });
    }
    return found;
  };
  const { migrated, notesMissingTimestamps, repositories } = migrateWorkspace(root, { worktrees, dirtyFiles });
  const uncommitted: { root: string; touched: string[]; reason: string; }[] = [];
  for (const repository of repositories) {
    const detail = `${repository.compilations} compilation(s)${repository.droppedFocusTabs ? `, ${repository.droppedFocusTabs} Focus tab(s) of deleted lanes dropped` : ''}`;
    if (!isGitWorktree(repository.root)) {
      console.log(`[migrate-workspace] ${repository.root}: ${detail}. Not a Git worktree, so nothing was committed.`);
      continue;
    }
    try {
      git(repository.root, ['add', '--all', '--', ...repository.touched]);
      git(repository.root, ['commit', '-m', MESSAGE, '--only', '--', ...repository.touched]);
      console.log(`[migrate-workspace] ${repository.root}: ${detail}. Committed.`);
    } catch (error) {
      uncommitted.push({ root: repository.root, touched: repository.touched, reason: String((error as { stderr?: unknown; }).stderr ?? (error as Error).message).trim().split('\n')[0] });
    }
  }
  if (uncommitted.length) {
    // The files are already written and the Screen file is gone, so a re-run cannot see them: the user has to commit these.
    for (const { root: failed, touched, reason } of uncommitted) {
      console.error(`[migrate-workspace] ${failed}: the migration was written but not committed (${reason}). Commit it yourself:\n  git -C '${failed}' add --all -- ${touched.map(file => `'${file}'`).join(' ')} && git -C '${failed}' commit -m '${MESSAGE}' --only -- ${touched.map(file => `'${file}'`).join(' ')}`);
    }
    process.exit(1);
  }
  console.log(migrated ? `[migrate-workspace] Migrated ${root}.` : `[migrate-workspace] ${root} is already current.`);
  if (notesMissingTimestamps > 0) console.log(`[migrate-workspace] ${notesMissingTimestamps} note(s) are missing created/updated. Run \`pnpm backfill-note-timestamps\` and review the diff.`);
} catch (error) {
  console.error(`[migrate-workspace] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
