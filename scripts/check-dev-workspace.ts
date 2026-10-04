import path from 'node:path';
import { assertWorkspaceCompatible, loadEnvDefaults, loadSourceConfig } from '../packages/core/src/index.js';

try {
  const root = process.cwd();
  loadEnvDefaults(path.join(root, '.env'));
  // Match local-server's --local startup, also used by dev:remote's Tailscale wrapper.
  process.env.MYGITNOTES_SOURCE = 'local';
  const localPath = process.env.REPO_ROOT || process.env.MYGITNOTES_LOCAL_PATH || process.env.GITHUB_NOTES_LOCAL_PATH;
  if (localPath) process.env.MYGITNOTES_LOCAL_PATH = localPath;
  const source = loadSourceConfig(root);
  if (source.type === 'local') assertWorkspaceCompatible(source.path);
} catch (error) {
  console.error(`[dev] ${(error as Error).message}`);
  process.exitCode = 1;
}
