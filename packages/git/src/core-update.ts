import path from 'node:path';
import fs from 'node:fs';
import { runGit, getCurrentBranch, getGitStatus } from './git-service.js';
import { CoreUpdateOptions, CoreUpdateResult } from './types.js';
import { loadWorkspaceConfig, migrateWorkspace, resolveWorkspaceConfigPath } from '@mygitnotes/core';
import { mergeWorkspaceCore } from '../../../scripts/lib/workspace-agent-merge.mjs';

export class CoreUpdateError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'CoreUpdateError';
  }
}

/**
 * Discovers whether the Core branch should be fetched from 'upstream' or 'origin'.
 */
export async function discoverCoreRemote(repoRoot: string): Promise<'upstream' | 'origin'> {
  const { stdout } = await runGit(['remote'], repoRoot);
  const remotes = stdout.split('\n').map((r) => r.trim()).filter(Boolean);

  if (remotes.includes('upstream')) {
    return 'upstream';
  }
  if (remotes.includes('origin')) {
    return 'origin';
  }

  throw new CoreUpdateError(
    'No suitable Git remote found. Expected "upstream" or "origin".',
    'NO_REMOTE'
  );
}

const backfillHint = (count: number) => count > 0
  ? ` ${count} note(s) are missing created/updated. Run \`pnpm backfill-note-timestamps\` and review the diff.`
  : '';

/**
 * The checkout a Core update applies to: a `core` app checkout serving a separate workspace updates
 * itself; otherwise the served workspace is a fork-model `main` that merges Core.
 */
export async function coreUpdateCheckout(appRoot: string, workspaceRoot: string): Promise<string> {
  if (appRoot === workspaceRoot) return workspaceRoot;
  return (await getCurrentBranch(appRoot)) === 'core' ? appRoot : workspaceRoot;
}

/**
 * Executes the safe, non-destructive Core update workflow.
 * A `core` checkout fast-forwards; a fork-model `main` that still tracks product files merges Core.
 */
