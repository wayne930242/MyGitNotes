import { updateCore } from '../packages/git/src/index.js';

async function main() {
  const repoRoot = process.cwd();
  const autoPush = process.argv.includes('--push');

  console.log(`[update-core] Checking for Core product updates...`);

  try {
    const result = await updateCore({ repoRoot, autoPush });

    if (result.alreadyUpToDate) {
      console.log(`\n✅ ${result.message}`);
      process.exit(0);
    }

    if (!result.success) {
      console.error(`\n⚠️  ${result.message}`);
      if (result.conflictedFiles && result.conflictedFiles.length > 0) {
        console.error(`\nConflicted files requiring manual resolution:`);
        for (const file of result.conflictedFiles) {
          console.error(` - ${file}`);
        }
        console.error(`\nPlease resolve these merge conflicts and commit the resolution with 'git commit'.`);
      }
      process.exit(1);
    }

    console.log(`\n🎉 ${result.message}`);
    console.log(`Previous revision: ${result.currentHash.slice(0, 7)}`);
    console.log(`Merged revision:   ${result.coreRemoteHash.slice(0, 7)} (via ${result.remoteUsed})`);
    console.log(`Workspace validated successfully.\n`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Core update aborted: ${message}`);
    process.exit(1);
  }
}

main();
