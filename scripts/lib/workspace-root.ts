import fs from 'node:fs';
import path from 'node:path';
import { loadEnvDefaults, loadRepositoryMappings, loadSourceConfig } from '../../packages/core/src/index.js';

/** The workspace a product CLI acts on: `--workspace <path>`, else the local source configured for this checkout. */
export function resolveWorkspaceRoot(checkout = process.cwd(), argv = process.argv): string {
  const index = argv.indexOf('--workspace');
  if (index >= 0) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('--workspace requires the path to a workspace.');
    return path.resolve(value);
  }
  loadEnvDefaults(path.join(checkout, '.env'));
  const source = loadSourceConfig(checkout);
  if (source.type !== 'local') throw new Error(`This checkout reads a ${source.type} source. Pass --workspace <path> to act on a local workspace.`);
  return source.path;
}

/**
 * The worktrees of the workspace's members: `root`, then each worktree `repositories` in this checkout's
 * `mygitnotes.server.yaml` maps, once each (a mapping onto `root` is `root`). With `visibleOnly`, worktrees whose
 * entry says `hidden: true` are left out, since a hidden repository is not read.
 */
export function memberWorktrees(root: string, checkout = process.cwd(), { visibleOnly = false } = {}): string[] {
  const real = (worktree: string) => {
    try {
      return fs.realpathSync(worktree);
    } catch {
      return path.resolve(worktree);
    }
  };
  const mappings = loadRepositoryMappings(checkout);
  const seen = new Set(visibleOnly ? mappings.filter(mapping => mapping.hidden).map(mapping => real(mapping.path)) : []);
  return [root, ...mappings.map(mapping => mapping.path)].filter(worktree => {
    const key = real(worktree);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
