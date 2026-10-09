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
 * `mygitnotes.server.yaml` maps, once each (a mapping onto `root` is `root`).
 */
export function memberWorktrees(root: string, checkout = process.cwd()): string[] {
  const real = (worktree: string) => {
    try {
      return fs.realpathSync(worktree);
    } catch {
      return path.resolve(worktree);
    }
  };
  const seen = new Set<string>();
  return [root, ...loadRepositoryMappings(checkout).map(mapping => mapping.path)].filter(worktree => {
    const key = real(worktree);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
