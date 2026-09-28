import { Router } from 'express';
import fs from 'node:fs';
import { classifyResource, resolveSafePath, scanAssets, SourceError } from '@mygitnotes/core';
import { asLocal, eachRepository, noteRepository } from './request-workspace.js';

export function createLocalRawAssetsRouter(): Router {
  const router = Router();

  router.get('/by-hash/:hash', async (req, res) => {
    try {
      if (!/^[a-f0-9]{40}$/.test(req.params.hash)) return res.status(400).json({ error: 'Invalid asset hash.' });
      const found = (await eachRepository(res)).flatMap(({ handle, config }) => config.notebooks.flatMap(nb => scanAssets(asLocal(handle).root, nb).map(asset => ({ root: asLocal(handle).root, asset })))).find(({ asset }) => asset.hash === req.params.hash);
      if (!found) return res.status(404).json({ error: 'Asset not found.' });
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.sendFile(resolveSafePath(found.root, found.asset.path));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // Static asset handler for notes assets
  router.use(async (req, res) => {
    try {
      const relPath = decodeURIComponent(req.path.replace(/^\//, ''));
      const resolved = await noteRepository(res, relPath).catch((error: unknown) => {
        if (error instanceof SourceError && error.status === 403) return undefined;
        throw error;
      });
      if (!resolved || classifyResource(relPath, resolved.config).type !== 'asset') return res.status(403).send('Path is not a workspace asset');
      const { handle } = resolved;
      const safePath = resolveSafePath(asLocal(handle).root, relPath);
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
