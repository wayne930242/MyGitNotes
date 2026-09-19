import fs from 'node:fs';
import { loadWorkspaceConfig, resolveSafePath, scanNotebookNotes, fillMissingNoteTimestamps } from '../packages/core/src/index.js';
import { getFirstAndLastCommitDates } from '../packages/git/src/index.js';
import { resolveWorkspaceRoot } from './lib/workspace-root.js';

async function backfillNoteTimestamps() {
  const repoRoot = resolveWorkspaceRoot();
  const config = loadWorkspaceConfig(repoRoot);
  if (!config) {
    console.error('[backfill] No workspace configuration found at ${repoRoot}.');
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;
  let noHistory = 0;

  for (const notebook of config.notebooks) {
    const notes = scanNotebookNotes(repoRoot, notebook);
    for (const note of notes) {
      if (note.metadata.created && note.metadata.updated) {
        skipped++;
        continue;
      }

      const { first, last } = await getFirstAndLastCommitDates(repoRoot, note.path);
      if (!first && !last) {
        noHistory++;
        continue;
      }

      const safePath = resolveSafePath(repoRoot, note.path);
      const raw = fs.readFileSync(safePath, 'utf-8');
      // Imported notes keep their original modification time in `modified`; prefer it over git history.
      const modified = typeof note.metadata.modified === 'string' && !Number.isNaN(Date.parse(note.metadata.modified))
        ? new Date(note.metadata.modified).toISOString()
        : undefined;
      const { raw: patched, changed } = fillMissingNoteTimestamps(raw, first, modified ?? last);
      if (!changed) {
        skipped++;
        continue;
      }

      fs.writeFileSync(safePath, patched, 'utf-8');
      updated++;
      console.log(`[backfill] ${note.path}`);
    }
  }

  console.log(`\n[backfill] Done. Updated ${updated} note(s), skipped ${skipped} (already complete), ${noHistory} without git history.`);
  console.log('[backfill] Review the changes with `git diff` before committing.');
}

backfillNoteTimestamps().catch((err) => {
  console.error('[backfill] Failed to backfill note timestamps:', err);
  process.exit(1);
});
