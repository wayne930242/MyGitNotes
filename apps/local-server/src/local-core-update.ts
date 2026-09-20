import { Request, Response, Router } from 'express';
import { CoreUpdateError, getCoreStatus, updateCore } from '@mygitnotes/git';
import { buildInfo } from './build-info.js';

export function createLocalCoreUpdateRouter(appRoot: string, runningBuild = buildInfo.sha): Router {
  const router = Router();

  router.get('/status', async (_req, res) => {
    try {
      res.json({ status: await getCoreStatus(appRoot, runningBuild) });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error), code: error instanceof CoreUpdateError ? error.code : 'STATUS_FAILED' });
    }
  });

  router.post('/update', async (req: Request, res: Response) => {
    try {
      const { autoPush } = req.body || {};
      const result = await updateCore({ repoRoot: appRoot, autoPush: Boolean(autoPush) });
      res.json({ result });
    } catch (err: unknown) {
      res.status(err instanceof CoreUpdateError ? 409 : 500).json({ error: err instanceof Error ? err.message : String(err), code: err instanceof CoreUpdateError ? err.code : 'UPDATE_FAILED' });
    }
  });

  return router;
}
