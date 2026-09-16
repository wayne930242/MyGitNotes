import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveSafePath } from '@mygitnotes/core';
import { runGit, stageAndCommit } from './git-service.js';

export interface FileChange {
  path: string;
  staged: boolean;
  unstaged: boolean;
  kind: 'added' | 'modified' | 'deleted' | 'conflict';
  tracked: boolean;
  revision: string;
  available?: boolean;
}
const queues = new Map<string, Promise<unknown>>();
export function exclusive<T>(root: string, action: () => Promise<T>): Promise<T> {
  const key = fs.realpathSync(root);
  const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(action);
  queues.set(key, next);
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}
function regularFile(root: string, file: string) {
  if (path.isAbsolute(file) || file !== path.posix.normalize(file) || file.includes('\\') || file === '.' || file.startsWith('.git/')) throw new Error('An exact repository-relative file is required.');
  const target = resolveSafePath(root, file);
  let ancestor = target;
  while (ancestor !== path.resolve(root)) {
    try { if (fs.lstatSync(ancestor).isSymbolicLink()) throw new Error('Symbolic links cannot be managed.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    ancestor = path.dirname(ancestor);
  }
  if (fs.existsSync(target) && !fs.statSync(target).isFile()) throw new Error('An exact regular file is required.');
  return target;
}

export async function listChanges(root: string): Promise<FileChange[]> {
  const { stdout } = await runGit(['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'], root);
  const head = await runGit(['ls-tree', '-r', '-z', 'HEAD'], root).catch(() => ({ stdout: '' }));
  const index = await runGit(['ls-files', '--stage', '-z'], root);
  const entries = (raw: string) => new Map(raw.split('\0').filter(Boolean).map(entry => [entry.slice(entry.indexOf('\t') + 1), entry.slice(0, entry.indexOf('\t'))]));
  const committed = entries(head.stdout), staged = entries(index.stdout);
  return stdout.split('\0').filter(Boolean).map(record => {
    const file = record.slice(3), x = record[0], y = record[1];
    let bytes: Buffer | string = '';
    let available = true;
    try { const target = regularFile(root, file); if (fs.existsSync(target)) bytes = fs.readFileSync(target); }
    catch { available = false; }
    const conflict = x === 'U' || y === 'U' || ['AA', 'DD'].includes(x + y);
    return { path: file, staged: x !== ' ' && x !== '?', unstaged: y !== ' ' || x === '?',
      kind: conflict ? 'conflict' : x === 'D' || y === 'D' ? 'deleted' : !committed.has(file) ? 'added' : 'modified',
      tracked: committed.has(file), available: available && !conflict && !committed.get(file)?.startsWith('120000') && !staged.get(file)?.startsWith('120000'),
      revision: createHash('sha256').update(record).update(committed.get(file) || '').update(staged.get(file) || '').update(bytes).digest('hex') };
  });
}

export async function changeFile(root: string, file: string, action: 'stage' | 'unstage' | 'restore', revision: string): Promise<{ backup?: string }> {
  return exclusive(root, async () => {
    const target = regularFile(root, file);
    const change = (await listChanges(root)).find(entry => entry.path === file);
    if (!change || !change.available || change.revision !== revision) throw new Error('This file changed. Refresh and review it again.');
    const literal = `:(literal)${file}`;
    if (action === 'stage') { await runGit(['add', '--', literal], root); return {}; }
    if (action === 'unstage') {
      if (change.tracked) await runGit(['restore', '--staged', '--source=HEAD', '--', literal], root);
      else await runGit(['rm', '--cached', '--force', '--', literal], root);
      return {};
    }
    // Keep a recoverable copy outside workspace contents before discarding edits.
    let backup: string | undefined;
    if (fs.existsSync(target)) {
      const gitPath = (await runGit(['rev-parse', '--git-path', 'github-notes-restores'], root)).stdout;
      const directory = path.resolve(root, gitPath, randomUUID());
      fs.mkdirSync(directory, { recursive: true });
      backup = path.join(directory, path.basename(file));
      fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
    }
    if (change.tracked) await runGit(['restore', '--source=HEAD', '--staged', '--worktree', '--', literal], root);
    else {
      if (change.staged) await runGit(['rm', '--cached', '--force', '--', literal], root);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    return { backup };
  });
}

export async function fileDiff(root: string, file: string, side: 'working' | 'staged' | 'current'): Promise<string> {
  const target = regularFile(root, file);
  const change = (await listChanges(root)).find(entry => entry.path === file);
  if (!change || !change.available) return '';
  if ((side === 'current' || side === 'working' && !change.staged) && !change.tracked && fs.existsSync(target)) {
    if (fs.statSync(target).size > 1024 * 1024) return 'File exceeds the 1 MiB preview limit.';
    const bytes = fs.readFileSync(target);
    if (bytes.includes(0)) return 'Binary file added.';
    const lines = bytes.toString('utf8').split('\n');
    return `--- /dev/null\n+++ ${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => '+' + line).join('\n')}`;
  }
  return (await runGit(['diff', '--no-ext-diff', '--no-textconv', ...(side === 'staged' ? ['--cached'] : side === 'current' ? ['HEAD'] : []), '--', `:(literal)${file}`], root)).stdout;
}

export async function commitStagedFiles(root: string, expected: Pick<FileChange, 'path' | 'revision'>[], message: string) {
  return exclusive(root, async () => {
    const staged = (await listChanges(root)).filter(file => file.staged);
    if (!message.trim() || !expected.length || expected.length !== staged.length || staged.some(file => !file.available || !expected.some(entry => entry.path === file.path && entry.revision === file.revision))) {
      throw new Error('Staged files changed. Review all staged files before committing.');
    }
    await runGit(['commit', '-m', message], root);
    return { commitHash: (await runGit(['rev-parse', 'HEAD'], root)).stdout };
  });
}

/** Commit the reviewed working copies without including unrelated index entries. */
export async function commitSelectedFiles(root: string, expected: Pick<FileChange, 'path' | 'revision'>[], message: string) {
  return exclusive(root, async () => {
    const changes = await listChanges(root);
    if (!message.trim() || !expected.length || new Set(expected.map(file => file.path)).size !== expected.length ||
      expected.some(file => !changes.some(current => current.path === file.path && current.available && current.revision === file.revision))) {
      throw new Error('Selected files changed. Refresh and review them before committing.');
    }
    return stageAndCommit(root, expected.map(file => file.path), message);
  });
}
