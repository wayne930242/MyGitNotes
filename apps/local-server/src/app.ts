import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyResource, deploymentConfigSource, FOCUS_DOCUMENT, isProductAgentDoc, lookupNotes, noteAgenda, noteFacets, noteGraph, parseNoteQuery, productAgentResources, queryNotePaths, queryNotes, r2SettingsFromEnv, readProductAgentDoc, RemoteSource, replaceNoteTags, type RepositoryStatus, resolveSafePath, SourceError, StaleRevisionError, workspaceAgentKind, type WorkspaceAgentResource, workspaceAgentResource, type WorkspaceConfigSource, type WorkspaceStatus } from '@mygitnotes/core';
import { createRemoteCache } from './remote-cache-store.js';
import { createRemoteMCP } from './mcp.js';
import { createRemoteCoreUpdateRouter } from './remote-core-update.js';
import { createLocalApp } from './local-app.js';
import { createAuth } from './auth.js';
import { asLocal, asRemote, eachRepository, namedRemote, notebookRepository, noteRepository, type RemoteHandle, remoteHome, repositoryOrHome, requestCatalog, requestWorkspace, workspaceOf } from './request-workspace.js';
import { createStudyRouter } from './study.js';
import { createWorkspaceDocumentRouter } from './workspace-document.js';
import { createFolderManagerRouter } from './folder-manager.js';
import { createR2AssetHandler } from './r2-assets.js';
import { createR2ManagerRouter } from './r2-manager.js';
import { createFileManagerRouter } from './file-manager.js';
import { createGistRouter, gistToken, noteGist, syncGists } from './gists.js';

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

