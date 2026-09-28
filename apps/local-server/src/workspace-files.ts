import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { type RemoteSnapshot, type RemoteSource, resolveSafePath, SourceError } from '@mygitnotes/core';

/** Content revision of a local workspace file; `missing` while the file is absent. */
export const revisionOf = (text: string | null) => text === null ? 'missing' : createHash('sha256').update(text).digest('hex');

/** Resolves a workspace path and rejects any existing symlink along it; missing segments are allowed. */
export function regularPath(root: string, file: string) {
  const full = resolveSafePath(root, file);
  let cursor = root;
  for (const part of file.split('/')) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new SourceError('Symlinks are protected.', 403);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return full;
}

/** Writes through a sibling temporary file and a rename, so readers see either the old or the new content. */
export function writeFileAtomicSync(target: string, content: string | Buffer, mode = 0o600) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx', mode });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** Asynchronous form of {@link writeFileAtomicSync}. */
export async function writeFileAtomic(target: string, content: string, mode = 0o600) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fsp.writeFile(temporary, content, { flag: 'wx', mode });
    await fsp.rename(temporary, target);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
}

/** Reads a workspace file that must be a regular file of at most `maxBytes`; null when it is absent. `subject` names it in errors. */
export async function readBoundedFile(root: string, file: string, maxBytes: number, subject: string) {
  const target = path.join(root, file);
  try {
    const stat = await fsp.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new SourceError(`${subject} must be a regular file.`, 403);
    if (stat.size > maxBytes) throw new SourceError(`${subject} is too large.`, 413);
    return await fsp.readFile(target, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Reads a remote file as text when `snapshot` lists it; null otherwise. */
export async function readSnapshotText(reader: RemoteSource, snapshot: RemoteSnapshot, file: string) {
  return snapshot.entries.some(entry => entry.path === file) ? (await reader.readFile(file)).toString('utf8') : null;
}
