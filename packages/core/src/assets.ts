import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafePath, sanitizeFilename } from './path-guard.js';
import type { NotebookConfig } from './types.js';

export function assetHash(bytes: Buffer): string {
  return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
export function assetInfo(file: string, root: string, hash: string, size: number, mtime = 0) {
  const name = path.posix.basename(file);
  const relative = file.slice(root.length + 1);
  const rawUrl = `/raw-assets/by-hash/${hash}`;
  return { name, path: file, directory: path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative), hash, size, mtime, rawUrl, markdownRef: `![${name.replace(/[\\[\]]/g, '\\$&')}](${rawUrl})` };
}
export function assetRoot(nb: NotebookConfig) {
  return `${nb.root}/${nb.assets || 'assets'}`;
}
/** Validates an upload's folder and filename and joins them into a path relative to the assets root. */
export function assetSubPath(directory: unknown, filename: unknown) {
  if (typeof directory !== 'string' || directory.includes('\\') || directory.includes('\0') || (directory && directory.split('/').some(p => !p || p.startsWith('.')))) throw new Error('Use a folder path relative to the notebook assets directory.');
  if (typeof filename !== 'string' || !filename || filename.startsWith('.') || /[/\\\0]/.test(filename)) throw new Error('Use a filename without path segments.');
  return `${directory ? directory + '/' : ''}${sanitizeFilename(filename)}`;
}
export function assetPath(nb: NotebookConfig, directory: unknown, filename: unknown) {
  return `${assetRoot(nb)}/${assetSubPath(directory, filename)}`;
}
export function isAssetPath(file: string, nb: NotebookConfig) {
  const prefix = assetRoot(nb) + '/';
  return file.startsWith(prefix) && !file.includes('\\') && !file.includes('\0') && file.slice(prefix.length).split('/').every(p => p && !p.startsWith('.'));
}
/** Bytes a repository upload accepts; a Git-bound binary lives in history forever. */
export const ASSET_SIZE_LIMIT = 3 * 1024 * 1024;

/** Decodes an upload payload, rejecting anything past `limit`; pass Infinity for bucket-bound files. */
export function decodeAsset(value: unknown, limit = ASSET_SIZE_LIMIT): Buffer {
  if (typeof value !== 'string') throw new Error('base64Content is required.');
  const raw = value.replace(/^data:[^,]*;base64,/, '');
  // A quantified group over the whole payload overruns the regex stack on a multi-megabyte upload,
  // so the quads are counted instead of matched.
  if (raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new Error('Invalid base64 file.');
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length > limit) throw new Error(`Uploads support files up to ${Math.round(limit / (1024 * 1024))} MiB.`);
  return bytes;
}
export function scanAssets(repoRoot: string, nb: NotebookConfig) {
  const root = assetRoot(nb);
  const result: ReturnType<typeof assetInfo>[] = [];
  const visit = (relative: string) => {
    const full = resolveSafePath(repoRoot, relative);
    if (!fs.existsSync(full) || fs.lstatSync(full).isSymbolicLink()) return;
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = relative + '/' + entry.name;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        const target = resolveSafePath(repoRoot, file);
        const stat = fs.statSync(target);
        const hash = crypto.createHash('sha1').update(`blob ${stat.size}\0`);
        const fd = fs.openSync(target, 'r');
        const buffer = Buffer.alloc(65536);
        try {
          let count: number;
          while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count));
        } finally {
          fs.closeSync(fd);
        }
        result.push(assetInfo(file, root, hash.digest('hex'), stat.size, stat.mtimeMs));
      }
    }
  };
  visit(root);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
