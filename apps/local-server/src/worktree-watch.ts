import fs from 'node:fs';
import path from 'node:path';

/** How long a burst of file events is gathered before one change is reported. */
export const WATCH_DEBOUNCE_MS = 300;

/** What a subscriber hears of: worktree files, or commits and other moves of HEAD. */
export type WatchKind = 'files' | 'commits';

interface SharedWatcher {
  watcher: fs.FSWatcher;
  /** A linked worktree keeps its reflog in the main repository's `.git/worktrees/<name>`, outside the worktree's own watch. */
  reflog?: fs.FSWatcher;
  listeners: Record<WatchKind, Set<() => void>>;
}

const watchers = new Map<string, SharedWatcher>();

/**
 * Git's own bookkeeping changes on every status read and commit, so files under `.git` are not worktree changes.
 * Git appends to `.git/logs/HEAD` whenever HEAD moves: a commit, reset or checkout, by the app or anyone else;
 * a linked worktree's reflog is watched where its `.git` file points.
 */
function changeKind(file: string | null): WatchKind | undefined {
  const parts = file === null ? [] : file.split(/[\\/]/);
  if (parts[0] !== '.git') return 'files';
  return parts.length === 3 && parts[1] === 'logs' && parts[2] === 'HEAD' ? 'commits' : undefined;
}

/** The Git directory a linked worktree's `.git` file points to; undefined when `.git` is the repository's own directory. */
function linkedGitDir(root: string): string | undefined {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, '.git'), 'utf8');
  } catch {
    return;
  }
  const gitdir = /^gitdir:\s*(.+)$/m.exec(text)?.[1].trim();
  return gitdir ? path.resolve(root, gitdir) : undefined;
}

function closeWatcher(shared: SharedWatcher) {
  shared.watcher.close();
  shared.reflog?.close();
}

function openWatcher(root: string): SharedWatcher {
  const shared: SharedWatcher = { watcher: fs.watch(root, { recursive: true }), listeners: { files: new Set(), commits: new Set() } };
  const notify = (kind: WatchKind | undefined) => {
    if (!kind) return;
    for (const listener of shared.listeners[kind]) listener();
  };
  const fail = (error: Error) => {
    // A worktree that disappears ends its watcher; subscribers reconnect and open a new one.
    console.warn(`[worktree-watch] ${root}: ${error.message}`);
    closeWatcher(shared);
    watchers.delete(root);
  };
  shared.watcher.on('change', (_event, file) => notify(changeKind(file === null ? null : String(file))));
  shared.watcher.on('error', fail);
  const gitdir = linkedGitDir(root);
  if (gitdir) {
    try {
      shared.reflog = fs.watch(path.join(gitdir, 'logs'));
      shared.reflog.on('change', (_event, file) => notify(file === null || String(file) === 'HEAD' ? 'commits' : undefined));
      shared.reflog.on('error', fail);
    } catch (error) {
      console.warn(`[worktree-watch] ${root}: commits are not watched: ${(error as Error).message}`);
    }
  }
  return shared;
}

/**
 * Calls `onChange` with the ids of the worktrees whose files changed, or that committed with `kind` `commits`,
 * at most once per debounce window. One watcher per worktree is shared by every subscriber; the returned function unsubscribes.
 */
export function watchWorktrees(worktrees: { id: string; root: string; }[], onChange: (ids: string[]) => void, kind: WatchKind = 'files'): () => void {
  const changed = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  const subscriptions = worktrees.map(({ id, root }) => {
    const key = path.resolve(root);
    const shared = watchers.get(key) ?? openWatcher(key);
    watchers.set(key, shared);
    const listener = () => {
      changed.add(id);
      timer ??= setTimeout(() => {
        timer = undefined;
        const ids = [...changed];
        changed.clear();
        onChange(ids);
      }, WATCH_DEBOUNCE_MS);
    };
    shared.listeners[kind].add(listener);
    return { key, shared, listener };
  });
  return () => {
    clearTimeout(timer);
    for (const { key, shared, listener } of subscriptions) {
      shared.listeners[kind].delete(listener);
      if (shared.listeners.files.size || shared.listeners.commits.size || watchers.get(key) !== shared) continue;
      closeWatcher(shared);
      watchers.delete(key);
    }
  };
}

/** Worktrees currently watched, for tests. */
export const watchedWorktreeCount = () => watchers.size;
