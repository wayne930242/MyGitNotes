import fs from 'node:fs';
import { fillMissingNoteTimestamps, loadWorkspaceConfig, resolveSafePath, scanNotebookNotes } from '../packages/core/src/index.js';
import { getFirstAndLastCommitDates } from '../packages/git/src/index.js';
import { memberWorktrees, resolveWorkspaceRoot } from './lib/workspace-root.js';

async function backfillNoteTimestamps() {
  const repoRoot = resolveWorkspaceRoot();
  if (!loadWorkspaceConfig(repoRoot)) {
    console.error(`[backfill] No workspace configuration found at ${repoRoot}.`);
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;
  let noHistory = 0;

  // Every visible member worktree mygitnotes.server.yaml maps is processed with the notebooks of its own manifest.
  const worktrees = memberWorktrees(repoRoot, process.cwd(), { visibleOnly: true }).flatMap(root => {
    const config = loadWorkspaceConfig(root);
    if (!config) console.log(`[backfill] Skipped ${root}: it has no workspace manifest.`);
    return config ? [{ root, config }] : [];
  });
  for (const { root, config } of worktrees) {
    for (const notebook of config.notebooks) {
      const notes = scanNotebookNotes(root, notebook);
      for (const note of notes) {
        if (note.metadata.created && note.metadata.updated) {
          skipped++;
          continue;
        }

        const { first, last } = await getFirstAndLastCommitDates(root, note.path);
        if (!first && !last) {
          noHistory++;
          continue;
        }

        const safePath = resolveSafePath(root, note.path);
        const raw = fs.readFileSync(safePath, 'utf-8');
        // Imported notes keep their original modification time in `modified`; prefer it over git history.
        const modified = typeof note.metadata.modified === 'string' && !Number.isNaN(Date.parse(note.metadata.modified)) ? new Date(note.metadata.modified).toISOString() : undefined;
        const { raw: patched, changed } = fillMissingNoteTimestamps(raw, first, modified ?? last);
        if (!changed) {
          skipped++;
          continue;
        }

        fs.writeFileSync(safePath, patched, 'utf-8');
        updated++;
        console.log(`[backfill] ${root === repoRoot ? '' : `${root}:`}${note.path}`);
      }
    }
  }

  console.log(`\n[backfill] Done. Updated ${updated} note(s), skipped ${skipped} (already complete), ${noHistory} without git history.`);
  console.log('[backfill] Review the changes with `git diff` before committing.');
}

backfillNoteTimestamps().catch((err) => {
  console.error('[backfill] Failed to backfill note timestamps:', err);
  process.exit(1);
});
