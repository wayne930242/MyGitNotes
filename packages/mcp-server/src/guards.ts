import { getCurrentBranch } from '@github-notes/git';
import { resolveSafePath } from '@github-notes/core';

export class MCPGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MCPGuardError';
  }
}

/**
 * Asserts that the current git branch is an allowed user workspace branch (default: main).
 * Prevents agents from mutating user data or creating notes while on the 'core' product branch.
 */
export async function assertUserWorkspaceBranch(
  repoRoot: string,
  allowedBranches: string[] = ['main']
): Promise<void> {
  const currentBranch = await getCurrentBranch(repoRoot);
  if (!allowedBranches.includes(currentBranch)) {
    throw new MCPGuardError(
      `User content modifications are restricted to workspace branch (${allowedBranches.join(
        ', '
      )}). Current branch is '${currentBranch}'. Switch to 'main' before modifying notes.`
    );
  }
}

/**
 * Validates that a path is safe and strictly inside repository root.
 */
export function assertSafeRepoPath(repoRoot: string, relPath: string): string {
  return resolveSafePath(repoRoot, relPath);
}
