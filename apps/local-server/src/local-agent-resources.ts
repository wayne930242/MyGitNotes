import { Request, Response, Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { agentSkillLocation, agentWorkspaceFile, agentWorkspaces, listAgentWorkspaceFiles, type NotebookConfig, renameAgentSkillEntryContent, renamedAgentSkillPath, resolveAgentFile, rewriteAgentSkillReferences } from '@mygitnotes/core';
import { changeFile, getCurrentBranch, listChanges } from '@mygitnotes/git';
import { asLocal, eachRepository, repositoryOrHome } from './request-workspace.js';

/** A workspace file the page may open; anything else, including other tools' files, is refused. */
function workspacePath(root: string, file: unknown, notebooks: NotebookConfig[]): string {
  if (typeof file !== 'string' || !agentWorkspaceFile(file, notebooks)) throw Object.assign(new Error('Path is not an agent workspace file.'), { status: 403 });
  return resolveAgentFile(root, file, notebooks);
}

function fail(res: Response, error: unknown, status = 500) {
  res.status((error as { status?: number; }).status || status).json({ error: error instanceof Error ? error.message : String(error) });
}

export function createLocalAgentResourcesRouter(): Router {
  const router = Router();
  /** The worktree a request names in `repository`, or the home worktree, with the notebooks it holds: each repository keeps its own agent workspaces. */
  const worktree = async (res: Response, id: unknown) => {
    const { handle, config } = await repositoryOrHome(res, id);
    return { root: asLocal(handle).root, notebooks: config.notebooks };
  };

  /** The agent workspaces of every available repository, for the agent pane's picker. */
  router.get('/workspaces', async (_req: Request, res: Response) => {
    try {
      const repositories = await eachRepository(res);
      res.json({ workspaces: repositories.flatMap(({ id, handle, config }) => agentWorkspaces(listAgentWorkspaceFiles(asLocal(handle).root, config.notebooks)).map(workspace => ({ repository: id, ...workspace }))) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/', async (req: Request, res: Response) => {
    try {
      const { root, notebooks } = await worktree(res, req.query.repository);
      const editable = await getCurrentBranch(root) === 'main';
      const files = listAgentWorkspaceFiles(root, notebooks);
      res.json({ workspaces: agentWorkspaces(files), files: files.map(file => ({ ...file, editable })) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/read', async (req: Request, res: Response) => {
    try {
      const { root, notebooks } = await worktree(res, req.query.repository);
      const file = req.query.path as string;
      res.json({ path: file, content: fs.readFileSync(workspacePath(root, file, notebooks), 'utf-8') });
    } catch (error) {
      fail(res, error, 400);
    }
  });

  /** Writes a workspace file; `create` refuses to replace a skill folder or file that already exists. */
  router.post('/save', async (req: Request, res: Response) => {
    try {
      const { root, notebooks } = await worktree(res, req.body?.repository);
      const { path: file, content, create } = req.body;
      if (typeof content !== 'string') return res.status(400).json({ error: 'path and content are required' });
      const safePath = workspacePath(root, file, notebooks);
      const skill = agentSkillLocation(file);
      if (create) {
        if (skill && fs.existsSync(path.dirname(safePath))) return res.status(409).json({ error: `A skill named ${skill.slug} already exists.` });
        if (fs.existsSync(safePath)) return res.status(409).json({ error: `${file} already exists.` });
      } else if (skill && !fs.existsSync(safePath)) {
        // Without `create`, a missing entry means the skill was moved or deleted elsewhere and this save is stale.
        return res.status(409).json({ error: 'Skill moved or deleted. Reload before saving.' });
      }
      fs.mkdirSync(path.dirname(safePath), { recursive: true });
      fs.writeFileSync(safePath, content, 'utf-8');
      res.json({ success: true, path: file });
    } catch (error) {
      fail(res, error);
    }
  });

  // Rename a directory-backed skill and update references in the other workspace files as one rollback-safe operation.
  router.post('/rename-skill', async (req: Request, res: Response) => {
    const originals = new Map<string, string>();
    let oldDirectoryPath = '';
    let newDirectoryPath = '';
    let moved = false;
    // Resolved before the try block because the rollback below restores files in this worktree.
    const { root, notebooks } = await worktree(res, req.body?.repository);
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
      const safePath = workspacePath(root, relPath, notebooks);
      oldDirectoryPath = path.dirname(safePath);
      newDirectoryPath = path.dirname(workspacePath(root, nextPath, notebooks));

      if (nextPath === relPath) {
        fs.writeFileSync(safePath, content, 'utf-8');
        return res.json({ success: true, path: relPath, changedPaths: [relPath] });
      }
      if (fs.existsSync(newDirectoryPath)) return res.status(409).json({ error: `A skill named ${nextLocation.slug} already exists.` });

      for (const { path: file } of listAgentWorkspaceFiles(root, notebooks)) originals.set(file, fs.readFileSync(resolveAgentFile(root, file, notebooks), 'utf-8'));
      const updates = [...originals].map(([file, original]) => {
        const destination = file === relPath || file.startsWith(`${location.directory}/`) ? `${nextLocation.directory}${file.slice(location.directory.length)}` : file;
        const source = file === relPath ? content : original;
        const updated = file === relPath ? renameAgentSkillEntryContent(source, location.directory, nextLocation.directory, nextLocation.slug) : rewriteAgentSkillReferences(source, location.directory, nextLocation.directory);
        return { destination, file, original, updated };
      }).filter(update => update.file.startsWith(`${location.directory}/`) || update.updated !== update.original);

      fs.renameSync(oldDirectoryPath, newDirectoryPath);
      moved = true;
      for (const update of updates) if (update.updated !== update.original || update.file === relPath) fs.writeFileSync(resolveAgentFile(root, update.destination, notebooks), update.updated, 'utf-8');
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
          fs.writeFileSync(resolveAgentFile(root, file, notebooks), raw, 'utf-8');
        } catch (error) {
          rollbackErrors.push(error instanceof Error ? error.message : String(error));
        }
      }
      const failure = err instanceof Error ? err.message : String(err);
      res.status((err as { status?: number; }).status || 500).json({ error: rollbackErrors.length ? `${failure} Rollback failed: ${rollbackErrors.join('; ')}` : failure, rollbackFailed: rollbackErrors.length > 0 });
    }
  });

  // Restore a workspace file from Git HEAD.
  router.post('/restore', async (req: Request, res: Response) => {
    try {
      const { root, notebooks } = await worktree(res, req.body?.repository);
      const { path: relPath } = req.body;
      const safePath = workspacePath(root, relPath, notebooks);
      const change = (await listChanges(root)).find(file => file.path === relPath);
      if (!change?.tracked || !change.available) return res.status(409).json({ error: 'This file has no committed version to restore.' });
      await changeFile(root, relPath, 'restore', req.body.revision || change.revision);
      res.json({ success: true, path: relPath, content: fs.readFileSync(safePath, 'utf-8') });
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}
