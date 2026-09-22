import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyResource, createRemoteSource, FOCUS_DOCUMENT, isProductAgentDoc, loadSourceConfig, loadWorkspaceConfig, lookupNotes, noteAgenda, noteFacets, noteGraph, parseNoteQuery, parseRevision, productAgentResources, queryNotePaths, queryNotes, r2SettingsFromEnv, readProductAgentDoc, RemoteSource, replaceNoteTags, resolveSafePath, SCREEN_DOCUMENT, SourceError, sourceIdentity, workspaceAgentKind, type WorkspaceAgentResource, workspaceAgentResource } from '@mygitnotes/core';
import { createRemoteCache } from './remote-cache-store.js';
import { createRemoteMCP } from './mcp.js';
import { createRemoteCoreUpdateRouter } from './remote-core-update.js';
import { createLocalApp } from './local-app.js';
import { authToken, createAuth } from './auth.js';
import { createStudyRouter } from './study.js';
import { createWorkspaceDocumentRouter } from './workspace-document.js';
import { createFolderManagerRouter } from './folder-manager.js';
import { createR2AssetHandler } from './r2-assets.js';
import { createR2ManagerRouter } from './r2-manager.js';
import { createFileManagerRouter } from './file-manager.js';

function isLoopbackHttpOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

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
  try {
    source = loadSourceConfig(base);
    if (process.env.VERCEL && source.type === 'local') throw new Error('Vercel requires a GitHub or GitLab source. Configure MYGITNOTES_SOURCE, MYGITNOTES_REPOSITORY and MYGITNOTES_BRANCH.');
  } catch (error) {
    setupError = (error as Error).message;
    source = undefined;
  }
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api') || req.path.startsWith('/raw-assets') || req.path.startsWith('/r2-assets') || (req.path === '/mcp' || req.path.startsWith('/mcp/'))) res.setHeader('Cache-Control', 'private, no-store');
    if (source?.type === 'local') {
      const hostname = req.hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return res.status(403).json({ error: 'Local workspace access requires a loopback host.' });
    }
    const origin = req.headers.origin;
    const allowed = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const isLocalDevOrigin = source?.type === 'local' && isLoopbackHttpOrigin(origin);
    if (origin && origin !== allowed && !isLocalDevOrigin) return res.status(403).json({ error: 'Origin is not allowed.' });
    next();
  });
  // An MCP asset upload carries its file inside the JSON-RPC body, and a bucket-bound one is not
  // held to the repository size limit, so the MCP route parses ahead of the shared 8 MiB ceiling.
  if (r2SettingsFromEnv()) app.use('/mcp', express.json({ limit: '64mb' }));
  app.use(express.json({ limit: '8mb' }));
  app.use('/api/auth', createAuth(base));
  if (source) app.use(createFileManagerRouter(base, source));
  if (source) app.use(createR2ManagerRouter(base, source));
  if (source) app.use('/api/study', createStudyRouter(base, source));
  if (source) app.use('/api/screen-page', createWorkspaceDocumentRouter(base, source, SCREEN_DOCUMENT));
  if (source) app.use('/api/focus-page', createWorkspaceDocumentRouter(base, source, FOCUS_DOCUMENT));
  if (source) app.use('/api/folder-manager', createFolderManagerRouter(base, source));
  // Product reference documents come from this Core checkout, not from the workspace being served.
  app.get('/api/agent-resources/read', (req, res, next) => {
    const file = req.query.path;
    if (typeof file !== 'string' || !isProductAgentDoc(file)) return next();
    try {
      res.json({ path: file, content: readProductAgentDoc(base, file) });
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
    }
  });
  const cache = source && source.type !== 'local' ? createRemoteCache() : undefined;
  app.use('/mcp', createRemoteMCP(base, source, cache));
  if (source?.type === 'local') {
    const root = source.path;
    app.get(
      '/r2-assets/*',
      createR2AssetHandler(async (_res, notePath) => {
        if (classifyResource(notePath, loadWorkspaceConfig(root)).type !== 'note') throw new Error('Path is not a configured note.');
        return fs.readFileSync(resolveSafePath(root, notePath), 'utf8');
      }),
    );
    app.use(createLocalApp(root, base));
  } else {
    app.use(['/api', '/raw-assets', '/r2-assets'], async (req, res, next) => {
      if (!source) return res.status(503).json({ error: setupError, setupRequired: true });
      try {
        const token = await authToken(req, base);
        res.locals.reader = createRemoteSource(source, token, fetch, cache);
        res.locals.authenticated = Boolean(token);
        next();
      } catch {
        res.status(401).json({ error: 'Session unavailable. Sign in again.' });
      }
    });
    if (source) app.use('/api/core', createRemoteCoreUpdateRouter(base, source));
    app.get('/api/workspace', async (req, res) => {
      try {
        const reader: RemoteSource = res.locals.reader;
        const snapshot = await reader.getSnapshot(req.query.fresh === '1');
        const config = await reader.config();
        res.json({ repoRoot: '', branch: reader.branch, config, gitStatus: { branch: reader.branch, isClean: true, staged: [], modified: [], untracked: [] }, isCoreBranch: reader.branch === 'core', source: { type: source!.type, identity: sourceIdentity(source!), repository: reader.repository }, revision: snapshot.sha, capabilities: { write: Boolean(res.locals.authenticated && snapshot.info.permissions?.push && reader.branch === 'main'), local: false } });
      } catch (error) {
        fail(res, error);
      }
    });
    app.put('/api/workspace/config', async (req, res) => {
      try {
        if (!res.locals.authenticated) throw new SourceError('Sign in with write permission to edit the workspace manifest.', 403);
        const { configYaml, revision } = req.body;
        if (typeof configYaml !== 'string') throw new SourceError('configYaml is required.');
        const reader: RemoteSource = res.locals.reader;
        const result = await reader.saveWorkspaceConfig(configYaml, revision);
        res.json({ success: true, config: await reader.config(), revision: result.revision });
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/notes', async (req, res) => {
      try {
        res.json({ notes: await (res.locals.reader as RemoteSource).notes(req.query.notebookId as string) });
      } catch (error) {
        fail(res, error);
      }
    });
    /** `revision` is the snapshot the browser is working from; reads always answer from the branch head. */
    const catalog = async (res: express.Response, revision: unknown) => {
      const reader: RemoteSource = res.locals.reader;
      const expected = parseRevision(revision);
      const snapshot = await reader.getSnapshot();
      if (expected && expected !== snapshot.sha) throw new SourceError('The repository changed. Reload to continue from the latest revision.', 409);
      return reader.catalog();
    };
    app.get('/api/notes/query', async (req, res) => {
      try {
        const { query, options } = parseNoteQuery(req.query);
        const notes = await catalog(res, req.query.revision);
        res.json(options.select ? await queryNotePaths(notes, query) : await queryNotes(notes, query, options));
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/notes/facets', async (req, res) => {
      try {
        res.json(await noteFacets(await catalog(res, req.query.revision), req.query.showHidden === '1'));
      } catch (error) {
        fail(res, error);
      }
    });
    app.post('/api/notes/lookup', async (req, res) => {
      try {
        res.json(await lookupNotes(await catalog(res, req.body?.revision), req.body?.paths, req.body?.content === true));
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/notes/agenda', async (req, res) => {
      try {
        if (typeof req.query.notebookId !== 'string' || !req.query.notebookId) throw new SourceError('notebookId is required.');
        res.json(await noteAgenda(await catalog(res, req.query.revision), req.query.notebookId, req.query.showHidden === '1'));
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/notes/graph', async (req, res) => {
      try {
        res.json(await noteGraph(await catalog(res, req.query.revision)));
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/folders', async (req, res) => {
      try {
        res.json({ folders: await (res.locals.reader as RemoteSource).folders() });
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/templates/render', async (req, res) => {
      try {
        const { notebookId, templateId, title } = req.query;
        res.json(await (res.locals.reader as RemoteSource).renderTemplate(String(notebookId || ''), String(templateId || ''), String(title || '')));
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/notes/read', async (req, res) => {
      try {
        res.json({ note: await (res.locals.reader as RemoteSource).note(String(req.query.path || '')) });
      } catch (error) {
        fail(res, error);
      }
    });
    app.post('/api/notes/read-batch', async (req, res) => {
      try {
        res.json({ notes: await (res.locals.reader as RemoteSource).readNotes(req.body.paths, req.body.revision) });
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/assets', async (req, res) => {
      try {
        res.json({ assets: await (res.locals.reader as RemoteSource).assets(req.query.notebookId as string) });
      } catch (error) {
        fail(res, error);
      }
    });
    for (const [method, operation] of [['post', 'upload'], ['patch', 'move'], ['delete', 'delete']] as const) {
      app[method]('/api/assets', async (req, res) => {
        try {
          if (!res.locals.authenticated) throw new SourceError('Sign in with write permission to manage assets.', 403);
          res.json(await (res.locals.reader as RemoteSource).mutateAsset(operation, { ...req.query, ...req.body }));
        } catch (error) {
          fail(res, error);
        }
      });
    }
    app.get('/r2-assets/*', createR2AssetHandler(async (res, notePath) => (await (res.locals.reader as RemoteSource).note(notePath)).content));
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
      } catch (error) {
        fail(res, error);
      }
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
      } catch (error) {
        fail(res, error);
      }
    });
    app.post('/api/notes/commit', async (req, res) => {
      try {
        if (!res.locals.authenticated) throw new SourceError('Sign in with write permission to commit notes.', 403);
        const { notes, revision, message, documents } = req.body;
        res.json(await (res.locals.reader as RemoteSource).commitNotes(notes, revision, message, documents));
      } catch (error) {
        fail(res, error);
      }
    });
    app.post('/api/notes', async (req, res) => {
      try {
        if (!res.locals.authenticated) throw new SourceError('Sign in with write permission to edit notes.', 403);
        const { path: file, content, metadata, revision, createOnly } = req.body;
        if (typeof file !== 'string' || typeof content !== 'string') throw new SourceError('path and content are required.');
        res.json(await (res.locals.reader as RemoteSource).save(file, content, metadata, revision, createOnly));
      } catch (error) {
        fail(res, error);
      }
    });
    // Apply an explicit tags array to each of the given notes and create one remote commit
    // for the whole batch. Used for tag rename/merge/delete and for undoing any of them (the
    // caller computes the target `tags` per note; this endpoint only writes and commits).
    app.post('/api/tags/apply', async (req, res) => {
      try {
        if (!res.locals.authenticated) throw new SourceError('Sign in with write permission to edit notes.', 403);
        const entries = req.body?.entries;
        if (!Array.isArray(entries) || entries.length === 0 || entries.length > 500) throw new SourceError('entries must be an array of 1 to 500 items.');
        for (const entry of entries) {
          if (typeof entry?.path !== 'string' || !Array.isArray(entry.tags) || entry.tags.some((tag: unknown) => typeof tag !== 'string')) throw new SourceError('Each entry requires a path and a tags array of strings.');
        }
        const reader = res.locals.reader as RemoteSource;
        // Confirm write access before reading any blob content, matching commitChanges' own
        // gate, so a session without push permission can't use this route to probe arbitrary
        // repository paths ahead of the write-scope check that would otherwise reject them.
        const snapshot = await reader.getSnapshot();
        if (!snapshot.info.permissions?.push || reader.branch !== 'main') throw new SourceError('Write access on the main workspace branch is required.', 403);
        const changes: { path: string; content: string; }[] = [];
        for (const entry of entries) {
          const raw = (await reader.readFile(String(entry.path))).toString('utf8');
          const patched = replaceNoteTags(raw, entry.tags as string[]);
          if (patched === raw) continue;
          changes.push({ path: String(entry.path), content: patched });
        }
        if (changes.length === 0) return res.json({ success: true, changedPaths: [] });
        const message = typeof req.body.message === 'string' && req.body.message.trim() ? req.body.message.trim() : `docs(notes): update tags in ${changes.length} note${changes.length === 1 ? '' : 's'}`;
        const receipt = await reader.commitChanges(changes, String(req.body.revision || ''), 'tags', 'notes', message);
        res.json(receipt);
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/git/status', (req, res) => res.json({ status: { branch: source?.branch || '', isClean: true, staged: [], modified: [], untracked: [] }, commits: [] }));
    app.get('/api/agent-resources', async (req, res) => {
      try {
        const reader: RemoteSource = res.locals.reader;
        const snapshot = await reader.getSnapshot();
        const entries = snapshot.entries;
        const groups: { instructions: WorkspaceAgentResource[]; skills: WorkspaceAgentResource[]; docs: WorkspaceAgentResource[]; } = { instructions: [], skills: [], docs: [] };
        const editable = Boolean(res.locals.authenticated && snapshot.info.permissions?.push && reader.branch === 'main');
        for (const entry of entries) {
          const kind = workspaceAgentKind(entry.path);
          if (kind && entry.type === 'blob' && entry.mode !== '120000') groups[kind].push(workspaceAgentResource(entry.path, editable));
        }
        groups.docs.push(...productAgentResources(base));
        res.json({ ...groups, revision: snapshot.sha });
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/agent-resources/read', async (req, res) => {
      try {
        const targetPath = req.query.path as string;
        if (!targetPath) throw new SourceError('path query required', 400);
        if (!workspaceAgentKind(targetPath)) throw new SourceError('Path is not a workspace Agent document.', 403);
        const reader: RemoteSource = res.locals.reader;
        const buf = await reader.readFile(targetPath);
        res.json({ path: targetPath, content: buf.toString('utf8'), revision: (await reader.getSnapshot()).sha });
      } catch (error) {
        fail(res, error);
      }
    });
    app.post('/api/agent-resources/save', async (req, res) => {
      try {
        if (!res.locals.authenticated) throw new SourceError('Sign in with write permission to edit Agent documents.', 403);
        const { path: file, content, revision, create } = req.body;
        const result = await (res.locals.reader as RemoteSource).saveAgentResource(file, content, revision, create);
        res.json({ ...result, path: file });
      } catch (error) {
        fail(res, error);
      }
    });
    app.post('/api/agent-resources/rename-skill', async (req, res) => {
      try {
        if (!res.locals.authenticated) throw new SourceError('Sign in with write permission to edit Agent documents.', 403);
        const { path: file, slug, content, revision } = req.body;
        const result = await (res.locals.reader as RemoteSource).renameAgentSkill(file, slug, content, revision);
        res.json(result);
      } catch (error) {
        fail(res, error);
      }
    });
    app.use('/api', (req, res) => res.status(403).json({ error: 'This operation is available only in a local workspace.' }));
  }
  const web = path.join(base, 'apps/web/dist');
  app.use(express.static(web, { redirect: false }));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/raw-assets') || req.path.startsWith('/r2-assets')) return res.status(404).end();
    res.sendFile(path.join(web, 'index.html'));
  });
  return app;
}

function fail(res: express.Response, error: unknown) {
  const retryAfter = error instanceof SourceError ? error.retryAfter : undefined;
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
  res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Request failed.', ...(retryAfter ? { retryAfter } : {}) });
}
