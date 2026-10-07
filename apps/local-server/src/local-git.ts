import { Request, Response, Router } from 'express';
import fs from 'node:fs';
import { agentFileAllowed, classifyResource, historyFile, managedNotebook, resolveAgentFile, resolveSafePath, versionedPath, WORKSPACE_DOCUMENTS, type WorkspaceConfig, workspaceDocument } from '@mygitnotes/core';
import { changeFile, commitSelectedFiles, commitStagedFiles, fileDiff, generateCommitMessage, getDiff, getGitStatus, getRecentCommits, listChanges, stageAndCommit, SyncError, syncWorkspace } from '@mygitnotes/git';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { newVersion } from './note-history.js';
import { eachRepository, type LocalHandle, repositoryOrHome } from './request-workspace.js';

export function createLocalGitRouter(): Router {
  const router = Router();

  const canManageChange = (repoRoot: string, config: WorkspaceConfig, file: string) => {
    try {
      const target = resolveSafePath(repoRoot, file);
      if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) return false;
      // A version file moves with its note in the worktree, so it is committed or discarded with that move.
      if (versionedPath(file)) return true;
      if (agentFileAllowed(file, config.notebooks)) {
        resolveAgentFile(repoRoot, file, config.notebooks);
        return true;
      }
      const resource = classifyResource(file, config);
      return Boolean(managedNotebook(file, config.notebooks)) || Boolean(workspaceDocument(file)) || resource.type === 'workspace_config' || file.startsWith('notes/') && ['note', 'compilation', 'outline', 'asset', 'agent_instruction', 'agent_doc'].includes(resource.type);
    } catch {
      return false;
    }
  };
  /** The worktree a request names in `repository`, or the home worktree, with the manifest scope it serves. */
  const worktree = async (res: Response, id: unknown): Promise<{ id: string; root: string; config: WorkspaceConfig; }> => {
    const { id: resolved, handle, config } = await repositoryOrHome(res, id);
    if (handle.kind !== 'local') throw new Error('This operation requires a local workspace.');
    return { id: resolved, root: handle.root, config };
  };
  // Every worktree's changes, each named by its repository: two worktrees can hold the same path.
  router.get('/changes', async (_req, res) => {
    try {
      const changes = await Promise.all((await eachRepository(res)).map(async ({ handle, config }) => {
        const { id, root: repoRoot } = handle as LocalHandle;
        return (await listChanges(repoRoot)).map(file => ({ ...file, repository: id, available: file.available && canManageChange(repoRoot, config, file.path), unavailableReason: file.kind === 'conflict' ? 'conflict' : !canManageChange(repoRoot, config, file.path) ? 'protected' : !file.available ? 'unsupported' : undefined }));
      }));
      res.json({ changes: changes.flat() });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  router.get('/file-diff', async (req, res) => {
    try {
      const { root: repoRoot, config } = await worktree(res, req.query.repository);
      const file = String(req.query.path || '');
      if (!canManageChange(repoRoot, config, file)) return res.status(403).json({ error: 'This file is outside workspace resources.' });
      res.json({ diff: await fileDiff(repoRoot, file, req.query.side === 'staged' ? 'staged' : req.query.side === 'current' ? 'current' : 'working') });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  router.post('/change', async (req, res) => {
    try {
      const { root: repoRoot, config } = await worktree(res, req.body.repository);
      const { path: file, action, revision } = req.body;
      if (!['stage', 'unstage', 'restore'].includes(action) || typeof revision !== 'string') return res.status(400).json({ error: 'An action and reviewed revision are required.' });
      if (!canManageChange(repoRoot, config, file)) return res.status(403).json({ error: 'This file is outside workspace resources.' });
      res.json({ success: true, ...await serializeWorkspaceMutation(repoRoot, () => changeFile(repoRoot, file, action, revision)) });
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });
  router.post('/commit-staged', async (req, res) => {
    try {
      const { root: repoRoot, config } = await worktree(res, req.body.repository);
      const { files, revisions, message, selected } = req.body;
      if (!Array.isArray(files) || !files.length || files.some(file => !canManageChange(repoRoot, config, file)) || typeof message !== 'string') return res.status(400).json({ error: 'Select writable workspace files and provide a message.' });
      const version = newVersion(req.body.version);
      if (version && (selected !== true || !historyFile(version.path, config.notebooks))) return res.status(400).json({ error: 'A new version commits its note alone.' });
      const expected = files.map(file => ({ path: file, revision: revisions?.[file] }));
      const commit = selected === true ? await commitSelectedFiles(repoRoot, expected, message, version) : await commitStagedFiles(repoRoot, expected, message);
      res.json({ success: true, commit });
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });
  router.get('/status', async (req: Request, res: Response) => {
    try {
      const { root: repoRoot } = await worktree(res, req.query.repository);
      const status = await getGitStatus(repoRoot);
      const commits = await getRecentCommits(repoRoot, 10);
      res.json({ status, commits });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/diff', async (req: Request, res: Response) => {
    try {
      const { root: repoRoot } = await worktree(res, req.query.repository);
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
      const { root: repoRoot } = await worktree(res, req.body.repository);
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
    const pullOnly = req.body?.pullOnly;
    if (pullOnly !== undefined && typeof pullOnly !== 'boolean') return res.status(400).json({ error: 'pullOnly must be a boolean.' });
    try {
      const { root: repoRoot } = await worktree(res, req.body?.repository);
      res.json({ result: await serializeWorkspaceMutation(repoRoot, () => syncWorkspace(repoRoot, strategy, { pullOnly })) });
    } catch (error) {
      if (!(error instanceof SyncError)) return res.status(500).json({ error: (error as Error).message });
      res.status(error.code === 'INVALID_BRANCH' ? 403 : error.code === 'FAILED' ? 502 : 409).json({ error: error.message, code: error.code, files: error.files });
    }
  });

  return router;
}
