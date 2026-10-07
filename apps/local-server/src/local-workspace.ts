import { Request, Response, Router } from 'express';
import { type RepositoryStatus, SourceError, type WorkspaceStatus } from '@mygitnotes/core';
import { getCurrentBranch, getGitStatus } from '@mygitnotes/git';
import { type LocalHandle, workspaceOf } from './request-workspace.js';
import { openEventStream } from './event-stream.js';
import { watchWorktrees } from './worktree-watch.js';

/** Every available worktree of the request's workspace; the home worktree alone before its first manifest. */
async function workspaceWorktrees(res: Response): Promise<{ id: string; root: string; }[]> {
  const workspace = workspaceOf(res);
  try {
    await workspace.manifest();
  } catch (error) {
    if (error instanceof SourceError && error.status === 422) return [{ id: workspace.home.ref.id, root: (workspace.home.handle as LocalHandle).root }];
    throw error;
  }
  return (await workspace.all()).flatMap(entry => 'handle' in entry ? [{ id: entry.ref.id, root: (entry.handle as LocalHandle).root }] : []);
}

/** Files changed in any worktree, whoever wrote them, as server-sent `change` events naming the repositories. */
async function streamWorktreeChanges(_req: Request, res: Response) {
  await openEventStream(res, () => workspaceWorktrees(res), error => res.status(500).json({ error: error instanceof Error ? error.message : String(error) }), (worktrees, write) => watchWorktrees(worktrees, repositories => write(`event: change\ndata: ${JSON.stringify({ repositories })}\n\n`)));
}

export function createLocalWorkspaceRouter(): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const workspace = workspaceOf(res);
      // A worktree before its first manifest reports no configuration, so Settings can create one.
      const config = await workspace.manifest().then(manifest => manifest.config, (error: unknown) => {
        if (error instanceof SourceError && error.status === 422) return null;
        throw error;
      });
      const entries = config ? await workspace.all() : [{ ref: workspace.home.ref, notebooks: [], handle: workspace.home.handle }];
      const repositories = await Promise.all(entries.map(async (entry): Promise<RepositoryStatus & { gitStatus?: unknown; }> => {
        const base = { id: entry.ref.id, type: entry.ref.source.type, repository: entry.ref.source.type === 'local' ? undefined : entry.ref.source.repository, revision: '', notebooks: entry.notebooks.map(notebook => notebook.id) };
        if (!('handle' in entry)) return { ...base, branch: '', write: false, unavailable: entry.unavailable };
        const { root } = entry.handle as LocalHandle;
        const branch = await getCurrentBranch(root);
        return { ...base, branch, write: branch === 'main', gitStatus: await getGitStatus(root) };
      }));
      const body: WorkspaceStatus = { config, configRevision: '', local: true, home: workspace.home.ref.id, repositories, repoRoot: (workspace.home.handle as LocalHandle).root };
      res.json(body);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/events', streamWorktreeChanges);

  // Update workspace config
  router.put('/config', async (req: Request, res: Response) => {
    try {
      const { configYaml } = req.body;
      const { config } = await workspaceOf(res).saveManifest(configYaml, '');
      res.json({ success: true, config, configRevision: '' });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
