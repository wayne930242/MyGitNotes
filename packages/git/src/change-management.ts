import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { addVersion, type NoteVersionFile, readVersionFile, resolveSafePath, serializeVersionFile, versionFilePath, type VersionLabel } from '@mygitnotes/core';
import { runGit, stageAndCommit } from './git-service.js';
import { headCommit, worktreeBlob } from './file-history.js';

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
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  }).catch(() => {});
  return next;
}
function regularFile(root: string, file: string) {
  if (path.isAbsolute(file) || file !== path.posix.normalize(file) || file.includes('\\') || file === '.' || file.startsWith('.git/')) throw new Error('An exact repository-relative file is required.');
  const target = resolveSafePath(root, file);
  let ancestor = target;
  while (ancestor !== path.resolve(root)) {
    try {
      if (fs.lstatSync(ancestor).isSymbolicLink()) throw new Error('Symbolic links cannot be managed.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
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
    try {
      const target = regularFile(root, file);
      if (fs.existsSync(target)) bytes = fs.readFileSync(target);
    } catch {
      available = false;
    }
    const conflict = x === 'U' || y === 'U' || ['AA', 'DD'].includes(x + y);
    return { path: file, staged: x !== ' ' && x !== '?', unstaged: y !== ' ' || x === '?', kind: conflict ? 'conflict' : x === 'D' || y === 'D' ? 'deleted' : !committed.has(file) ? 'added' : 'modified', tracked: committed.has(file), available: available && !conflict && !committed.get(file)?.startsWith('120000') && !staged.get(file)?.startsWith('120000'), revision: createHash('sha256').update(record).update(committed.get(file) || '').update(staged.get(file) || '').update(bytes).digest('hex') };
  });
}

export async function changeFile(root: string, file: string, action: 'stage' | 'unstage' | 'restore', revision: string): Promise<{ backup?: string; }> {
  return exclusive(root, async () => {
    const target = regularFile(root, file);
    const change = (await listChanges(root)).find(entry => entry.path === file);
    if (!change || !change.available || change.revision !== revision) throw new Error('This file changed. Refresh and review it again.');
    const literal = `:(literal)${file}`;
    if (action === 'stage') {
      await runGit(['add', '--', literal], root);
      return {};
    }
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

/** What a New version records with a note's commit: the note, and the name and note a person gave the version. */
export interface NewVersion {
  path: string;
  label: VersionLabel;
  /** The person's day, `YYYY-MM-DD`, for the version's date number. */
  today: string;
}

/** A commit time at second precision, which Git reads as an author date. */
const commitTime = (now: Date) => now.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Commit the reviewed working copies without including unrelated index entries. With `version`, the one selected
 * note's version file joins the same commit; the version names the head it was made on and the author date it got.
 */
export async function commitSelectedFiles(root: string, expected: Pick<FileChange, 'path' | 'revision'>[], message: string, version?: NewVersion) {
  return exclusive(root, async () => {
    const changes = await listChanges(root);
    if (!message.trim() || !expected.length || new Set(expected.map(file => file.path)).size !== expected.length || expected.some(file => !changes.some(current => current.path === file.path && current.available && current.revision === file.revision))) {
      throw new Error('Selected files changed. Refresh and review them before committing.');
    }
    if (!version) return stageAndCommit(root, expected.map(file => file.path), message);
    if (expected.length !== 1 || expected[0].path !== version.path) throw new Error('A new version commits its note alone.');
    const parent = await headCommit(root);
    if (!parent) throw new Error('Commit this note once before recording a version.');
    const blob = await worktreeBlob(root, version.path);
    const now = new Date(), authored = commitTime(now);
    const file = versionFilePath(version.path);
    const records = readVersionFiles(root, [file]);
    addVersion(records.get(file)!, { blob, parent, authored }, version.label, version.today, now);
    const restore = writeVersionFiles(root, records);
    return commitWritten(root, restore, () => stageAndCommit(root, [version.path, file], message, { authorDate: authored }));
  });
}

function readVersionFiles(root: string, files: string[]): Map<string, NoteVersionFile> {
  return new Map(files.map(file => {
    const target = regularFile(root, file);
    return [file, readVersionFile(fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null)];
  }));
}

/** Writes each version file, removing one left without versions; returns a function that puts the previous files back. */
function writeVersionFiles(root: string, records: Map<string, NoteVersionFile>) {
  const previous = new Map([...records.keys()].map(file => {
    const target = regularFile(root, file);
    return [target, fs.existsSync(target) ? fs.readFileSync(target) : null];
  }));
  const restore = () => {
    for (const [target, bytes] of previous) {
      if (bytes) fs.writeFileSync(target, bytes);
      else fs.rmSync(target, { force: true });
    }
  };
  for (const [file, record] of records) {
    const target = regularFile(root, file);
    if (!record.versions.length) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, serializeVersionFile(record), { flag: 'wx', mode: 0o644 });
    fs.renameSync(temporary, target);
  }
  return restore;
}

/** Commits `paths` after the version files were written, putting the version files back when the commit fails. */
async function commitWritten(root: string, restore: () => void, commit: () => Promise<{ commitHash: string; shortHash: string; } | null>) {
  try {
    return await commit();
  } catch (error) {
    restore();
    throw error;
  }
}

/**
 * Changes the version files of `files` together and commits them alone. `change` receives each file's versions by
 * the file's path and edits them in place; the commit holds only version files.
 */
export async function commitVersionChange(root: string, files: string[], change: (records: Map<string, NoteVersionFile>) => void, message: string) {
  return exclusive(root, async () => {
    const records = readVersionFiles(root, files.map(versionFilePath));
    const byFile = new Map(files.map(file => [file, records.get(versionFilePath(file))!]));
    change(byFile);
    const restore = writeVersionFiles(root, records);
    return commitWritten(root, restore, async () => {
      // A removed version file that Git never tracked has nothing to commit.
      const paths: string[] = [];
      for (const file of records.keys()) {
        if (fs.existsSync(regularFile(root, file)) || await runGit(['ls-files', '--error-unmatch', '--', `:(literal)${file}`], root).then(() => true, () => false)) paths.push(file);
      }
      return paths.length ? stageAndCommit(root, paths, message) : null;
    });
  });
}
