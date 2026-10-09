import { Request, Response, Router } from 'express';
import { repositoryManifestStatus, type RepositoryStatus, SourceError, type WorkspaceStatus } from '@mygitnotes/core';
import { getCurrentBranch, getGitStatus } from '@mygitnotes/git';
import { type LocalHandle, workspaceOf } from './request-workspace.js';
import { openEventStream } from './event-stream.js';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { watchWorktrees } from './worktree-watch.js';

/** Every open worktree of the request's workspace, a worktree before its first manifest or with one that does not load included. */
async function workspaceWorktrees(res: Response): Promise<{ id: string; root: string; }[]> {
  const workspace = workspaceOf(res);
  const worktrees = await Promise.all((await workspace.all()).map(async entry => {
    if ('handle' in entry) return [{ id: entry.ref.id, root: (entry.handle as LocalHandle).root }];
    // A worktree whose manifest does not load is still watched, so fixing the file outside the app reloads it.
    return entry.unavailable.reason === 'invalid-manifest' && entry.member.localPath ? [{ id: entry.ref.id, root: entry.member.localPath }] : [];
  }));
  return worktrees.flat();
}

/** Files changed in any worktree, whoever wrote them, as server-sent `change` events naming the repositories. */
async function streamWorktreeChanges(_req: Request, res: Response) {
  await openEventStream(res, () => workspaceWorktrees(res), error => res.status(500).json({ error: error instanceof Error ? error.message : String(error) }), (worktrees, write) => watchWorktrees(worktrees, repositories => write(`event: change\ndata: ${JSON.stringify({ repositories })}\n\n`)));
}

export function createLocalWorkspaceRouter(): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const workspace = workspaceOf(res);
      const [keyedConfig, entries] = await Promise.all([workspace.keyedConfig(), workspace.all()]);
      // A worktree before its first manifest reports none, so Settings can create one.
      const repositories = await Promise.all(entries.map(async (entry): Promise<RepositoryStatus & { gitStatus?: unknown; }> => {
        const base = { id: entry.ref.id, type: entry.ref.source.type, repository: entry.ref.source.type === 'local' ? undefined : entry.ref.source.repository, revision: '', alias: entry.alias, notebooks: entry.notebooks.map(notebook => notebook.key), ...repositoryManifestStatus(await workspace.manifestOf(entry.ref.id)) };
        // A worktree whose manifest does not load is still read, so Settings can fix that manifest.
        const handle = ('handle' in entry ? entry.handle : await workspace.handleOf(entry.ref.id)) as LocalHandle | undefined;
        const unavailable = 'unavailable' in entry ? { unavailable: entry.unavailable } : {};
        if (!handle) return { ...base, branch: '', write: false, ...unavailable };
        const branch = await getCurrentBranch(handle.root);
        return { ...base, branch, write: branch === 'main', gitStatus: await getGitStatus(handle.root), ...unavailable };
      }));
      const body: WorkspaceStatus = { keyedConfig, local: true, defaultRepository: workspace.default?.ref.id ?? null, repositories, coreUpdate: true, ...(workspace.default?.localPath ? { repoRoot: workspace.default.localPath } : {}) };
      res.json(body);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/events', streamWorktreeChanges);

  // Saves one repository's manifest while the revision its editor started from is still current.
  router.put('/config', async (req: Request, res: Response) => {
    try {
      const { repository, configYaml, configRevision } = req.body;
      if (typeof repository !== 'string' || !repository) throw new SourceError('repository is required.');
      if (typeof configYaml !== 'string') throw new SourceError('configYaml is required.');
      if (typeof configRevision !== 'string') throw new SourceError('configRevision is required.');
      const workspace = workspaceOf(res);
      // A worktree whose manifest does not load is reachable here, so its manifest can be fixed.
      const handle = await workspace.handleOf(repository) as LocalHandle | undefined;
      if (!handle) throw new SourceError('Repository is unavailable.', 503);
      const saved = await serializeWorkspaceMutation(handle.root, () => workspace.saveManifest(repository, configYaml, configRevision));
      res.json({ success: true, configRevision: saved.revision });
    } catch (err: unknown) {
      res.status(err instanceof SourceError ? err.status : 400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
