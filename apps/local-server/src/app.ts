import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSourceConfig, sourceIdentity, RemoteSource, createRemoteSource, SourceError, workspaceAgentKind, workspaceAgentResource, type WorkspaceAgentResource } from '@mygitnotes/core';
import { createRemoteMCP } from './mcp.js';
import { createLocalApp } from './local-app.js';
import { createAuth, authToken } from './auth.js';
import { createStudyRouter } from './study.js';
import { createScreenPageRouter } from './screen-page.js';
import { createFolderManagerRouter } from './folder-manager.js';
import { createFileManagerRouter } from './file-manager.js';

export function applicationRoot() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return dir;
}

export function createApp(base: string): express.Express {
  const app = express();
  app.disable('x-powered-by');
  let source: ReturnType<typeof loadSourceConfig> | undefined;
  let setupError = '';
  try { source = loadSourceConfig(base); if (process.env.VERCEL && source.type === 'local') throw new Error('Vercel requires a GitHub or GitLab source. Configure MYGITNOTES_SOURCE, MYGITNOTES_REPOSITORY and MYGITNOTES_BRANCH.'); }
  catch (error) { setupError = (error as Error).message; source = undefined; }
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api') || req.path.startsWith('/raw-assets') || (req.path === '/mcp' || req.path.startsWith('/mcp/'))) res.setHeader('Cache-Control', 'private, no-store');
    if (source?.type === 'local') {
      const hostname = req.hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return res.status(403).json({ error: 'Local workspace access requires a loopback host.' });
    }
    const origin = req.headers.origin;
    const allowed = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    if (origin && origin !== allowed && !(source?.type === 'local' && /^http:\/\/(localhost|127\.0\.0\.1):(5173|4321)$/.test(origin))) return res.status(403).json({ error: 'Origin is not allowed.' });
    next();
  });
  app.use(express.json({ limit: '8mb' }));
  app.use('/api/auth', createAuth(base));
  if (source) app.use(createFileManagerRouter(base, source));
  if (source) app.use('/api/study', createStudyRouter(base, source));
  if (source) app.use('/api/screen-page', createScreenPageRouter(base, source));
  if (source) app.use('/api/folder-manager', createFolderManagerRouter(base, source));
  app.use('/mcp', createRemoteMCP(base, source));
  if (source?.type === 'local') app.use(createLocalApp(source.path));
  else {
    app.use(['/api', '/raw-assets'], async (req, res, next) => {
      if (!source) return res.status(503).json({ error: setupError, setupRequired: true });
      try {
        const token = await authToken(req, base);
        res.locals.reader = createRemoteSource(source, token);
        res.locals.authenticated = Boolean(token);
        next();
      } catch (error) { res.status(401).json({ error: 'Session unavailable. Sign in again.' }); }
    });
    app.get('/api/workspace', async (req, res) => {
      try {
        const reader: RemoteSource = res.locals.reader;
        const snapshot = await reader.getSnapshot(req.query.fresh === '1');
        const config = await reader.config();
        res.json({ repoRoot: '', branch: reader.branch, config, gitStatus: { branch: reader.branch, isClean: true, staged: [], modified: [], untracked: [] },
          isCoreBranch: reader.branch === 'core', source: { type: source!.type, identity: sourceIdentity(source!), repository: reader.repository },
          revision: snapshot.sha, capabilities: { write: Boolean(res.locals.authenticated && snapshot.info.permissions?.push && reader.branch === 'main'), local: false } });
      } catch (error) { fail(res, error); }
    });
    app.get('/api/notes', async (req, res) => { try { res.json({ notes: await (res.locals.reader as RemoteSource).notes(req.query.notebookId as string) }); } catch (error) { fail(res, error); } });
    app.get('/api/folders', async (req, res) => { try { res.json({ folders: await (res.locals.reader as RemoteSource).folders() }); } catch (error) { fail(res, error); } });
    app.get('/api/notes/read', async (req, res) => { try { res.json({ note: await (res.locals.reader as RemoteSource).note(String(req.query.path || '')) }); } catch (error) { fail(res, error); } });
    app.post('/api/notes/read-batch', async (req, res) => {
      try { res.json({ notes: await (res.locals.reader as RemoteSource).readNotes(req.body.paths, req.body.revision) }); }
      catch (error) { fail(res, error); }
    });
    app.get('/api/assets', async (req, res) => { try { res.json({ assets: await (res.locals.reader as RemoteSource).assets(req.query.notebookId as string) }); } catch (error) { fail(res, error); } });
    for (const [method, operation] of [['post', 'upload'], ['patch', 'move'], ['delete', 'delete']] as const) {
      app[method]('/api/assets', async (req, res) => {
        try {
          if (!res.locals.authenticated) throw new SourceError('Sign in with write permission to manage assets.', 403);
          res.json(await (res.locals.reader as RemoteSource).mutateAsset(operation, { ...req.query, ...req.body }));
        } catch (error) { fail(res, error); }
      });
    }
    app.get('/raw-assets/by-hash/:hash', async (req, res) => {
      try {
        if (!/^[a-f0-9]{40}$/.test(req.params.hash)) throw new SourceError('Invalid asset hash.');
        const reader: RemoteSource = res.locals.reader;
        const config = await reader.config();
        const assets = (await Promise.all(config.notebooks.map(nb => reader.assets(nb.id)))).flat();
        const asset = assets.find(a => a.hash === req.params.hash);
        if (!asset) throw new SourceError('Asset not found.', 404);
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.type(path.extname(asset.name)).send(await reader.readFile(asset.path));
      } catch (error) { fail(res, error); }
    });
    app.get('/raw-assets/*', async (req, res) => {
      try {
        const reader: RemoteSource = res.locals.reader;
        const file = (req.params as Record<string, string>)[0];
        const config = await reader.config();
        const assetLists = await Promise.all(config.notebooks.map(nb => reader.assets(nb.id)));
        if (!assetLists.flat().some(asset => asset.path === file)) throw new SourceError('Path is not a workspace asset.', 403);
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.type(path.extname(file)).send(await reader.readFile(file));
      } catch (error) { fail(res, error); }
    });
    app.post('/api/notes/commit', async (req, res) => {
      try {
        if (!res.locals.authenticated) throw new SourceError('Sign in with write permission to commit notes.', 403);
        const { notes, revision, message, screen } = req.body;
        res.json(await (res.locals.reader as RemoteSource).commitNotes(notes, revision, message, screen));
      } catch (error) { fail(res, error); }
    });
    app.post('/api/notes', async (req, res) => {
      try {
        if (!res.locals.authenticated) throw new SourceError('Sign in with write permission to edit notes.', 403);
        const { path: file, content, metadata, revision, createOnly } = req.body;
        if (typeof file !== 'string' || typeof content !== 'string') throw new SourceError('path and content are required.');
        res.json(await (res.locals.reader as RemoteSource).save(file, content, metadata, revision, createOnly));
      } catch (error) { fail(res, error); }
    });
    app.get('/api/git/status', (req, res) => res.json({ status: { branch: source?.branch || '', isClean: true, staged: [], modified: [], untracked: [] }, commits: [] }));
    app.get('/api/agent-resources', async (req, res) => {
      try {
        const reader: RemoteSource = res.locals.reader;
        const snapshot = await reader.getSnapshot();
        const entries = snapshot.entries;
        const groups: { instructions: WorkspaceAgentResource[]; skills: WorkspaceAgentResource[]; docs: WorkspaceAgentResource[] } = { instructions: [], skills: [], docs: [] };
        const editable = Boolean(res.locals.authenticated && snapshot.info.permissions?.push && reader.branch === 'main');
        for (const entry of entries) {
          const kind = workspaceAgentKind(entry.path);
          if (kind && entry.type === 'blob' && entry.mode !== '120000') groups[kind].push(workspaceAgentResource(entry.path, editable));
        }
        res.json({ ...groups, revision: snapshot.sha });
      } catch (error) { fail(res, error); }
    });
    app.get('/api/agent-resources/read', async (req, res) => {
      try {
        const targetPath = req.query.path as string;
        if (!targetPath) throw new SourceError('path query required', 400);
        if (!workspaceAgentKind(targetPath)) throw new SourceError('Path is not a workspace Agent document.', 403);
        const reader: RemoteSource = res.locals.reader;
        const buf = await reader.readFile(targetPath);
        res.json({ path: targetPath, content: buf.toString('utf8'), revision: (await reader.getSnapshot()).sha });
      } catch (error) { fail(res, error); }
    });
    app.post('/api/agent-resources/save', async (req, res) => {
      try {
        if (!res.locals.authenticated) throw new SourceError('Sign in with write permission to edit Agent documents.', 403);
        const { path: file, content, revision } = req.body;
        const result = await (res.locals.reader as RemoteSource).saveAgentResource(file, content, revision);
        res.json({ ...result, path: file });
      } catch (error) { fail(res, error); }
    });
    app.use('/api', (req, res) => res.status(403).json({ error: 'This operation is available only in a local workspace.' }));
  }
  const web = path.join(base, 'apps/web/dist');
  app.use(express.static(web, { redirect: false }));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/raw-assets')) return res.status(404).end();
    res.sendFile(path.join(web, 'index.html'));
  });
  return app;
}

function fail(res: express.Response, error: unknown) {
  const retryAfter = error instanceof SourceError ? error.retryAfter : undefined;
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
  res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Request failed.', ...(retryAfter ? { retryAfter } : {}) });
}
