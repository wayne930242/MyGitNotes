import fs from 'node:fs';
import { getCurrentBranch, getGitStatus, runGit } from './git-service.js';
import { CoreUpdateOptions, CoreUpdateResult } from './types.js';

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

  throw new CoreUpdateError('No suitable Git remote found. Expected "upstream" or "origin".', 'NO_REMOTE');
}

/**
 * Executes the safe, non-destructive Core update workflow: the `core` checkout fast-forwards.
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
    throw new CoreUpdateError('The product checkout path must be the repository root.', 'NOT_REPO_ROOT');
  }

  // 2. Only the 'core' checkout updates; 'main' holds workspace content.
  const currentBranch = await getCurrentBranch(repoRoot);
  if (currentBranch !== 'core') {
    throw new CoreUpdateError(`Core updates require the product checkout on branch 'core'. Current product branch: '${currentBranch}'.`, 'INVALID_BRANCH');
  }

  // 3. Refuse to continue with a dirty working tree
  const status = await getGitStatus(repoRoot);
  if (!status.isClean) {
    const dirtyItems = [...status.staged, ...status.modified, ...status.untracked].join(', ');
    throw new CoreUpdateError(`Working tree has uncommitted modifications (${dirtyItems}). Commit or clean working directory before updating Core. Auto-stash is strictly prohibited.`, 'DIRTY_WORKING_TREE');
  }

  // 4. Discover remote
  const remote = await discoverCoreRemote(repoRoot);

  // 5. Fetch the remote Core branch
  try {
    await runGit(['fetch', remote, `+refs/heads/core:refs/remotes/${remote}/core`], repoRoot, { timeout: 30000 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CoreUpdateError(`Failed to fetch ${remote}/core: ${message}`, 'FETCH_FAILED');
  }

  // 6. Compare current vs available Core revision
  const { stdout: currentHash } = await runGit(['rev-parse', 'HEAD'], repoRoot);
  const { stdout: coreRemoteHash } = await runGit(['rev-parse', `${remote}/core`], repoRoot);

  const counts = (await runGit(['rev-list', '--left-right', '--count', `${currentHash}...${coreRemoteHash}`], repoRoot)).stdout.split(/\s+/).map(Number);

  if (counts[1] === 0) {
    return { success: true, currentHash, coreRemoteHash, remoteUsed: remote, alreadyUpToDate: true, message: `Core is already up to date with ${remote}/core (${coreRemoteHash.slice(0, 7)}).` };
  }

  if (counts[0] > 0 && counts[1] > 0) {
    throw new CoreUpdateError('The product core branch and upstream have diverged. Move local product changes to another branch before updating.', 'CORE_DIVERGED');
  }
  try {
    await runGit(['merge', '--ff-only', coreRemoteHash], repoRoot);
  } catch {
    throw new CoreUpdateError('Core could not fast-forward. Check the product checkout for concurrent changes or Git errors, then retry.', 'UPDATE_FAILED');
  }
  if (autoPush) await runGit(['push', 'origin', 'core'], repoRoot);
  // This process still runs the previous Core; the new Core migrates the workspace.
  return { success: true, currentHash, coreRemoteHash, remoteUsed: remote, alreadyUpToDate: false, message: `Fast-forwarded core to ${remote}/core (${coreRemoteHash.slice(0, 7)}). Run \`pnpm migrate-workspace\` and restart the dev server.` };
}
