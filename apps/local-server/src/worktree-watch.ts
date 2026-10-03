import fs from 'node:fs';
import path from 'node:path';

/** How long a burst of file events is gathered before one change is reported. */
export const WATCH_DEBOUNCE_MS = 300;

interface SharedWatcher {
  watcher: fs.FSWatcher;
  listeners: Set<() => void>;
}

const watchers = new Map<string, SharedWatcher>();

/** Git's own bookkeeping changes on every status read and commit; only worktree files are reported. */
const isGitInternal = (file: string | null) => file !== null && file.split(/[\\/]/)[0] === '.git';

function openWatcher(root: string): SharedWatcher {
  const shared: SharedWatcher = { watcher: fs.watch(root, { recursive: true }), listeners: new Set() };
  shared.watcher.on('change', (_event, file) => {
    if (isGitInternal(file === null ? null : String(file))) return;
    for (const listener of shared.listeners) listener();
  });
  shared.watcher.on('error', error => {
    // A worktree that disappears ends its watcher; subscribers reconnect and open a new one.
    console.warn(`[worktree-watch] ${root}: ${error.message}`);
    shared.watcher.close();
    watchers.delete(root);
  });
  return shared;
}

/**
 * Calls `onChange` with the ids of the worktrees whose files changed, at most once per debounce
 * window. One watcher per worktree is shared by every subscriber; the returned function unsubscribes.
 */
export function watchWorktrees(worktrees: { id: string; root: string; }[], onChange: (ids: string[]) => void): () => void {
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
    shared.listeners.add(listener);
    return { key, shared, listener };
  });
  return () => {
    clearTimeout(timer);
    for (const { key, shared, listener } of subscriptions) {
      shared.listeners.delete(listener);
      if (shared.listeners.size || watchers.get(key) !== shared) continue;
      shared.watcher.close();
      watchers.delete(key);
    }
  };
}

/** Worktrees currently watched, for tests. */
export const watchedWorktreeCount = () => watchers.size;
