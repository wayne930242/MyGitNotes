import fs from 'node:fs';
import path from 'node:path';
import { exclusive } from './change-management.js';
import { getCurrentBranch, GitExecutionError, runGit } from './git-service.js';

export type SyncStrategy = 'remote' | 'local';
export type SyncErrorCode = 'INVALID_BRANCH' | 'NO_UPSTREAM' | 'DIRTY' | 'CONFLICT' | 'UNRESOLVED' | 'STASH_CONFLICT' | 'FAILED';

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
  const ssh = process.env.GIT_SSH_COMMAND || (await runGit(['config', '--get', 'core.sshCommand'], root).catch(() => ({ stdout: '' }))).stdout.trim() || 'ssh';
  return { timeout: NETWORK_TIMEOUT, env: { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: `${ssh} -o BatchMode=yes` } };
}

export interface SyncOptions {
  /** Stop after the rebase and leave local commits unpushed; uncommitted tracked changes are stashed around the rebase. */
  pullOnly?: boolean;
}

const unmergedFiles = async (root: string) => (await runGit(['diff', '--name-only', '--diff-filter=U', '-z'], root)).stdout.split('\0').filter(Boolean);

/**
 * Rebases main onto its upstream and pushes the result without force.
 * A conflicting rebase is aborted so the repository returns to its previous state.
 * With `pullOnly`, uncommitted changes are stashed and popped back; when they conflict with the pulled commits,
 * the worktree is reset to the new HEAD and the changes stay in stash@{0}, so no note ever holds conflict markers.
 */
export async function syncWorkspace(root: string, strategy?: SyncStrategy, { pullOnly = false }: SyncOptions = {}): Promise<SyncResult> {
  return exclusive(root, async () => {
    if (await getCurrentBranch(root) !== 'main') throw new SyncError('Switch to main before syncing.', 'INVALID_BRANCH');
    const upstream = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root).then(result => result.stdout.trim(), () => '');
    const remote = (await runGit(['config', '--get', 'branch.main.remote'], root).catch(() => ({ stdout: '' }))).stdout.trim();
    const merge = (await runGit(['config', '--get', 'branch.main.merge'], root).catch(() => ({ stdout: '' }))).stdout.trim();
    if (!upstream || !remote || !merge) throw new SyncError('main has no upstream branch. Run: git push -u origin main', 'NO_UPSTREAM');
    const dirty = (await runGit(['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=no'], root)).stdout.split('\0').filter(Boolean).map(record => record.slice(3));
    if (dirty.length && !pullOnly) throw new SyncError('Commit or restore changes before syncing.', 'DIRTY', dirty);

    const network = await networkOptions(root);
    try {
      await runGit(['fetch', remote], root, network);
    } catch (error) {
      throw new SyncError(gitMessage(error), 'FAILED');
    }
    const pulled = await count(root, 'HEAD..@{u}');
    if (pullOnly && pulled === 0) return { upstream, pulled, pushed: 0 };

    let backup: string | undefined;
    if (strategy) {
      backup = `refs/github-notes/sync-backups/${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await runGit(['update-ref', backup, 'HEAD'], root);
    }
    // Git's own --autostash leaves conflict markers in the worktree when the pop conflicts, so the stash is handled here.
    const stashed = pullOnly && dirty.length > 0;
    if (stashed) await runGit(['stash', 'push', '-m', 'mygitnotes: pull'], root);
    try {
      // Keep Core update merges intact instead of replaying Core commits one by one.
      await runGit(['rebase', '--rebase-merges', '--no-autostash', ...(strategy ? ['-X', strategy === 'remote' ? 'ours' : 'theirs'] : [])], root);
    } catch (error) {
      const rebasing = (await Promise.all(['rebase-merge', 'rebase-apply'].map(async name => fs.existsSync(path.resolve(root, (await runGit(['rev-parse', '--git-path', name], root)).stdout.trim()))))).some(Boolean);
      const files = rebasing ? await unmergedFiles(root) : [];
      if (rebasing) await runGit(['rebase', '--abort'], root);
      if (stashed) await runGit(['stash', 'pop'], root);
      if (backup) await runGit(['update-ref', '-d', backup], root);
      if (!rebasing) throw new SyncError(gitMessage(error), 'FAILED');
      throw strategy ? new SyncError('Git could not resolve these conflicts automatically. Resolve them in a terminal.', 'UNRESOLVED', files) : new SyncError('Remote changes conflict with local commits.', 'CONFLICT', files);
    }
    if (stashed) {
      try {
        await runGit(['stash', 'pop'], root);
      } catch {
        // A conflicting pop keeps the stash entry; drop the half-applied changes so every file matches the pulled HEAD.
        const files = await unmergedFiles(root);
        await runGit(['reset', '--hard', 'HEAD'], root);
        throw new SyncError(`Pulled ${pulled} commits, but your uncommitted changes conflict with them. They are kept in stash@{0}; run git stash pop in a terminal to resolve them.`, 'STASH_CONFLICT', files);
      }
    }

    if (pullOnly) return { upstream, pulled, pushed: 0, ...(backup ? { backup } : {}) };
    const pushed = await count(root, '@{u}..HEAD');
    if (pushed > 0) {
      try {
        await runGit(['push', remote, `HEAD:${merge}`], root, network);
      } catch (error) {
        throw new SyncError(gitMessage(error), 'FAILED');
      }
    }
    return { upstream, pulled, pushed, ...(backup ? { backup } : {}) };
  });
}
