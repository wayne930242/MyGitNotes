import fs from 'node:fs';
import path from 'node:path';
import { exclusive } from './change-management.js';
import { GitExecutionError, getCurrentBranch, runGit } from './git-service.js';

export type SyncStrategy = 'remote' | 'local';
export type SyncErrorCode = 'INVALID_BRANCH' | 'NO_UPSTREAM' | 'DIRTY' | 'CONFLICT' | 'UNRESOLVED' | 'FAILED';

export interface SyncResult {
  upstream: string;
  pulled: number;
  pushed: number;
  backup?: string;
}

export class SyncError extends Error {
  constructor(message: string, public readonly code: SyncErrorCode, public readonly files: string[] = []) {
    super(message);
    this.name = 'SyncError';
  }
}

const NETWORK_TIMEOUT = 60_000;
const count = async (root: string, range: string) => Number((await runGit(['rev-list', '--count', range], root)).stdout.trim());
const gitMessage = (error: unknown) => error instanceof GitExecutionError ? error.stderr.trim() || error.message : (error as Error).message;

/** Network commands fail instead of waiting for a credential prompt. */
async function networkOptions(root: string) {
  const ssh = process.env.GIT_SSH_COMMAND
    || (await runGit(['config', '--get', 'core.sshCommand'], root).catch(() => ({ stdout: '' }))).stdout.trim()
    || 'ssh';
  return { timeout: NETWORK_TIMEOUT, env: { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: `${ssh} -o BatchMode=yes` } };
}

/**
 * Rebases main onto its upstream and pushes the result without force.
 * A conflicting rebase is aborted so the repository returns to its previous state.
 */
export async function syncWorkspace(root: string, strategy?: SyncStrategy): Promise<SyncResult> {
  return exclusive(root, async () => {
    if (await getCurrentBranch(root) !== 'main') throw new SyncError('Switch to main before syncing.', 'INVALID_BRANCH');
    const upstream = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root).then(result => result.stdout.trim(), () => '');
    const remote = (await runGit(['config', '--get', 'branch.main.remote'], root).catch(() => ({ stdout: '' }))).stdout.trim();
    const merge = (await runGit(['config', '--get', 'branch.main.merge'], root).catch(() => ({ stdout: '' }))).stdout.trim();
    if (!upstream || !remote || !merge) throw new SyncError('main has no upstream branch. Run: git push -u origin main', 'NO_UPSTREAM');
    const dirty = (await runGit(['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=no'], root)).stdout.split('\0').filter(Boolean).map(record => record.slice(3));
    if (dirty.length) throw new SyncError('Commit or restore changes before syncing.', 'DIRTY', dirty);

    const network = await networkOptions(root);
    try { await runGit(['fetch', remote], root, network); }
    catch (error) { throw new SyncError(gitMessage(error), 'FAILED'); }
    const pulled = await count(root, 'HEAD..@{u}');

    let backup: string | undefined;
    if (strategy) {
      backup = `refs/github-notes/sync-backups/${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await runGit(['update-ref', backup, 'HEAD'], root);
    }
    try {
      // Keep Core update merges intact instead of replaying Core commits one by one.
      await runGit(['rebase', '--rebase-merges', '--no-autostash', ...(strategy ? ['-X', strategy === 'remote' ? 'ours' : 'theirs'] : [])], root);
    } catch (error) {
      const rebasing = (await Promise.all(['rebase-merge', 'rebase-apply'].map(async name =>
        fs.existsSync(path.resolve(root, (await runGit(['rev-parse', '--git-path', name], root)).stdout.trim()))))).some(Boolean);
      if (!rebasing) {
        if (backup) await runGit(['update-ref', '-d', backup], root);
        throw new SyncError(gitMessage(error), 'FAILED');
      }
      const files = (await runGit(['diff', '--name-only', '--diff-filter=U', '-z'], root)).stdout.split('\0').filter(Boolean);
      await runGit(['rebase', '--abort'], root);
      if (backup) await runGit(['update-ref', '-d', backup], root);
      throw strategy
        ? new SyncError('Git could not resolve these conflicts automatically. Resolve them in a terminal.', 'UNRESOLVED', files)
        : new SyncError('Remote changes conflict with local commits.', 'CONFLICT', files);
    }

    const pushed = await count(root, '@{u}..HEAD');
    if (pushed > 0) {
      try { await runGit(['push', remote, `HEAD:${merge}`], root, network); }
      catch (error) { throw new SyncError(gitMessage(error), 'FAILED'); }
    }
    return { upstream, pulled, pushed, ...(backup ? { backup } : {}) };
  });
}
