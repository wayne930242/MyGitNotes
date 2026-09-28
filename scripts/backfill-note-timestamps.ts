import fs from 'node:fs';
import { fillMissingNoteTimestamps, loadRepositoryMappings, loadWorkspaceConfig, mapsRepository, resolveSafePath, scanNotebookNotes } from '../packages/core/src/index.js';
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

  // A notebook in its own repository is processed in the worktree mygitnotes.server.yaml maps to it.
  const mappings = loadRepositoryMappings(process.cwd());
  for (const notebook of config.notebooks) {
    const { source } = notebook;
    const root = source ? mappings.find(mapping => mapsRepository(mapping, source))?.path : repoRoot;
    if (!root) {
      console.log(`[backfill] Skipped notebook ${notebook.id}: no worktree is mapped for ${source?.repository} in mygitnotes.server.yaml.`);
      continue;
    }
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
      console.log(`[backfill] ${source ? `${source.repository}:` : ''}${note.path}`);
    }
  }

  console.log(`\n[backfill] Done. Updated ${updated} note(s), skipped ${skipped} (already complete), ${noHistory} without git history.`);
  console.log('[backfill] Review the changes with `git diff` before committing.');
}

backfillNoteTimestamps().catch((err) => {
  console.error('[backfill] Failed to backfill note timestamps:', err);
  process.exit(1);
});
