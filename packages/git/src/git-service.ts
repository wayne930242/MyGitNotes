import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { GitCommitItem, GitStatusResult } from './types.js';

const execFileAsync = promisify(execFile);

export class GitExecutionError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode?: number
  ) {
    super(message);
    this.name = 'GitExecutionError';
  }
}

/**
 * Runs a git command safely in a specified directory using execFile (no shell interpolation).
 */
export async function runGit(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return {
      stdout: result.stdout.replace(/[\r\n]+$/, ''),
      stderr: result.stderr.trim(),
    };
  } catch (err: unknown) {
    const error = err as { message: string; stderr?: string; code?: number };
    throw new GitExecutionError(
      error.message,
      error.stderr || '',
      error.code
    );
  }
}

/**
 * Gets the current active Git branch name.
 */
export async function getCurrentBranch(repoRoot: string): Promise<string> {
  const { stdout } = await runGit(['branch', '--show-current'], repoRoot);
  return stdout.trim();
}

/**
 * Inspects Git working tree status.
 */
export async function getGitStatus(repoRoot: string): Promise<GitStatusResult> {
  const branch = await getCurrentBranch(repoRoot);
  const { stdout } = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], repoRoot);

  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];

  if (stdout.length > 0) {
    const lines = stdout.split('\0');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line) continue;
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const filePath = line.slice(3);
      // In NUL mode a rename/copy emits destination first, then its original path.
      if ('RC'.includes(indexStatus) || 'RC'.includes(workTreeStatus)) index++;

      if (indexStatus !== ' ' && indexStatus !== '?') {
        staged.push(filePath);
      }
      if (workTreeStatus === 'M' || workTreeStatus === 'D') {
        modified.push(filePath);
      }
      if (indexStatus === '?' && workTreeStatus === '?') {
        untracked.push(filePath);
      }
    }
  }

  const isClean = staged.length === 0 && modified.length === 0 && untracked.length === 0;

  return {
    branch,
    isClean,
    staged,
    modified,
    untracked,
  };
}

/**
 * Stages specified files and creates a Git commit.
 */
export async function stageAndCommit(
  repoRoot: string,
  files: string[],
  message: string
): Promise<{ commitHash: string; shortHash: string }> {
  if (files.length === 0) {
    throw new Error('No files provided to stage and commit');
  }

  // Stage files
  await runGit(['add', '--', ...files.map(file => `:(literal)${file}`)], repoRoot);

  // Commit
  await runGit(['commit', '--only', '-m', message, '--', ...files.map(file => `:(literal)${file}`)], repoRoot);

  // Get commit hash
  const { stdout: hash } = await runGit(['rev-parse', 'HEAD'], repoRoot);
  const { stdout: shortHash } = await runGit(['rev-parse', '--short', 'HEAD'], repoRoot);

  return { commitHash: hash, shortHash };
}

/**
 * Gets git diff for working tree or specific file.
 */
export async function getDiff(repoRoot: string, filePath?: string): Promise<string> {
  const args = ['diff'];
  if (filePath) {
    args.push('--', filePath);
  }
  const { stdout } = await runGit(args, repoRoot);
  return stdout;
}

/**
 * Returns recent Git commits.
 */
export async function getRecentCommits(
  repoRoot: string,
  count = 10
): Promise<GitCommitItem[]> {
  try {
    const { stdout } = await runGit(
      ['log', `-${count}`, '--pretty=format:%H|%h|%s|%an|%ad', '--date=iso'],
      repoRoot
    );

    if (!stdout) return [];

    return stdout.split('\n').map((line) => {
      const [hash, shortHash, message, author, date] = line.split('|');
      return { hash, shortHash, message, author, date };
    });
  } catch {
    return [];
  }
}

/**
 * Returns the author date of a path's first and last commit (following
 * renames), as ISO 8601 UTC strings. Used by the note-timestamps backfill.
 */
export async function getFirstAndLastCommitDates(
  repoRoot: string,
  relPath: string
): Promise<{ first?: string; last?: string }> {
  try {
    const { stdout } = await runGit(['log', '--follow', '--format=%aI', '--', relPath], repoRoot);
    if (!stdout) return {};
    const dates = stdout.split('\n').filter(Boolean).map(date => new Date(date).toISOString());
    if (dates.length === 0) return {};
    return { first: dates[dates.length - 1], last: dates[0] };
  } catch {
    return {};
  }
}
