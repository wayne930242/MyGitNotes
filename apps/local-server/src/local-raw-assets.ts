import { Router } from 'express';
import fs from 'node:fs';
import { classifyResource, loadWorkspaceConfig, resolveSafePath, scanAssets } from '@mygitnotes/core';

export function createLocalRawAssetsRouter(repoRoot: string): Router {
  const router = Router();

  router.get('/by-hash/:hash', (req, res) => {
    try {
      if (!/^[a-f0-9]{40}$/.test(req.params.hash)) return res.status(400).json({ error: 'Invalid asset hash.' });
      const config = loadWorkspaceConfig(repoRoot);
      const asset = config?.notebooks.flatMap(nb => scanAssets(repoRoot, nb)).find(a => a.hash === req.params.hash);
      if (!asset) return res.status(404).json({ error: 'Asset not found.' });
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.sendFile(resolveSafePath(repoRoot, asset.path));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // Static asset handler for notes assets
  router.use((req, res) => {
    try {
      const relPath = decodeURIComponent(req.path.replace(/^\//, ''));
      const config = loadWorkspaceConfig(repoRoot);
      if (!config || classifyResource(relPath, config).type !== 'asset') return res.status(403).send('Path is not a workspace asset');
      const safePath = resolveSafePath(repoRoot, relPath);
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
