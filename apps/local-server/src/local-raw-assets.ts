import { Router } from 'express';
import fs from 'node:fs';
import { classifyResource, resolveSafePath, scanAssets } from '@mygitnotes/core';
import { localRepository } from './request-workspace.js';

export function createLocalRawAssetsRouter(): Router {
  const router = Router();

  router.get('/by-hash/:hash', async (req, res) => {
    try {
      if (!/^[a-f0-9]{40}$/.test(req.params.hash)) return res.status(400).json({ error: 'Invalid asset hash.' });
      const { root, config } = await localRepository(res);
      const asset = config.notebooks.flatMap(nb => scanAssets(root, nb)).find(a => a.hash === req.params.hash);
      if (!asset) return res.status(404).json({ error: 'Asset not found.' });
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.sendFile(resolveSafePath(root, asset.path));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // Static asset handler for notes assets
  router.use(async (req, res) => {
    try {
      const relPath = decodeURIComponent(req.path.replace(/^\//, ''));
      const { root, config } = await localRepository(res);
      if (classifyResource(relPath, config).type !== 'asset') return res.status(403).send('Path is not a workspace asset');
      const safePath = resolveSafePath(root, relPath);
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      if (fs.existsSync(safePath)) {
        res.sendFile(safePath);
      } else {
        res.status(404).send('Asset not found');
      }
    } catch (err: unknown) {
      res.status(400).send(err instanceof Error ? err.message : 'Invalid asset path');
    }
  });

  return router;
}
