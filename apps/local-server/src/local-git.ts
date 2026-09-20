import { Request, Response, Router } from 'express';
import fs from 'node:fs';
import { classifyResource, loadWorkspaceConfig, managedNotebook, resolveSafePath, resolveWorkspaceAgentPath, WORKSPACE_DOCUMENTS, workspaceAgentKind, workspaceDocument } from '@mygitnotes/core';
import { changeFile, commitSelectedFiles, commitStagedFiles, fileDiff, generateCommitMessage, getDiff, getGitStatus, getRecentCommits, listChanges, stageAndCommit, SyncError, syncWorkspace } from '@mygitnotes/git';
import { serializeWorkspaceMutation } from './workspace-mutation.js';

export function createLocalGitRouter(repoRoot: string): Router {
  const router = Router();

  const canManageChange = (file: string) => {
    try {
      const target = resolveSafePath(repoRoot, file);
      if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) return false;
      if (workspaceAgentKind(file)) {
        resolveWorkspaceAgentPath(repoRoot, file);
        return true;
      }
      const config = loadWorkspaceConfig(repoRoot);
      const resource = classifyResource(file, config);
      return Boolean(config && managedNotebook(file, config.notebooks)) || Boolean(workspaceDocument(file)) || resource.type === 'workspace_config' || file.startsWith('notes/') && ['note', 'asset', 'agent_instruction', 'agent_doc'].includes(resource.type);
    } catch {
      return false;
    }
  };
  router.get('/changes', async (_req, res) => {
    try {
      res.json({ changes: (await listChanges(repoRoot)).map(file => ({ ...file, available: file.available && canManageChange(file.path), unavailableReason: file.kind === 'conflict' ? 'conflict' : !canManageChange(file.path) ? 'protected' : !file.available ? 'unsupported' : undefined })) });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  router.get('/file-diff', async (req, res) => {
    try {
      const file = String(req.query.path || '');
      if (!canManageChange(file)) return res.status(403).json({ error: 'This file is outside workspace resources.' });
      res.json({ diff: await fileDiff(repoRoot, file, req.query.side === 'staged' ? 'staged' : req.query.side === 'current' ? 'current' : 'working') });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  router.post('/change', async (req, res) => {
    try {
      const { path: file, action, revision } = req.body;
      if (!['stage', 'unstage', 'restore'].includes(action) || typeof revision !== 'string') return res.status(400).json({ error: 'An action and reviewed revision are required.' });
      if (!canManageChange(file)) return res.status(403).json({ error: 'This file is outside workspace resources.' });
      res.json({ success: true, ...await changeFile(repoRoot, file, action, revision) });
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });
  router.post('/commit-staged', async (req, res) => {
    try {
      const { files, revisions, message, selected } = req.body;
      if (!Array.isArray(files) || !files.length || files.some(file => !canManageChange(file)) || typeof message !== 'string') return res.status(400).json({ error: 'Select writable workspace files and provide a message.' });
      const commit = await (selected === true ? commitSelectedFiles : commitStagedFiles)(repoRoot, files.map(file => ({ path: file, revision: revisions?.[file] })), message);
      res.json({ success: true, commit });
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });
  router.get('/status', async (req: Request, res: Response) => {
    try {
      const status = await getGitStatus(repoRoot);
      const commits = await getRecentCommits(repoRoot, 10);
      res.json({ status, commits });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/diff', async (req: Request, res: Response) => {
    try {
      const filePath = req.query.path as string | undefined;
      let diff = await getDiff(repoRoot, filePath);
      // New workspace documents have no Git diff until tracked; still make them reviewable.
      const documents = WORKSPACE_DOCUMENTS.filter(document => !filePath || filePath === document.file);
      const untracked = documents.length ? (await getGitStatus(repoRoot)).untracked : [];
      for (const { file: name, maxBytes } of documents) {
        if (!untracked.includes(name)) continue;
        const file = resolveSafePath(repoRoot, name);
        const stat = fs.lstatSync(file);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= maxBytes) {
          const lines = fs.readFileSync(file, 'utf8').split('\n');
          diff += `\n--- /dev/null\n+++ ${name}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => '+' + line).join('\n')}`;
        }
      }
      res.json({ diff });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/semantic-commit', async (req: Request, res: Response) => {
    try {
      const { diff, filePath } = req.body;
      const message = await generateCommitMessage({ diff, filePath });
      res.json({ message });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/commit', async (req: Request, res: Response) => {
    try {
      const { files, message } = req.body;
      if (!files || !Array.isArray(files) || files.length === 0 || !message) {
        return res.status(400).json({ error: 'files (array) and message (string) required' });
      }
      const result = await stageAndCommit(repoRoot, files, message);
      res.json({ success: true, commit: result });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/sync', async (req, res) => {
    const strategy = req.body?.strategy;
    if (strategy !== undefined && strategy !== 'remote' && strategy !== 'local') return res.status(400).json({ error: 'Unknown sync strategy.' });
    try {
      res.json({ result: await serializeWorkspaceMutation(repoRoot, () => syncWorkspace(repoRoot, strategy)) });
    } catch (error) {
      if (!(error instanceof SyncError)) return res.status(500).json({ error: (error as Error).message });
      res.status(error.code === 'INVALID_BRANCH' ? 403 : error.code === 'FAILED' ? 502 : 409).json({ error: error.message, code: error.code, files: error.files });
    }
  });

  return router;
}
