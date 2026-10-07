import fs from 'node:fs';
import path from 'node:path';
import { relocateVersionFiles, versionFilePath } from '@mygitnotes/core';
import { runGit } from '@mygitnotes/git';
import { regularPath } from './workspace-files.js';

/**
 * Carries the version files of `files` along a move or deletion in a local worktree, as uncommitted changes beside
 * the notes they follow. Returns the version files it changed.
 */
export function moveLocalVersionFiles(root: string, files: Iterable<string>, relocate: (file: string) => string, removed: (file: string) => boolean): string[] {
  const present = [...new Set([...files].map(versionFilePath))].filter(file => fs.existsSync(regularPath(root, file)));
  const changed: string[] = [];
  for (const { from, to } of relocateVersionFiles(present, relocate, removed)) {
    const source = regularPath(root, from);
    if (to) {
      const target = regularPath(root, to);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(source, target);
      changed.push(to);
    } else fs.unlinkSync(source);
    changed.push(from);
  }
  return changed;
}

/** Puts back a note's version file that a deletion removed from the worktree, as the last commit holds it. */
export async function restoreLocalVersionFile(root: string, file: string): Promise<void> {
  const versionFile = versionFilePath(file);
  if (fs.existsSync(regularPath(root, versionFile))) return;
  const tracked = await runGit(['cat-file', '-e', `HEAD:${versionFile}`], root).then(() => true, () => false);
  if (tracked) await runGit(['restore', '--source=HEAD', '--staged', '--worktree', '--', `:(literal)${versionFile}`], root);
}
