import { classifyResource, loadWorkspaceConfig, managedNotebook, resolveSafePath, resolveWorkspaceAgentPath, workspaceAgentKind, workspaceDocument } from '@mygitnotes/core';
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

function validateWorkspacePath(repoRoot: string, reqPath: string, candidate: unknown, config: ReturnType<typeof loadWorkspaceConfig>): void {
  if (typeof candidate !== 'string') throw new Error('Paths must be strings.');
  resolveSafePath(repoRoot, candidate);
  const resource = classifyResource(candidate, config);
  const agentAccess = (reqPath.startsWith('/api/agent-resources') || reqPath.startsWith('/api/git/')) && workspaceAgentKind(candidate);
  const screenAccess = reqPath.startsWith('/api/git/') && (Boolean(workspaceDocument(candidate)) || resource.type === 'workspace_config');
  const fileAccess = reqPath.startsWith('/api/git/') && config && managedNotebook(candidate, config.notebooks);
  if (agentAccess) resolveWorkspaceAgentPath(repoRoot, candidate);
  if (!agentAccess && !screenAccess && !fileAccess && (!['note', 'asset', 'agent_instruction', 'agent_doc'].includes(resource.type) || !resource.notebookId)) {
    const err = new Error('Path is outside configured workspace resources.') as Error & { status?: number; };
    err.status = 403;
    throw err;
  }
}

function handlePathValidationError(res: express.Response, error: unknown): void {
  const status = (error as { status?: number; }).status || 400;
  res.status(status).json({ error: (error as Error).message });
}

export function createLocalApp(repoRoot: string, appRoot = repoRoot): express.Express {
  const app = express();
  app.use(async (req, res, next) => {
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        if (await getCurrentBranch(repoRoot) !== 'main') return res.status(403).json({ error: 'Switch to the main workspace branch to edit notes.' });
      }
      const config = loadWorkspaceConfig(repoRoot);
      const candidate = req.query.path;
      if (typeof candidate === 'string') {
        validateWorkspacePath(repoRoot, req.path, candidate, config);
      }
      next();
    } catch (error) {
      handlePathValidationError(res, error);
    }
  });
  app.use(express.json({ limit: '8mb' }));
  app.use((req, res, next) => {
    try {
      const config = loadWorkspaceConfig(repoRoot);
      const candidates = [req.body?.path, ...(Array.isArray(req.body?.files) ? req.body.files : [])].filter(p => p !== undefined);
      for (const candidate of candidates) {
        validateWorkspacePath(repoRoot, req.path, candidate, config);
      }
      next();
    } catch (error) {
      handlePathValidationError(res, error);
    }
  });

  app.use('/raw-assets', createLocalRawAssetsRouter(repoRoot));

  app.use('/api/workspace', createLocalWorkspaceRouter(repoRoot));
  app.use('/api/notes', createLocalNotesRouter(repoRoot));
  app.use(createLocalFoldersTemplatesRouter(repoRoot));
  app.use('/api/tags', createLocalTagsRouter(repoRoot));
  app.use('/api/agent-resources', createLocalAgentResourcesRouter(repoRoot, appRoot));
  app.use('/api/assets', createLocalAssetsRouter(repoRoot));
  app.use('/api/git', createLocalGitRouter(repoRoot));
  app.use('/api/core', createLocalCoreUpdateRouter(appRoot));

  // 7. Static Web UI Serving
  const webDist = path.join(repoRoot, 'apps/web/dist');
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
