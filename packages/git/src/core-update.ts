import path from 'node:path';
import fs from 'node:fs';
import { runGit, getCurrentBranch, getGitStatus, GitExecutionError } from './git-service.js';
import { CoreUpdateOptions, CoreUpdateResult } from './types.js';
import { loadWorkspaceConfig, WORKSPACE_CONFIG_FILENAME } from '@github-notes/core';

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
  try {
    await runGit(['rev-parse', '--show-toplevel'], repoRoot);
  } catch {
    throw new CoreUpdateError(`Not a valid Git repository: '${repoRoot}'`, 'NOT_GIT_REPO');
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
    const dirtyItems = [...status.staged, ...status.modified].join(', ');
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

  // 7. Merge Core into main with normal Git merge semantics
  try {
    await runGit(
      ['merge', `${remote}/core`, '--no-edit', '-m', `chore(core): merge ${remote}/core (${coreRemoteHash.slice(0, 7)}) into main`],
      repoRoot
    );
  } catch (err: unknown) {
    // 10. Stop and explain conflicts rather than hiding them
    const { stdout: unmerged } = await runGit(
      ['diff', '--name-only', '--diff-filter=U'],
      repoRoot
    );
    const conflictedFiles = unmerged.split('\n').map((f) => f.trim()).filter(Boolean);

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

  // 9. Validate the workspace after merge
  try {
    loadWorkspaceConfig(repoRoot);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CoreUpdateError(`Post-merge workspace validation failed: ${msg}`, 'VALIDATION_FAILED');
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
    message: `Successfully merged ${remote}/core (${coreRemoteHash.slice(0, 7)}) into main.`,
  };
}
