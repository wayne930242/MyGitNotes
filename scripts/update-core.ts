import { execFileSync } from 'node:child_process';
import { getCurrentBranch, updateCore } from '../packages/git/src/index.js';
import { resolveWorkspaceRoot } from './lib/workspace-root.js';

/** Migrates the configured workspace with the Core now on disk, not the code this process loaded. */
function migrateWithNewCore(workspaceRoot: string) {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-workspace.ts', '--workspace', workspaceRoot], { stdio: 'inherit' });
}

async function main() {
  // The Core checkout updates itself and migrates its configured workspace.
  const repoRoot = process.cwd();
  let workspaceRoot: string | undefined;
  if (await getCurrentBranch(repoRoot).catch(() => '') === 'core') {
    try { workspaceRoot = resolveWorkspaceRoot(repoRoot); }
    catch (error) { console.log(`[update-core] Workspace migration skipped: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const autoPush = process.argv.includes('--push');

  console.log(`[update-core] Checking for Core product updates...`);

  try {
    const result = await updateCore({ repoRoot, autoPush });
    if (result.success && workspaceRoot) migrateWithNewCore(workspaceRoot);

    if (result.alreadyUpToDate) {
      console.log(`\n✅ ${result.message}`);
      process.exit(0);
    }

    console.log(`\n🎉 ${result.message}`);
    console.log(`Previous revision: ${result.currentHash.slice(0, 7)}`);
    console.log(`Core revision:     ${result.coreRemoteHash.slice(0, 7)} (via ${result.remoteUsed})`);
    console.log(`Workspace validated successfully.\n`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Core update aborted: ${message}`);
    process.exit(1);
  }
}

main();
