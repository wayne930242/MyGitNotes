import fs from 'node:fs';
import path from 'node:path';
import { getCurrentBranch } from '@mygitnotes/git';
import { isVersionFile, resolveSafePath, workspaceDocument } from '@mygitnotes/core';

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
export async function assertUserWorkspaceBranch(repoRoot: string, allowedBranches: string[] = ['main']): Promise<void> {
  const currentBranch = await getCurrentBranch(repoRoot);
  if (!allowedBranches.includes(currentBranch)) {
    throw new MCPGuardError(`User content modifications are restricted to workspace branch (${allowedBranches.join(', ')}). Current branch is '${currentBranch}'. Switch to 'main' before modifying notes.`);
  }
}

/**
 * Validates that a path is safe and strictly inside repository root.
 */
export function assertSafeRepoPath(repoRoot: string, relPath: string): string {
  return resolveSafePath(repoRoot, relPath);
}

/** Intentional Git document edits use document APIs, never note mutation handlers. */
export function assertNoteResource(repoRoot: string, relPath: string): string {
  const absolute = assertSafeRepoPath(repoRoot, relPath);
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const real = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, absolute));
  const relative = path.relative(fs.realpathSync(repoRoot), real).split(path.sep).join('/');
  if (workspaceDocument(relative) || isVersionFile(relative)) throw new MCPGuardError('Workspace metadata is protected.');
  return absolute;
}