export async function updateCore(options: CoreUpdateOptions): Promise<CoreUpdateResult> {
  const { repoRoot, autoPush = false } = options;

  // 1. Detect repository root
  let root: string;
  try {
    root = (await runGit(['rev-parse', '--show-toplevel'], repoRoot)).stdout;
  } catch {
    throw new CoreUpdateError(`Not a valid Git repository: '${repoRoot}'`, 'NOT_GIT_REPO');
  }
  if (fs.realpathSync(root) !== fs.realpathSync(repoRoot)) {
    throw new CoreUpdateError('The workspace path must be the repository root.', 'NOT_REPO_ROOT');
  }

  // 2. Core checkouts fast-forward; fork-model workspaces merge into main.
  const currentBranch = await getCurrentBranch(repoRoot);
  if (currentBranch !== 'main' && currentBranch !== 'core') {
    throw new CoreUpdateError(
      `Core updates run on the 'core' checkout, or on a fork-model 'main' workspace. Current active branch is '${currentBranch}'.`,
      'INVALID_BRANCH'
    );
  }

  // 3. Refuse to continue with a dirty working tree
  const status = await getGitStatus(repoRoot);
  if (!status.isClean) {
    const dirtyItems = [...status.staged, ...status.modified, ...status.untracked].join(', ');
    throw new CoreUpdateError(
      `Working tree has uncommitted modifications (${dirtyItems}). Commit or clean working directory before updating Core. Auto-stash is strictly prohibited.`,
      'DIRTY_WORKING_TREE'
    );
  }

  // 4. Discover remote
  const remote = await discoverCoreRemote(repoRoot);

  // 5. Fetch the remote Core branch
  try {
    await runGit(['fetch', remote, 'core'], repoRoot);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CoreUpdateError(`Failed to fetch ${remote}/core: ${message}`, 'FETCH_FAILED');
  }

  // 6. Compare current vs available Core revision
  const { stdout: currentHash } = await runGit(['rev-parse', 'HEAD'], repoRoot);
  const { stdout: coreRemoteHash } = await runGit(['rev-parse', `${remote}/core`], repoRoot);

  // Check if already up to date
  let isAncestor = false;
  try {
    await runGit(['merge-base', '--is-ancestor', `${remote}/core`, 'HEAD'], repoRoot);
    isAncestor = true;
  } catch {
    isAncestor = false;
  }

  if (isAncestor && currentBranch === 'core') {
    return {
      success: true,
      currentHash,
      coreRemoteHash,
      remoteUsed: remote,
      alreadyUpToDate: true,
      message: `Core is already up to date with ${remote}/core (${coreRemoteHash.slice(0, 7)}).`,
    };
  }

  if (currentBranch === 'core') {
    try {
      await runGit(['merge', '--ff-only', `${remote}/core`], repoRoot);
    } catch {
      throw new CoreUpdateError(
        `Local 'core' has commits that ${remote}/core does not. Core only fast-forwards from upstream; move local work to another branch first.`,
        'CORE_DIVERGED'
      );
    }
    if (autoPush) await runGit(['push', 'origin', 'core'], repoRoot);
    // This process still runs the previous Core; the new Core migrates the workspace.
    return {
      success: true,
      currentHash,
      coreRemoteHash,
      remoteUsed: remote,
      alreadyUpToDate: false,
      message: `Fast-forwarded core to ${remote}/core (${coreRemoteHash.slice(0, 7)}). Run \`pnpm migrate-workspace\` and restart the dev server.`,
    };
  }

  // A converted main holds only content; merging Core would bring the product back.
  const tracks = async (revision: string) => Boolean((await runGit(['ls-tree', '--name-only', revision, '--', 'pnpm-workspace.yaml'], repoRoot)).stdout);
  if (await tracks(coreRemoteHash) && !await tracks('HEAD')) {
    throw new CoreUpdateError(
      `'main' holds only workspace content. Update the 'core' checkout instead: run \`pnpm update-core\` there.`,
      'CONTENT_ONLY_MAIN'
    );
  }

  if (isAncestor) {
    return {
      success: true,
      currentHash,
      coreRemoteHash,
      remoteUsed: remote,
      alreadyUpToDate: true,
      message: `Workspace is already up to date with ${remote}/core (${coreRemoteHash.slice(0, 7)}).`,
    };
  }

  // 7. Protect workspace Agent settings before any merge commit is created.
  const { pending, conflictedFiles } = mergeWorkspaceCore(repoRoot, coreRemoteHash);
  if (conflictedFiles.length) {
    return {
      success: false,
      currentHash,
      coreRemoteHash,
      remoteUsed: remote,
      conflictedFiles,
      message: `Merge conflict encountered when merging ${remote}/core. Conflict files: ${conflictedFiles.join(
        ', '
      )}. Git merge state preserved for manual resolution. Destructive reset or auto-stash was not used.`,
    };
  }

  // 8. Run versioned workspace migrations if required
  let notesMissingTimestamps = 0;
  const configPath = resolveWorkspaceConfigPath(repoRoot);
  if (configPath) {
    const migration = migrateWorkspace(repoRoot);
    notesMissingTimestamps = migration.notesMissingTimestamps;
    if (migration.migrated) await runGit(['add', '--', configPath], repoRoot);
  }

  // 9. Validate the workspace after merge
  try {
    loadWorkspaceConfig(repoRoot);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CoreUpdateError(`Post-merge workspace validation failed: ${msg}`, 'VALIDATION_FAILED');
  }

  if (pending) {
    await runGit(['commit', '-m', `chore(core): merge ${remote}/core (${coreRemoteHash.slice(0, 7)}) into main`], repoRoot);
  }

  // 15. Do not auto-push unless explicitly requested
  if (autoPush) {
    await runGit(['push', 'origin', 'main'], repoRoot);
  }

  return {
    success: true,
    currentHash,
    coreRemoteHash,
    remoteUsed: remote,
    alreadyUpToDate: false,
    notesMissingTimestamps,
    message: `Successfully merged ${remote}/core (${coreRemoteHash.slice(0, 7)}) into main.${backfillHint(notesMissingTimestamps)}`,
  };
}
