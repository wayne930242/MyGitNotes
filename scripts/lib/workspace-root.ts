import path from 'node:path';
import { loadEnvDefaults, loadSourceConfig } from '../../packages/core/src/index.js';

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
