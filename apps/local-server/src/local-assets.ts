import { Request, Response, Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { assetHash, assetInfo, assetPath, assetRoot, decodeAsset, isAssetPath, notebookKey, resolveSafePath, scanAssets, SourceError } from '@mygitnotes/core';
import { asLocal, homeRepository, notebookRepository, noteRepository } from './request-workspace.js';
import { stageAndCommit } from '@mygitnotes/git';

export function createLocalAssetsRouter(): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      // Without a notebook the listing covers the home repository's first notebook.
      const home = req.query.notebookId ? undefined : await homeRepository(res);
      if (home && !home.config.notebooks.length) return res.json({ assets: [] });
      const { handle, alias, notebook } = home ? { ...home, notebook: home.config.notebooks[0] } : await notebookRepository(res, req.query.notebookId);

      res.json({ notebookId: notebookKey(alias, notebook.id), assets: scanAssets(asLocal(handle).root, notebook) });
    } catch (err: unknown) {
      res.status(err instanceof SourceError ? err.status : 500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const { notebookId, filename, base64Content, directory = '' } = req.body;
      if (!notebookId || !filename || !base64Content) {
        return res.status(400).json({ error: 'notebookId, filename, base64Content required' });
      }

      const { handle, notebook: nb } = await notebookRepository(res, notebookId);
      const repoRoot = asLocal(handle).root;

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
      res.status(err instanceof SourceError ? err.status : 500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.patch('/', async (req, res) => {
    try {
      const { path: file, directory = '', filename } = req.body;
      const { handle, notebook: nb } = await noteRepository(res, file);
      const repoRoot = asLocal(handle).root;
      if (!isAssetPath(file, nb)) return res.status(403).json({ error: 'Path is not a workspace asset.' });
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
      res.status(error instanceof SourceError ? error.status : 400).json({ error: (error as Error).message });
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
      const { handle, notebook } = await noteRepository(res, assetPath);
      const repoRoot = asLocal(handle).root;
      if (!isAssetPath(assetPath, notebook)) return res.status(403).json({ error: 'Path is not a workspace asset.' });
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
      res.status(err instanceof SourceError ? err.status : 500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
