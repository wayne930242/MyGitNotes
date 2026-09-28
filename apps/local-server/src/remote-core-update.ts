import { type CoreStatus, GitHubCoreUpdate, RemoteCoreError, type RemoteSourceConfig, SourceError } from '@mygitnotes/core';
import { type Request, type Response, Router } from 'express';
import { authToken } from './auth.js';
import { buildInfo } from './build-info.js';
import { workspaceOf } from './request-workspace.js';

/** Core updates act on the home repository, which carries the `core` branch. */
function homeSource(res: Response): RemoteSourceConfig {
  const { source } = workspaceOf(res).home.ref;
  if (source.type === 'local') throw new SourceError('Remote Core updates require a remote source.', 400);
  return source;
}

export function createRemoteCoreUpdateRouter(base: string): Router {
  const router = Router();
  const updater = async (req: Request, res: Response, source: RemoteSourceConfig & { type: 'github'; }) => new GitHubCoreUpdate(source.repository, buildInfo.sha, await authToken(req, base, source));
  for (const method of ['get', 'post'] as const) {
    router[method](method === 'get' ? '/status' : '/update', async (req, res) => {
      try {
        const source = homeSource(res);
        if (source.type !== 'github') {
          if (method === 'post') throw new RemoteCoreError('Core updates through GitLab are not supported yet.', 'UNSUPPORTED_PROVIDER', 422);
          const status: CoreStatus = { state: 'unsupported', canUpdate: false, current: null, upstreamSha: null, upstream: '', running: null, runningBuild: buildInfo.sha };
          return res.json({ status });
        }
        const update = await updater(req, res, source);
        res.json(method === 'get' ? { status: await update.status() } : { result: await update.update() });
      } catch (error) {
        if (error instanceof SourceError && error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
        res.status(error instanceof SourceError ? error.status : 502).json({ error: error instanceof Error ? error.message : 'Core update request failed.', code: error instanceof RemoteCoreError ? error.code : 'REQUEST_FAILED' });
      }
    });
  }
  router.post('/install', async (req, res) => {
    try {
      const source = homeSource(res);
      if (source.type !== 'github') throw new RemoteCoreError('GitLab Core updates are not supported yet.', 'UNSUPPORTED_PROVIDER', 422);
      res.json(await (await updater(req, res, source)).install());
    } catch (error) {
      res.status(error instanceof SourceError ? error.status : 502).json({ error: error instanceof Error ? error.message : 'Workflow installation failed.', code: error instanceof RemoteCoreError ? error.code : 'INSTALL_FAILED' });
    }
  });
  router.get('/runs/:requestId', async (req, res) => {
    try {
      const source = homeSource(res);
      if (source.type !== 'github') throw new RemoteCoreError('GitLab Core updates are not supported yet.', 'UNSUPPORTED_PROVIDER', 422);
      res.json({ run: await (await updater(req, res, source)).follow(req.params.requestId) });
    } catch (error) {
      res.status(error instanceof SourceError ? error.status : 502).json({ error: error instanceof Error ? error.message : 'Run status unavailable.', code: error instanceof RemoteCoreError ? error.code : 'REQUEST_FAILED' });
    }
  });
  return router;
}
