import { Request, Response, Router } from 'express';
import { SourceError } from '@mygitnotes/core';
import { getCurrentBranch, getGitStatus } from '@mygitnotes/git';
import { localHome, workspaceOf } from './request-workspace.js';

export function createLocalWorkspaceRouter(): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const workspace = workspaceOf(res);
      const { root } = localHome(res);
      // A worktree before its first manifest reports no configuration, so Settings can create one.
      const config = await workspace.manifest().then(manifest => manifest.config, (error: unknown) => {
        if (error instanceof SourceError && error.status === 422) return null;
        throw error;
      });
      const branch = await getCurrentBranch(root);
      const gitStatus = await getGitStatus(root);
      res.json({ repoRoot: root, branch, config, gitStatus, isCoreBranch: branch === 'core', source: { type: 'local', identity: workspace.home.ref.id }, capabilities: { write: branch === 'main', local: true } });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Update workspace config
  router.put('/config', async (req: Request, res: Response) => {
    try {
      const { configYaml } = req.body;
      const { config } = await workspaceOf(res).saveManifest(configYaml, '');
      res.json({ success: true, config });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
