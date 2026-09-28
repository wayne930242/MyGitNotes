import { classifyResource, managedNotebook, resolveSafePath, resolveWorkspaceAgentPath, SourceError, workspaceAgentKind, type WorkspaceConfig, workspaceDocument } from '@mygitnotes/core';
import express, { Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { getCurrentBranch } from '@mygitnotes/git';
import { createLocalWorkspaceRouter } from './local-workspace.js';
import { createLocalNotesRouter } from './local-notes.js';
import { createLocalFoldersTemplatesRouter } from './local-folders-templates.js';
import { createLocalTagsRouter } from './local-tags.js';
import { createLocalAgentResourcesRouter } from './local-agent-resources.js';
import { createLocalAssetsRouter } from './local-assets.js';
import { createLocalGitRouter } from './local-git.js';
import { createLocalCoreUpdateRouter } from './local-core-update.js';
import { createLocalRawAssetsRouter } from './local-raw-assets.js';
import { asLocal, localHome, localRepository, noteRepository } from './request-workspace.js';

function validateWorkspacePath(repoRoot: string, reqPath: string, candidate: unknown, config: WorkspaceConfig): void {
  if (typeof candidate !== 'string') throw new Error('Paths must be strings.');
  resolveSafePath(repoRoot, candidate);
  const resource = classifyResource(candidate, config);
  const agentAccess = (reqPath.startsWith('/api/agent-resources') || reqPath.startsWith('/api/git/')) && workspaceAgentKind(candidate);
  const screenAccess = reqPath.startsWith('/api/git/') && (Boolean(workspaceDocument(candidate)) || resource.type === 'workspace_config');
  const fileAccess = reqPath.startsWith('/api/git/') && managedNotebook(candidate, config.notebooks);
  if (agentAccess) resolveWorkspaceAgentPath(repoRoot, candidate);
  if (!agentAccess && !screenAccess && !fileAccess && (!['note', 'asset', 'agent_instruction', 'agent_doc'].includes(resource.type) || !resource.notebookId)) {
    const err = new Error('Path is outside configured workspace resources.') as Error & { status?: number; };
    err.status = 403;
    throw err;
  }
}

/** Requests that act on the workspace; static web files pass through untouched. */
const workspaceRequest = (requestPath: string) => ['/api/', '/raw-assets/', '/r2-assets/'].some(prefix => requestPath.startsWith(prefix));

/** The worktree a path belongs to: the named notebook's repository, the repository of the notebook containing it, or the home repository for workspace-level files. */
async function worktreeOf(res: express.Response, candidate: string, notebookId: unknown): Promise<{ root: string; config: WorkspaceConfig; }> {
  const resolved = await noteRepository(res, candidate, notebookId).catch((error: unknown) => {
    if (error instanceof SourceError && error.status === 403) return undefined;
    throw error;
  });
  return resolved ? { root: asLocal(resolved.handle).root, config: resolved.config } : localRepository(res);
}

function handlePathValidationError(res: express.Response, error: unknown): void {
  const status = (error as { status?: number; }).status || 400;
  res.status(status).json({ error: (error as Error).message });
}

/** Routes over the local worktrees; each request resolves its repository through the request workspace. */
export function createLocalApp(appRoot: string): express.Express {
  const app = express();
  // Product updates use the Core checkout, independently of workspace write eligibility.
  app.use('/api/core', express.json({ limit: '8mb' }), createLocalCoreUpdateRouter(appRoot));
  app.use(express.json({ limit: '8mb' }));
  // Every path a request names is checked against the worktree it belongs to, and a write needs
  // each of those worktrees on `main`.
  app.use(async (req, res, next) => {
    if (!workspaceRequest(req.path)) return next();
    try {
      // A request without paths needs no manifest, so a workspace can save its first manifest.
      const candidates = [req.query.path, req.body?.path, ...(Array.isArray(req.body?.files) ? req.body.files : [])].filter(p => p !== undefined);
      const notebookId = req.query.notebookId ?? req.body?.notebookId;
      const roots = new Set<string>();
      for (const candidate of candidates) {
        if (typeof candidate !== 'string') throw new Error('Paths must be strings.');
        const { root, config } = await worktreeOf(res, candidate, notebookId);
        validateWorkspacePath(root, req.path, candidate, config);
        roots.add(root);
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        if (!roots.size) roots.add(localHome(res).root);
        for (const root of roots) {
          if (await getCurrentBranch(root) !== 'main') return res.status(403).json({ error: 'Switch to the main workspace branch to edit notes.' });
        }
      }
      next();
    } catch (error) {
      handlePathValidationError(res, error);
    }
  });

  app.use('/raw-assets', createLocalRawAssetsRouter());

  app.use('/api/workspace', createLocalWorkspaceRouter());
  app.use('/api/notes', createLocalNotesRouter());
  app.use(createLocalFoldersTemplatesRouter());
  app.use('/api/tags', createLocalTagsRouter());
  app.use('/api/agent-resources', createLocalAgentResourcesRouter(appRoot));
  app.use('/api/assets', createLocalAssetsRouter());
  app.use('/api/git', createLocalGitRouter());

  // 7. Static Web UI Serving
  const webDist = path.join(appRoot, 'apps/web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { redirect: false }));
    app.get('*', (req: Request, res: Response, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/raw-assets') || req.path.startsWith('/r2-assets')) {
        return next();
      }
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  return app;
}
