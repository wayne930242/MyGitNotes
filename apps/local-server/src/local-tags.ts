import { Router } from 'express';
import fs from 'node:fs';
import { classifyResource, loadWorkspaceConfig, replaceNoteTags, resolveSafePath } from '@mygitnotes/core';
import { stageAndCommit } from '@mygitnotes/git';
import { serializeWorkspaceMutation } from './workspace-mutation.js';

export function createLocalTagsRouter(repoRoot: string): Router {
  const router = Router();

  // Apply an explicit tags array to each of the given notes and create one commit for the
  // whole batch. Used for tag rename/merge/delete and for undoing any of them (the caller
  // computes the target `tags` per note; this endpoint only writes and commits).
  router.post('/apply', async (req, res) => {
    try {
      const entries = req.body?.entries;
      if (!Array.isArray(entries) || entries.length === 0 || entries.length > 500) {
        return res.status(400).json({ error: 'entries must be an array of 1 to 500 items.' });
      }
      for (const entry of entries) {
        if (typeof entry?.path !== 'string' || !Array.isArray(entry.tags) || entry.tags.some((tag: unknown) => typeof tag !== 'string')) {
          return res.status(400).json({ error: 'Each entry requires a path and a tags array of strings.' });
        }
      }
      const config = loadWorkspaceConfig(repoRoot);
      if (!config) return res.status(400).json({ error: 'Workspace not configured.' });

      const result = await serializeWorkspaceMutation(repoRoot, async () => {
        // Validate and compute every entry's patched content before writing any of them, so a
        // later entry failing validation cannot leave an earlier one written but uncommitted.
        const planned: { path: string; safePath: string; patched: string; }[] = [];
        for (const entry of entries) {
          let safePath: string;
          try {
            safePath = resolveSafePath(repoRoot, entry.path);
            if (classifyResource(entry.path, config).type !== 'note' || !fs.existsSync(safePath)) throw new Error('not a note');
          } catch {
            throw Object.assign(new Error(`Not a configured note: ${entry.path}`), { status: 403 });
          }
          const raw = fs.readFileSync(safePath, 'utf-8');
          const patched = replaceNoteTags(raw, entry.tags);
          if (patched === raw) continue;
          planned.push({ path: entry.path, safePath, patched });
        }
        if (planned.length === 0) return { success: true, changedPaths: [] as string[] };
        for (const entry of planned) fs.writeFileSync(entry.safePath, entry.patched, 'utf-8');
        const changedPaths = planned.map(entry => entry.path);
        const message = typeof req.body.message === 'string' && req.body.message.trim() ? req.body.message.trim() : `docs(notes): update tags in ${changedPaths.length} note${changedPaths.length === 1 ? '' : 's'}`;
        const commit = await stageAndCommit(repoRoot, changedPaths, message);
        return { success: true, changedPaths, commit };
      });
      res.json(result);
    } catch (err: unknown) {
      const status = (err as { status?: number; })?.status || 500;
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
