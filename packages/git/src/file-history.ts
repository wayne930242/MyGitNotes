import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type HistoryEntry, isAgentEdit } from '@mygitnotes/core';
import { GitExecutionError, runGit } from './git-service.js';

const execFileAsync = promisify(execFile);
/** History reads show at most this much of a file; larger content shows a notice instead. */
export const HISTORY_READ_MAX_BYTES = 1024 * 1024;
const OBJECT_ID = /^[a-f0-9]{40}([a-f0-9]{24})?$/;

/** A file's content as Git stores it, or why it is not shown. */
export type HistoryContent = { blob: string; content: string; } | { blob: string; notice: 'binary' | 'too-large'; };

/**
 * One page of the commits that changed `file`, newest first, following renames. Each entry carries the file's path
 * and object id in that commit.
 */
export async function fileHistory(root: string, file: string, page: number, perPage = 50): Promise<{ entries: HistoryEntry[]; more: boolean; }> {
  const { stdout } = await runGit(['--literal-pathspecs', 'log', '--follow', '-M', '-z', '--raw', '--no-abbrev', '--format=%x1e%H%x1f%P%x1f%aI%x1f%an%x1f%B%x1f', `--skip=${(page - 1) * perPage}`, `-n${perPage + 1}`, '--', file], root);
  const entries: HistoryEntry[] = [];
  let current = file;
  for (const record of stdout.split('\x1e').slice(1)) {
    const end = record.indexOf('\x1f\0');
    const [commit, parents, date, author, message] = (end < 0 ? record : record.slice(0, end)).split('\x1f');
    const raw = end < 0 ? [] : record.slice(end + 2).replace(/^\n/, '').split('\0');
    let blob: string | undefined;
    if (raw[0]?.startsWith(':')) {
      const meta = raw[0].split(' ');
      blob = OBJECT_ID.test(meta[3]) && !/^0+$/.test(meta[3]) ? meta[3] : undefined;
      current = /^[RC]/.test(meta[4] || '') ? raw[2] : raw[1];
    }
    const [subject = '', ...rest] = message.replace(/\n+$/, '').split('\n');
    entries.push({ commit, parents: parents ? parents.split(' ') : [], date, author, subject, body: rest.join('\n').trim(), path: current, ...(blob ? { blob } : {}), agent: isAgentEdit(message) });
  }
  return { entries: entries.slice(0, perPage), more: entries.length > perPage };
}

async function catFile(root: string, args: string[]): Promise<Buffer> {
  try {
    const { stdout } = await execFileAsync('git', ['cat-file', ...args], { cwd: root, encoding: 'buffer', maxBuffer: HISTORY_READ_MAX_BYTES + 1024 });
    return stdout;
  } catch (error) {
    const failure = error as { message: string; stderr?: Buffer; code?: number; };
    throw new GitExecutionError(failure.message, failure.stderr?.toString() || '', failure.code);
  }
}

/** Reads a blob by its object id, bounded by the history read limit. Undefined when the object is not a blob here. */
export async function readHistoryBlob(root: string, blob: string): Promise<HistoryContent | undefined> {
  if (!OBJECT_ID.test(blob)) return;
  const type = await runGit(['cat-file', '-t', blob], root).then(result => result.stdout, () => '');
  if (type !== 'blob') return;
  if (Number((await runGit(['cat-file', '-s', blob], root)).stdout) > HISTORY_READ_MAX_BYTES) return { blob, notice: 'too-large' };
  const bytes = await catFile(root, ['blob', blob]);
  return bytes.includes(0) ? { blob, notice: 'binary' } : { blob, content: bytes.toString('utf8') };
}

/** Reads `file` as it was in `commit`; undefined when the commit does not hold it. */
export async function readFileAt(root: string, commit: string, file: string): Promise<HistoryContent | undefined> {
  if (!OBJECT_ID.test(commit)) return;
  const blob = await runGit(['rev-parse', '--verify', '--quiet', `${commit}:${file}`], root).then(result => result.stdout, () => '');
  return blob ? readHistoryBlob(root, blob) : undefined;
}

/** The author date of `commit` and the paths it changed, renamed paths under their new names. */
export async function commitDetails(root: string, commit: string): Promise<{ date: string; paths: string[]; } | undefined> {
  if (!OBJECT_ID.test(commit)) return;
  const date = await runGit(['show', '-s', '--format=%aI', `${commit}^{commit}`], root).then(result => result.stdout, () => '');
  if (!date) return;
  const { stdout } = await runGit(['diff-tree', '--root', '-r', '-M', '--no-commit-id', '--name-status', '-z', commit], root);
  const fields = stdout.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index++) {
    const status = fields[index];
    if (/^[RC]/.test(status)) {
      paths.push(fields[index + 2]);
      index += 2;
    } else {
      if (status !== 'D') paths.push(fields[index + 1]);
      index += 1;
    }
  }
  return { date, paths };
}

/** The current branch head, or undefined in a repository without commits. */
export async function headCommit(root: string): Promise<string | undefined> {
  return runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], root).then(result => result.stdout || undefined, () => undefined);
}

/** The object id Git would store for the worktree copy of `file`. */
export async function worktreeBlob(root: string, file: string): Promise<string> {
  return (await runGit(['--literal-pathspecs', 'hash-object', '--', file], root)).stdout;
}
