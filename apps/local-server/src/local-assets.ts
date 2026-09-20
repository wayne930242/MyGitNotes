import { Request, Response, Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { assetHash, assetInfo, assetPath, assetRoot, decodeAsset, isAssetPath, loadWorkspaceConfig, resolveSafePath, scanAssets } from '@mygitnotes/core';
import { stageAndCommit } from '@mygitnotes/git';

export function createLocalAssetsRouter(repoRoot: string): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    try {
      const config = loadWorkspaceConfig(repoRoot);
      if (!config) return res.json({ assets: [] });

      const notebookId = req.query.notebookId as string;
      const nb = config.notebooks.find((n) => n.id === notebookId) || config.notebooks[0];
      if (!nb) return res.json({ assets: [] });

      const assets = scanAssets(repoRoot, nb);

      res.json({ notebookId: nb.id, assets });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const { notebookId, filename, base64Content, directory = '' } = req.body;
      if (!notebookId || !filename || !base64Content) {
        return res.status(400).json({ error: 'notebookId, filename, base64Content required' });
      }

      const config = loadWorkspaceConfig(repoRoot);
      if (!config) return res.status(400).json({ error: 'Workspace not configured' });

      const nb = config.notebooks.find((n) => n.id === notebookId);
      if (!nb) return res.status(404).json({ error: `Notebook ${notebookId} not found` });

      const relPath = assetPath(nb, directory, filename);
      const safeFilename = path.posix.basename(relPath);
      const targetPath = resolveSafePath(repoRoot, relPath);
      const buffer = decodeAsset(base64Content);
      if (fs.existsSync(targetPath)) return res.status(409).json({ error: 'An asset already exists at this path.' });
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, buffer, { flag: 'wx' });

      const commit = await stageAndCommit(repoRoot, [relPath], `chore(assets): add asset ${safeFilename}`);

      res.json({ success: true, filename: safeFilename, ...assetInfo(relPath, assetRoot(nb), assetHash(buffer), buffer.length), commit });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.patch('/', async (req, res) => {
    try {
      const config = loadWorkspaceConfig(repoRoot);
      const { path: file, directory = '', filename } = req.body;
      const nb = config?.notebooks.find(nb => typeof file === 'string' && isAssetPath(file, nb));
      if (!nb) return res.status(403).json({ error: 'Path is not a workspace asset.' });
      const destination = assetPath(nb, directory, filename || path.posix.basename(file));
      const from = resolveSafePath(repoRoot, file);
      const to = resolveSafePath(repoRoot, destination);
      if (!fs.existsSync(from)) return res.status(404).json({ error: 'Asset not found.' });
      if (fs.existsSync(to)) return res.status(409).json({ error: 'Destination already exists.' });
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (!fs.lstatSync(from).isFile() || fs.lstatSync(from).isSymbolicLink()) return res.status(403).json({ error: 'Source must be a regular asset file.' });
      fs.linkSync(from, to);
      try {
        fs.unlinkSync(from);
      } catch (error) {
        fs.unlinkSync(to);
        throw error;
      }
      const commit = await stageAndCommit(repoRoot, [file, destination], `chore(assets): move ${path.posix.basename(file)}`);
      res.json({ success: true, path: destination, commit });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // Delete asset file
  router.delete('/', async (req: Request, res: Response) => {
    try {
      const assetPath = req.query.path as string;
      const noCommit = req.query.noCommit === 'true' || req.body?.noCommit === true;
      if (!assetPath) {
        return res.status(400).json({ error: 'path query parameter is required' });
      }
      const config = loadWorkspaceConfig(repoRoot);
      if (!config?.notebooks.some(nb => isAssetPath(assetPath, nb))) return res.status(403).json({ error: 'Path is not a workspace asset.' });
      const safePath = resolveSafePath(repoRoot, assetPath);
      if (fs.existsSync(safePath)) {
        fs.unlinkSync(safePath);
      }
      if (noCommit) {
        return res.json({ success: true, committed: false });
      }
      const commit = await stageAndCommit(repoRoot, [assetPath], `chore(assets): delete ${path.basename(assetPath)}`);
      res.json({ success: true, commit, committed: true });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
