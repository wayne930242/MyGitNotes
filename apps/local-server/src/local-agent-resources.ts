import { Request, Response, Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { extractFirstH1, listWorkspaceAgentFiles, parseNoteContent, productAgentResources, resolveWorkspaceAgentPath, workspaceAgentKind, type WorkspaceAgentResource, workspaceAgentResource } from '@mygitnotes/core';
import { changeFile, getCurrentBranch, listChanges } from '@mygitnotes/git';

export function createLocalAgentResourcesRouter(repoRoot: string, appRoot: string): Router {
  const router = Router();

  // Helper to extract first heading, skill name, or clean folder title
  function extractResourceTitle(fullPath: string, relPath: string): string {
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const { metadata } = parseNoteContent(raw);
      if (typeof metadata.name === 'string' && metadata.name.trim()) {
        return metadata.name.trim();
      }
      if (typeof metadata.title === 'string' && metadata.title.trim()) {
        return metadata.title.trim();
      }
      const h1 = extractFirstH1(raw);
      if (h1) return h1;
    } catch {}

    const base = path.basename(relPath).replace(/\.(md|markdown|mdx|txt)$/i, '');
    if (base.toLowerCase() === 'index' || base.toLowerCase() === 'skill') {
      const dir = path.basename(path.dirname(relPath));
      return dir.charAt(0).toUpperCase() + dir.slice(1).replace(/-/g, ' ');
    }
    return base.charAt(0).toUpperCase() + base.slice(1).replace(/-/g, ' ');
  }

  router.get('/', async (req: Request, res: Response) => {
    try {
      const branch = await getCurrentBranch(repoRoot);
      const instructions: WorkspaceAgentResource[] = [];
      const skills: WorkspaceAgentResource[] = [];
      const docs: WorkspaceAgentResource[] = [];
      const groups = { instructions, skills, docs };
      for (const file of listWorkspaceAgentFiles(repoRoot)) {
        const resource = workspaceAgentResource(file, branch === 'main');
        if (!/^notes\/[^/]+\/AGENTS\.md$/.test(file)) {
          resource.name = extractResourceTitle(resolveWorkspaceAgentPath(repoRoot, file), file) || resource.name;
        }
        groups[workspaceAgentKind(file)!].push(resource);
      }
      docs.push(...productAgentResources(appRoot));

      res.json({ instructions, skills, docs });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/read', (req: Request, res: Response) => {
    try {
      const targetPath = req.query.path as string;
      if (!targetPath) return res.status(400).json({ error: 'path query required' });
      const safePath = resolveWorkspaceAgentPath(repoRoot, targetPath);
      const content = fs.readFileSync(safePath, 'utf-8');
      res.json({ path: targetPath, content });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Save agent resource file (workspace Agent documents)
  router.post('/save', async (req: Request, res: Response) => {
    try {
      const { path: relPath, content } = req.body;
      if (!relPath || typeof content !== 'string') {
        return res.status(400).json({ error: 'path and content are required' });
      }
      const safePath = resolveWorkspaceAgentPath(repoRoot, relPath);
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(safePath, content, 'utf-8');
      res.json({ success: true, path: relPath });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Restore agent resource from Git HEAD (workspace Agent documents)
  router.post('/restore', async (req: Request, res: Response) => {
    try {
      const { path: relPath } = req.body;
      if (!relPath) {
        return res.status(400).json({ error: 'path is required' });
      }
      const safePath = resolveWorkspaceAgentPath(repoRoot, relPath);
      const change = (await listChanges(repoRoot)).find(file => file.path === relPath);
      if (!change?.tracked || !change.available) return res.status(409).json({ error: 'This file has no committed version to restore.' });
      await changeFile(repoRoot, relPath, 'restore', req.body.revision || change.revision);
      const content = fs.readFileSync(safePath, 'utf-8');
      res.json({ success: true, path: relPath, content });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
