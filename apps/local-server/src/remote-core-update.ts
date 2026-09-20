import { type CoreStatus, GitHubCoreUpdate, RemoteCoreError, type RemoteSourceConfig, SourceError } from '@mygitnotes/core';
import { Router } from 'express';
import { authToken } from './auth.js';
import { buildInfo } from './build-info.js';

export function createRemoteCoreUpdateRouter(base: string, source: RemoteSourceConfig): Router {
  const router = Router();
  for (const method of ['get', 'post'] as const) {
    router[method](method === 'get' ? '/status' : '/update', async (req, res) => {
      try {
        if (source.type !== 'github') {
          if (method === 'post') throw new RemoteCoreError('Core updates through GitLab are not supported yet.', 'UNSUPPORTED_PROVIDER', 422);
          const status: CoreStatus = { state: 'unsupported', canUpdate: false, current: null, upstreamSha: null, upstream: '', running: null, runningBuild: buildInfo.sha };
          return res.json({ status });
        }
        const updater = new GitHubCoreUpdate(source.repository, buildInfo.sha, await authToken(req, base));
        res.json(method === 'get' ? { status: await updater.status() } : { result: await updater.update() });
      } catch (error) {
        if (error instanceof SourceError && error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
        res.status(error instanceof SourceError ? error.status : 502).json({ error: error instanceof Error ? error.message : 'Core update request failed.', code: error instanceof RemoteCoreError ? error.code : 'REQUEST_FAILED' });
      }
    });
  }
  router.post('/install', async (req, res) => {
    try {
      if (source.type !== 'github') throw new RemoteCoreError('GitLab Core updates are not supported yet.', 'UNSUPPORTED_PROVIDER', 422);
      res.json(await new GitHubCoreUpdate(source.repository, buildInfo.sha, await authToken(req, base)).install());
    } catch (error) {
      res.status(error instanceof SourceError ? error.status : 502).json({ error: error instanceof Error ? error.message : 'Workflow installation failed.', code: error instanceof RemoteCoreError ? error.code : 'INSTALL_FAILED' });
    }
  });
  router.get('/runs/:requestId', async (req, res) => {
    try {
      if (source.type !== 'github') throw new RemoteCoreError('GitLab Core updates are not supported yet.', 'UNSUPPORTED_PROVIDER', 422);
      res.json({ run: await new GitHubCoreUpdate(source.repository, buildInfo.sha, await authToken(req, base)).follow(req.params.requestId) });
    } catch (error) {
      res.status(error instanceof SourceError ? error.status : 502).json({ error: error instanceof Error ? error.message : 'Run status unavailable.', code: error instanceof RemoteCoreError ? error.code : 'REQUEST_FAILED' });
    }
  });
  return router;
}
