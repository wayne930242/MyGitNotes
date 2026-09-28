import { Request, Response, Router } from 'express';
import { type RepositoryStatus, SourceError, type WorkspaceStatus } from '@mygitnotes/core';
import { getCurrentBranch, getGitStatus } from '@mygitnotes/git';
import { type LocalHandle, workspaceOf } from './request-workspace.js';

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
