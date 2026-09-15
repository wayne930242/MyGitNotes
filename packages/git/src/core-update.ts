import path from 'node:path';
import fs from 'node:fs';
import { runGit, getCurrentBranch, getGitStatus } from './git-service.js';
import { CoreUpdateOptions, CoreUpdateResult } from './types.js';
import { loadWorkspaceConfig, WORKSPACE_CONFIG_FILENAME, scanNotebookNotes } from '@mygitnotes/core';
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

/**
 * Executes the safe, non-destructive Core update workflow.
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

  // 2. Verify the active user branch is main
  const currentBranch = await getCurrentBranch(repoRoot);
  if (currentBranch !== 'main') {
    throw new CoreUpdateError(
      `Core updates can only be merged into the user workspace branch 'main'. Current active branch is '${currentBranch}'.`,
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
  const config = loadWorkspaceConfig(repoRoot);
  if (config) {
    // Check if schema_version needs migration
    if (config.schema_version < 1) {
      config.schema_version = 1;
      fs.writeFileSync(
        path.join(repoRoot, WORKSPACE_CONFIG_FILENAME),
        JSON.stringify(config, null, 2),
        'utf-8'
      );
    }
  }

  // Notes without created/updated predate this feature; point the user at the backfill command.
  let notesMissingTimestamps = 0;
  if (config) {
    for (const notebook of config.notebooks) {
      for (const note of scanNotebookNotes(repoRoot, notebook)) {
        if (!note.metadata.created || !note.metadata.updated) notesMissingTimestamps++;
      }
    }
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

  const backfillHint = notesMissingTimestamps > 0
    ? ` ${notesMissingTimestamps} note(s) are missing created/updated. Run \`pnpm backfill-note-timestamps\` and review the diff.`
    : '';

  return {
    success: true,
    currentHash,
    coreRemoteHash,
    remoteUsed: remote,
    alreadyUpToDate: false,
    notesMissingTimestamps,
    message: `Successfully merged ${remote}/core (${coreRemoteHash.slice(0, 7)}) into main.${backfillHint}`,
  };
}