/** `configSource` decides, per request, which workspace a request serves; it defaults to the deployment's environment and server configuration. */
export function createApp(base: string, configSource: WorkspaceConfigSource = deploymentConfigSource(base)): express.Express {
  const app = express();
  app.disable('x-powered-by');
  const local = configSource.mode === 'local';
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api') || req.path.startsWith('/raw-assets') || req.path.startsWith('/r2-assets') || (req.path === '/mcp' || req.path.startsWith('/mcp/'))) res.setHeader('Cache-Control', 'private, no-store');
    if (local) {
      const hostname = req.hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return res.status(403).json({ error: 'Local workspace access requires a loopback host.' });
    }
    const origin = req.headers.origin;
    const allowed = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    // `pnpm dev:remote` names the one tailnet origin that reaches the local app through Tailscale Serve and the vite proxy.
    const isLocalDevOrigin = local && (isLoopbackHttpOrigin(origin) || (Boolean(process.env.MYGITNOTES_REMOTE_ORIGIN) && origin === process.env.MYGITNOTES_REMOTE_ORIGIN));
    if (origin && origin !== allowed && !isLocalDevOrigin) return res.status(403).json({ error: 'Origin is not allowed.' });
    next();
  });
  // An MCP asset upload carries its file inside the JSON-RPC body, and a bucket-bound one is not
  // held to the repository size limit, so the MCP route parses ahead of the shared 8 MiB ceiling.
  if (r2SettingsFromEnv()) app.use('/mcp', express.json({ limit: '64mb' }));
  app.use(express.json({ limit: '8mb' }));
  app.use('/api/auth', createAuth(base, configSource));
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
  const cache = local ? undefined : createRemoteCache();
  app.use('/mcp', createRemoteMCP(base, configSource, cache));
  app.use(['/api', '/raw-assets', '/r2-assets'], requestWorkspace(base, configSource, cache));
  app.use(createFileManagerRouter());
  app.use(createR2ManagerRouter());
  app.use('/api/study', createStudyRouter());
  app.use('/api/focus-page', createWorkspaceDocumentRouter(FOCUS_DOCUMENT));
  app.use('/api/folder-manager', createFolderManagerRouter());
  if (local) {
    app.get(
      '/r2-assets/*',
      createR2AssetHandler(async (res, notePath) => {
        const { handle, config } = await noteRepository(res, notePath);
        if (classifyResource(notePath, config).type !== 'note') throw new Error('Path is not a configured note.');
        return fs.readFileSync(resolveSafePath(asLocal(handle).root, notePath), 'utf8');
      }),
    );
    app.use(createLocalApp(base));
  } else {
    /** Whether the request carries a signed-in session; each repository still checks its own access. */
    const signedIn = (res: express.Response) => remoteHome(res).authenticated;
    const remoteNotebook = async (res: express.Response, notebookId: unknown) => asRemote((await notebookRepository(res, notebookId)).handle);
    const remoteNote = async (res: express.Response, file: unknown, notebookId?: unknown) => asRemote((await noteRepository(res, file, notebookId)).handle);
    const remoteRepositories = async (res: express.Response) => (await eachRepository(res)).map(({ handle }) => asRemote(handle));
    app.use('/api/core', createRemoteCoreUpdateRouter(base));
    app.use(createGistRouter());
    /** Pushes committed notes that name a Gist to it; notes that name none cost nothing. */
    const publishedGists = async (res: express.Response, notes: { path: string; content: string; metadata: Record<string, unknown>; }[]) => {
      const token = gistToken(res);
      return token && notes.some(note => noteGist(note.metadata)) ? { gists: await syncGists(token, notes) } : {};
    };
    app.get('/api/workspace', async (req, res) => {
      try {
        const workspace = workspaceOf(res);
        const fresh = req.query.fresh === '1';
        // The manifest is read from the home repository, so a fresh answer reloads it first.
        if (fresh) await remoteHome(res).reader.getSnapshot(true);
        const [{ config, revision: configRevision }, entries] = await Promise.all([workspace.manifest(), workspace.all()]);
        const repositories = await Promise.all(entries.map(async (entry): Promise<RepositoryStatus> => {
          const base = { id: entry.ref.id, type: entry.ref.source.type, repository: entry.ref.source.type === 'local' ? undefined : entry.ref.source.repository, notebooks: entry.notebooks.map(notebook => notebook.id) };
          if (!('handle' in entry)) return { ...base, branch: entry.ref.source.type === 'local' ? '' : entry.ref.source.branch, revision: '', write: false, unavailable: entry.unavailable };
          const handle = entry.handle as RemoteHandle;
          const snapshot = await handle.reader.getSnapshot(fresh && entry.ref.id !== workspace.home.ref.id);
          return { ...base, branch: handle.reader.branch, revision: snapshot.sha, write: handle.authenticated && handle.reader.canWrite(snapshot) };
        }));
        const body: WorkspaceStatus = { config, configRevision, local: false, home: workspace.home.ref.id, repositories };
        res.json(body);
      } catch (error) {
        fail(res, error);
      }
    });
    app.put('/api/workspace/config', async (req, res) => {
      try {
        if (!signedIn(res)) throw new SourceError('Sign in with write permission to edit the workspace manifest.', 403);
        const { configYaml, configRevision } = req.body;
        if (typeof configYaml !== 'string') throw new SourceError('configYaml is required.');
        const saved = await workspaceOf(res).saveManifest(configYaml, String(configRevision || ''));
        res.json({ success: true, config: saved.config, configRevision: saved.revision });
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/notes', async (req, res) => {
      try {
        const { notebookId } = req.query;
        const readers = notebookId ? [await remoteNotebook(res, notebookId)] : await remoteRepositories(res);
        res.json({ notes: (await Promise.all(readers.map(({ reader }) => reader.notes(notebookId as string | undefined)))).flat() });
      } catch (error) {
        fail(res, error);
      }
    });
    /** `revisions` are the snapshots the browser is working from; reads always answer from each branch head. */
    const catalog = (res: express.Response, revisions: unknown) => requestCatalog(res, revisions, handle => (handle as RemoteHandle).reader.catalog());
    app.get('/api/notes/query', async (req, res) => {
      try {
        const { query, options } = parseNoteQuery(req.query);
        const notes = await catalog(res, req.query.revisions);
        res.json(options.select ? await queryNotePaths(notes, query) : await queryNotes(notes, query, options));
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/notes/facets', async (req, res) => {
      try {
        res.json(await noteFacets(await catalog(res, req.query.revisions), req.query.showHidden === '1'));
      } catch (error) {
        fail(res, error);
      }
    });
    app.post('/api/notes/lookup', async (req, res) => {
      try {
        res.json(await lookupNotes(await catalog(res, req.body?.revisions), req.body?.notes, req.body?.content === true));
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/notes/agenda', async (req, res) => {
      try {
        if (typeof req.query.notebookId !== 'string' || !req.query.notebookId) throw new SourceError('notebookId is required.');
        res.json(await noteAgenda(await catalog(res, req.query.revisions), req.query.notebookId, req.query.showHidden === '1'));
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/notes/graph', async (req, res) => {
      try {
        res.json(await noteGraph(await catalog(res, req.query.revisions)));
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/folders', async (req, res) => {
      try {
        res.json({ folders: (await Promise.all((await remoteRepositories(res)).map(({ reader }) => reader.folders()))).flat() });
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/templates/render', async (req, res) => {
      try {
        const { notebookId, templateId, title } = req.query;
        res.json(await (await remoteNotebook(res, notebookId)).reader.renderTemplate(String(notebookId || ''), String(templateId || ''), String(title || '')));
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/notes/read', async (req, res) => {
      try {
        res.json({ note: await (await remoteNote(res, req.query.path, req.query.notebookId)).reader.note(String(req.query.path)) });
      } catch (error) {
        fail(res, error);
      }
    });
    app.post('/api/notes/read-batch', async (req, res) => {
      try {
        res.json({ notes: await (await namedRemote(res, req.body?.repository)).reader.readNotes(req.body.paths, req.body.revision) });
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/assets', async (req, res) => {
      try {
        // Without a notebook the listing covers the manifest's first notebook.
        const notebookId = req.query.notebookId || (await workspaceOf(res).manifest()).config.notebooks[0]?.id;
        res.json({ assets: await (await remoteNotebook(res, notebookId)).reader.assets(notebookId as string) });
      } catch (error) {
        fail(res, error);
      }
    });
    for (const [method, operation] of [['post', 'upload'], ['patch', 'move'], ['delete', 'delete']] as const) {
      app[method]('/api/assets', async (req, res) => {
        try {
          if (!signedIn(res)) throw new SourceError('Sign in with write permission to manage assets.', 403);
          const args = { ...req.query, ...req.body };
          const target = operation === 'upload' ? await remoteNotebook(res, args.notebookId) : await remoteNote(res, args.path);
          res.json(await target.reader.mutateAsset(operation, args));
        } catch (error) {
          fail(res, error);
        }
      });
    }
    app.get('/r2-assets/*', createR2AssetHandler(async (res, notePath) => (await (await remoteNote(res, notePath)).reader.note(notePath)).content));
    app.get('/raw-assets/by-hash/:hash', async (req, res) => {
      try {
        if (!/^[a-f0-9]{40}$/.test(req.params.hash)) throw new SourceError('Invalid asset hash.');
        let found: { reader: RemoteSource; path: string; name: string; } | undefined;
        for (const { reader } of await remoteRepositories(res)) {
          const config = await reader.config();
          const asset = (await Promise.all(config.notebooks.map(nb => reader.assets(nb.id)))).flat().find(a => a.hash === req.params.hash);
          if (asset) found = { reader, path: asset.path, name: asset.name };
          if (found) break;
        }
        if (!found) throw new SourceError('Asset not found.', 404);
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.type(path.extname(found.name)).send(await found.reader.readFile(found.path));
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/raw-assets/*', async (req, res) => {
      try {
        const file = (req.params as Record<string, string>)[0];
        // `notebook` names the asset's notebook, since notebook roots may repeat across repositories.
        const { reader } = await remoteNote(res, file, req.query.notebook);
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
        // An anonymous request is refused before its body is read.
        if (!signedIn(res)) throw new SourceError('Sign in with write permission to commit notes.', 403);
        const { repository, notes, revision, message, documents } = req.body;
        const target = await namedRemote(res, repository);
        if (!target.authenticated) throw new SourceError('Sign in with write permission to commit notes.', 403);
        const receipt = await target.reader.commitNotes(notes, revision, message, documents);
        res.json({ ...receipt, ...await publishedGists(res, notes) });
      } catch (error) {
        fail(res, error);
      }
    });
    app.post('/api/notes', async (req, res) => {
      try {
        if (!signedIn(res)) throw new SourceError('Sign in with write permission to edit notes.', 403);
        const { path: file, content, metadata, revision, createOnly, notebookId } = req.body;
        if (typeof file !== 'string' || typeof content !== 'string') throw new SourceError('path and content are required.');
        const saved = await (await remoteNote(res, file, notebookId)).reader.save(file, content, metadata, revision, createOnly);
        res.json({ ...saved, ...await publishedGists(res, [saved.note]) });
      } catch (error) {
        fail(res, error);
      }
    });
    // Apply an explicit tags array to each of the given notes and create one remote commit
    // for the whole batch. Used for tag rename/merge/delete and for undoing any of them (the
    // caller computes the target `tags` per note; this endpoint only writes and commits).
    app.post('/api/tags/apply', async (req, res) => {
      try {
        if (!signedIn(res)) throw new SourceError('Sign in with write permission to edit notes.', 403);
        const target = await namedRemote(res, req.body?.repository);
        if (!target.authenticated) throw new SourceError('Sign in with write permission to edit notes.', 403);
        const entries = req.body?.entries;
        if (!Array.isArray(entries) || entries.length === 0 || entries.length > 500) throw new SourceError('entries must be an array of 1 to 500 items.');
        for (const entry of entries) {
          if (typeof entry?.path !== 'string' || !Array.isArray(entry.tags) || entry.tags.some((tag: unknown) => typeof tag !== 'string')) throw new SourceError('Each entry requires a path and a tags array of strings.');
        }
        const { reader } = target;
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
    // Agent routes act on the repository a request names, the home repository by default.
    app.get('/api/git/status', (req, res) => res.json({ status: { branch: remoteHome(res).reader.branch, isClean: true, staged: [], modified: [], untracked: [] }, commits: [] }));
    app.get('/api/agent-resources', async (req, res) => {
      try {
        const { reader, authenticated } = asRemote((await repositoryOrHome(res, req.query.repository)).handle);
        const snapshot = await reader.getSnapshot();
        const entries = snapshot.entries;
        const groups: { instructions: WorkspaceAgentResource[]; skills: WorkspaceAgentResource[]; docs: WorkspaceAgentResource[]; } = { instructions: [], skills: [], docs: [] };
        const editable = Boolean(authenticated && snapshot.info.permissions?.push && reader.branch === 'main');
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
        const { reader } = asRemote((await repositoryOrHome(res, req.query.repository)).handle);
        const buf = await reader.readFile(targetPath);
        res.json({ path: targetPath, content: buf.toString('utf8'), revision: (await reader.getSnapshot()).sha });
      } catch (error) {
        fail(res, error);
      }
    });
    app.post('/api/agent-resources/save', async (req, res) => {
      try {
        if (!signedIn(res)) throw new SourceError('Sign in with write permission to edit Agent documents.', 403);
        const { path: file, content, revision, create, repository } = req.body;
        const result = await asRemote((await repositoryOrHome(res, repository)).handle).reader.saveAgentResource(file, content, revision, create);
        res.json({ ...result, path: file });
      } catch (error) {
        fail(res, error);
      }
    });
    app.post('/api/agent-resources/rename-skill', async (req, res) => {
      try {
        if (!signedIn(res)) throw new SourceError('Sign in with write permission to edit Agent documents.', 403);
        const { path: file, slug, content, revision, repository } = req.body;
        const result = await asRemote((await repositoryOrHome(res, repository)).handle).reader.renameAgentSkill(file, slug, content, revision);
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
  res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Request failed.', ...(retryAfter ? { retryAfter } : {}), ...(error instanceof StaleRevisionError ? { staleRepositories: error.repositories } : {}) });
}
