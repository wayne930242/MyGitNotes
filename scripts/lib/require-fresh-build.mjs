import fs from 'node:fs';
import path from 'node:path';

const SOURCE_DIRS = ['apps/web/src', 'apps/local-server/src', 'packages/core/src', 'packages/git/src', 'packages/mcp-server/src'];
const BUILT_ENTRIES = ['apps/web/dist/index.html', 'apps/local-server/dist/app.js'];
const isTestFile = /\.test\.[jt]sx?$/;

function newestMtimeMs(entry) {
  const stat = fs.statSync(entry);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs.readdirSync(entry).reduce((latest, child) => (isTestFile.test(child) ? latest : Math.max(latest, newestMtimeMs(path.join(entry, child)))), 0);
}

/** Every `qa-*.mjs` script serves `apps/web/dist` through `apps/local-server/dist/app.js`; refuse to run against either bundle when a source file it covers is newer, which otherwise silently tests a stale build. */
export function assertFreshBuild(root) {
  const newestSource = Math.max(...SOURCE_DIRS.map(dir => newestMtimeMs(path.join(root, dir))));
  for (const entry of BUILT_ENTRIES) {
    const full = path.join(root, entry);
    if (!fs.existsSync(full) || fs.statSync(full).mtimeMs < newestSource) throw Error(`${entry} is older than the sources it covers; run \`pnpm build\` first.`);
  }
}
