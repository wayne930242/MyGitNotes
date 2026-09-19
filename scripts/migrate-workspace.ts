import { migrateWorkspace } from '../packages/core/src/index.js';
import { resolveWorkspaceRoot } from './lib/workspace-root.js';

try {
  const root = resolveWorkspaceRoot();
  const { migrated, notesMissingTimestamps } = migrateWorkspace(root);
  console.log(migrated ? `[migrate-workspace] Migrated ${root}. Review and commit the change.` : `[migrate-workspace] ${root} is already current.`);
  if (notesMissingTimestamps > 0) console.log(`[migrate-workspace] ${notesMissingTimestamps} note(s) are missing created/updated. Run \`pnpm backfill-note-timestamps\` and review the diff.`);
} catch (error) {
  console.error(`[migrate-workspace] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
