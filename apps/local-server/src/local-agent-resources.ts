import { Request, Response, Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { agentSkillLocation, extractFirstH1, listWorkspaceAgentFiles, parseNoteContent, productAgentResources, renameAgentSkillEntryContent, renamedAgentSkillPath, resolveWorkspaceAgentPath, rewriteAgentSkillReferences, workspaceAgentKind, type WorkspaceAgentResource, workspaceAgentResource } from '@mygitnotes/core';
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
      const { path: relPath, content, create } = req.body;
      if (!relPath || typeof content !== 'string') {
        return res.status(400).json({ error: 'path and content are required' });
      }
      const safePath = resolveWorkspaceAgentPath(repoRoot, relPath);
      const skillLocation = agentSkillLocation(relPath);
      if (skillLocation) {
        // `create` starts a brand-new skill, so its directory must not exist yet; without it, a
        // missing file means the skill was moved or deleted elsewhere and this save is stale.
        if (create) {
          if (fs.existsSync(path.dirname(safePath))) return res.status(409).json({ error: `A skill named ${skillLocation.slug} already exists.` });
        } else if (!fs.existsSync(safePath)) {
          return res.status(409).json({ error: 'Skill moved or deleted. Reload before saving.' });
        }
      }
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

  // Rename a directory-backed skill and update references in editable Agent documents as one rollback-safe operation.
  router.post('/rename-skill', (req: Request, res: Response) => {
    const originals = new Map<string, string>();
    let oldDirectoryPath = '';
    let newDirectoryPath = '';
    let moved = false;
    try {
      const { path: relPath, slug, content } = req.body;
      if (typeof relPath !== 'string' || typeof slug !== 'string' || typeof content !== 'string') return res.status(400).json({ error: 'path, slug and content are required' });
      const location = agentSkillLocation(relPath);
      if (!location) return res.status(400).json({ error: 'Only a directory-backed SKILL.md file can rename a skill.' });
      let nextPath: string;
      try {
        nextPath = renamedAgentSkillPath(relPath, slug);
      } catch (error) {
        return res.status(400).json({ error: (error as Error).message });
      }
      const nextLocation = agentSkillLocation(nextPath)!;
      const safePath = resolveWorkspaceAgentPath(repoRoot, relPath);
      oldDirectoryPath = path.dirname(safePath);
      newDirectoryPath = path.dirname(resolveWorkspaceAgentPath(repoRoot, nextPath));

      if (nextPath === relPath) {
        fs.writeFileSync(safePath, content, 'utf-8');
        return res.json({ success: true, path: relPath, changedPaths: [relPath] });
      }
      if (fs.existsSync(newDirectoryPath)) return res.status(409).json({ error: `A skill named ${nextLocation.slug} already exists.` });

      const agentFiles = listWorkspaceAgentFiles(repoRoot);
      for (const file of agentFiles) originals.set(file, fs.readFileSync(resolveWorkspaceAgentPath(repoRoot, file), 'utf-8'));
      const updates = [...originals].map(([file, original]) => {
        const destination = file === relPath || file.startsWith(`${location.directory}/`) ? `${nextLocation.directory}${file.slice(location.directory.length)}` : file;
        const source = file === relPath ? content : original;
        const updated = file === relPath ? renameAgentSkillEntryContent(source, location.directory, nextLocation.directory, nextLocation.slug) : rewriteAgentSkillReferences(source, location.directory, nextLocation.directory);
        return { destination, file, original, updated };
      }).filter(update => update.file.startsWith(`${location.directory}/`) || update.updated !== update.original);

      fs.renameSync(oldDirectoryPath, newDirectoryPath);
      moved = true;
      for (const update of updates) if (update.updated !== update.original || update.file === relPath) fs.writeFileSync(resolveWorkspaceAgentPath(repoRoot, update.destination), update.updated, 'utf-8');
      res.json({ success: true, path: nextPath, changedPaths: updates.map(update => update.destination) });
    } catch (err: unknown) {
      const rollbackErrors: string[] = [];
      if (moved && fs.existsSync(newDirectoryPath) && !fs.existsSync(oldDirectoryPath)) {
        try {
          fs.renameSync(newDirectoryPath, oldDirectoryPath);
        } catch (error) {
          rollbackErrors.push(error instanceof Error ? error.message : String(error));
        }
      }
      for (const [file, raw] of originals) {
        try {
          fs.writeFileSync(resolveWorkspaceAgentPath(repoRoot, file), raw, 'utf-8');
        } catch (error) {
          rollbackErrors.push(error instanceof Error ? error.message : String(error));
        }
      }
      const failure = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: rollbackErrors.length ? `${failure} Rollback failed: ${rollbackErrors.join('; ')}` : failure, rollbackFailed: rollbackErrors.length > 0 });
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
