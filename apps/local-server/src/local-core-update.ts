import { Request, Response, Router } from 'express';
import { updateCore } from '@mygitnotes/git';

export function createLocalCoreUpdateRouter(appRoot: string): Router {
  const router = Router();

  router.post('/update', async (req: Request, res: Response) => {
    try {
      const { autoPush } = req.body || {};
      const result = await updateCore({ repoRoot: appRoot, autoPush: Boolean(autoPush) });
      res.json({ result });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
