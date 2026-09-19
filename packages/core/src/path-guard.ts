import path from 'node:path';
import fs from 'node:fs';

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathTraversalError';
  }
}

export class SymlinkEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SymlinkEscapeError';
  }
}

/**
 * Resolves and validates a target relative path against a repository root.
 * Guarantees that the resulting absolute path resides strictly within the repo root.
 * Rejects traversal patterns, null bytes, and symlinks pointing outside the repo.
 */
export function resolveSafePath(repoRoot: string, targetPath: string): string {
  if (!repoRoot) {
    throw new Error('repoRoot must not be empty');
  }
  if (!targetPath) {
    throw new Error('targetPath must not be empty');
  }

  const portable = targetPath.replace(/\\/g, '/');
  if (portable.includes('\0') || portable.split('/').some(part => /^\.\.{1,}$/.test(part))) {
    throw new PathTraversalError('Path escapes repository root through parent traversal or contains a null byte');
  }
  const normalizedRepoRoot = path.resolve(repoRoot);
  const resolvedPath = path.resolve(normalizedRepoRoot, portable);
  const relative = path.relative(normalizedRepoRoot, resolvedPath);
  if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new PathTraversalError('Path escapes repository root');
  }
  // Validate the nearest existing ancestor, including writes to new files.
  let ancestor = resolvedPath;
  while (!fs.existsSync(ancestor)) {
    try {
      if (fs.lstatSync(ancestor).isSymbolicLink()) throw new SymlinkEscapeError('Dangling symlink in path');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const real = fs.realpathSync(ancestor);
  const realRoot = fs.realpathSync(normalizedRepoRoot);
  const realRelative = path.relative(realRoot, real);
  if (realRelative === '..' || realRelative.startsWith('../') || path.isAbsolute(realRelative)) {
    throw new SymlinkEscapeError('Symlink target escapes repository root');
  }

  return resolvedPath;
}

/**
 * Sanitizes a filename for safe asset / note naming.
 */
export function sanitizeFilename(filename: string): string {
  // Remove control characters, slashes, backslashes, path traversal
  const basename = path.basename(filename);
  return basename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}
