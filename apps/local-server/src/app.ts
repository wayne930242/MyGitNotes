import express from 'express';
import type { RemoteCache } from '@mygitnotes/core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { agentWorkspaceFile, agentWorkspaces, BOOKMARKS_DOCUMENT, classifyResource, FOCUS_DOCUMENT, keyedItem, lookupNotes, noteAgenda, type NotebookConfig, noteFacets, noteGraph, parseNoteQuery, productRepository, queryNotePaths, queryNotes, RemoteSource, replaceFileTags, repositoryManifestStatus, type RepositoryStatus, resolveSafePath, SourceError, StaleRevisionError, type UnavailableReason, visibleMembers, type WorkspaceConfigSource, type WorkspaceStatus } from '@mygitnotes/core';
import { createRemoteCache } from './remote-cache-store.js';
import { createRecordStore, NoRecordStore, type RecordStore, storageMode } from './record-store/index.js';
import { type BrowserSessions, cookieSessions, storedSessions } from './browser-sessions.js';
import { choosesRepository, chosenRepositorySource, cookieWorkspaceChoices, workspaceChoiceRouter, type WorkspaceChoices } from './workspace-choice.js';
import { createRemoteMCP } from './mcp.js';
import { createRemoteCoreUpdateRouter } from './remote-core-update.js';
import { createLocalApp } from './local-app.js';
import { createAuth } from './auth.js';
import { asLocal, asRemote, defaultRepository, eachRepository, namedRemote, namedRepository, notebookRepository, noteRepository, type RemoteHandle, repositoryOrDefault, requestCatalog, requestToken, requestWorkspace, storedDocumentDrafts, workspaceOf } from './request-workspace.js';
import { createStudyRouter } from './study.js';
import { createOutlineImportRouter } from './outline-import.js';
import { createWorkspaceDocumentRouter } from './workspace-document.js';
import { createFolderManagerRouter } from './folder-manager.js';
import { createNoteHistoryRouter, newVersion, serverlessHistoryEvents } from './note-history.js';
import { type AssetStorage, envAssetStorage } from './asset-storage.js';
import { createR2AssetHandler } from './r2-assets.js';
import { createR2ManagerRouter } from './r2-manager.js';
import { createFileManagerRouter } from './file-manager.js';
import { createGistRouter, gistSite, gistToken, noteGist, syncGists } from './gists.js';
import { isLoopbackHttpOrigin, type PiAgent } from './pi-agent.js';
import { type PublishingService, publishNotes } from './publishing.js';
import { createWorkspaceMembersRouter } from './workspace-members.js';

export function applicationRoot() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return dir;
}

/** Why a repository the provider did read can still be unavailable: its branch is missing or its manifest does not load. */
const READABLE_UNAVAILABLE: readonly UnavailableReason[] = ['missing-branch', 'invalid-manifest'];

/** What an edition supplies to the server; the community edition uses the defaults. */
export interface AppServices {
  /** Decides, per request, which workspace a request serves; defaults to the deployment's environment and server configuration. */
  configSource: WorkspaceConfigSource;
  /** Encrypted sessions, credentials and agent grants; defaults to Redis when configured, else a local directory, and none in the lightweight mode. */
  recordStore: RecordStore;
  /** Where browser sign-ins live: the record store, or sealed cookies in the lightweight mode. */
  sessions: BrowserSessions;
  /**
   * Where visitors' repository choices are kept, where the deployment lets them choose. The community deployment uses a
   * sealed cookie; an edition that supplies its own `configSource` and no choices keeps each person's repositories in
   * its `MembershipStore` instead, so `/api/workspace/choice` is not offered and people add repositories in Settings.
   */
  workspaceChoices?: WorkspaceChoices;
  /** The remote read cache; defaults to Redis when configured, else process memory. Local workspaces use none. */
  remoteCache?: RemoteCache;
  piAgent?: PiAgent;
  /** Publishes committed notes beyond the repository, after the commit succeeded and beside the Gist push; without it nothing changes. */
  publishing?: PublishingService;
  /** Which R2 bucket and key space each request reaches, and any quota it meters; defaults to the deployment's environment (see asset-storage.ts). */
  assetStorage: AssetStorage;
  /** The built web app to serve; defaults to apps/web/dist under the application root. */
  webDist: string;
  /**
   * Adds an edition's routes after sign-in and before the workspace routes, so they run even when the
   * requester has no workspace yet; a route that needs one mounts `requestWorkspace` itself.
   */
  routes?: (app: express.Express, services: AppServices) => void;
}

export function createApp(base: string, overrides: Partial<AppServices> = {}): express.Express {
  const workspaceChoices = overrides.workspaceChoices ?? (overrides.configSource ? undefined : cookieWorkspaceChoices());
  const configSource = overrides.configSource ?? chosenRepositorySource(base, process.env, workspaceChoices);
  const local = configSource.mode === 'local';
  // The lightweight mode keeps sign-ins in cookies and nothing on the server; local workspaces never use it.
  const lightweight = !local && storageMode() === 'cookie';
  const recordStore = overrides.recordStore ?? (lightweight ? new NoRecordStore() : createRecordStore(base));
  const services: AppServices = { ...overrides, configSource, recordStore, workspaceChoices, sessions: overrides.sessions ?? (lightweight ? cookieSessions() : storedSessions(recordStore)), assetStorage: overrides.assetStorage ?? envAssetStorage(), remoteCache: 'remoteCache' in overrides ? overrides.remoteCache : local ? undefined : createRemoteCache(), webDist: overrides.webDist ?? path.join(base, 'apps/web/dist') };
  const { remoteCache: cache, piAgent, sessions, assetStorage, publishing } = services;
  // Core updates of a remote deployment act on its product repository; without one they are not offered. Visitors who
  // choose their own repository never update the deployment's Core, as before product repositories.
  const product = local ? null : productRepository(base);
  // Visitors open the one repository they chose only where choices are kept; an edition without them keeps each
  // person's repositories through its membership store.
  const visitorChoice = choosesRepository() && Boolean(workspaceChoices);
  if (product && choosesRepository()) throw new Error("A product repository (MYGITNOTES_PRODUCT_REPOSITORY or product_repository) offers Core updates, which a deployment where each visitor chooses a repository does not give its visitors. Remove it, or name the deployment's repository with MYGITNOTES_REPOSITORY.");
  const app = express();
  app.disable('x-powered-by');
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
  // The MCP route reads its own body once the caller is known: an asset upload carries its file inside the
  // JSON-RPC body, and how large that may be depends on the bucket the asset storage gives the caller.
  const smallBody = express.json({ limit: '8mb' });
  app.use((req, res, next) => req.path === '/mcp' || req.path.startsWith('/mcp/') ? next() : smallBody(req, res, next));
  // A parse error message can quote part of the body, such as an API key, so it is answered with fixed text and never logged.
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => (error as { type?: string; } | null)?.type === 'entity.parse.failed' ? res.status(400).json({ error: 'Request body is not valid JSON.', code: 'bad-json' }) : next(error));
  app.use('/api/auth', createAuth({ store: recordStore, sessions, configSource, choices: workspaceChoices }));
  app.use('/api', workspaceChoiceRouter({ store: recordStore, sessions, choices: workspaceChoices }));
  services.routes?.(app, services);
  app.use('/mcp', createRemoteMCP(recordStore, configSource, assetStorage, cache));
  app.get('/api/history/events', serverlessHistoryEvents);
  // Core updates act on the product repository, not on the workspace, so they open no repository of it.
  if (!local) app.use('/api/core', product ? createRemoteCoreUpdateRouter({ store: recordStore, sessions }, product) : (_req, res) => res.status(404).json({ error: 'This deployment names no product repository, so it offers no Core update.' }));
  if (piAgent?.tools) app.use('/api/pi', piAgent.tools);
  // The member list opens no repository, so it works while every repository is hidden or unreachable.
  app.use('/api/workspace/members', createWorkspaceMembersRouter(configSource, assetStorage, { store: recordStore, sessions }, { repositoryChoice: visitorChoice, onChange: async (settings, request) => piAgent?.membershipChanged?.(visibleMembers(settings).map(member => member.ref.id), request) }));
  app.use(['/api', '/raw-assets', '/r2-assets'], requestWorkspace({ store: recordStore, sessions }, configSource, cache));
  app.use(createFileManagerRouter());
  app.use(createR2ManagerRouter(assetStorage));
  app.use('/api/study', createStudyRouter());
  app.use('/api/focus-page', createWorkspaceDocumentRouter(FOCUS_DOCUMENT));
  app.use('/api/outline-import', createOutlineImportRouter());
  app.use('/api/bookmarks/resolve', (_req, res) => res.status(410).json({ code: 'legacy-authoring-retired', error: 'Legacy bookmark resolution is retired. Use the saved-source outline import preview.' }));
  app.use('/api/bookmarks', createWorkspaceDocumentRouter(BOOKMARKS_DOCUMENT));
  app.use('/api/folder-manager', createFolderManagerRouter());
  app.use(createNoteHistoryRouter());
  // Ahead of the local routes: starting or ending the agent does not edit the workspace, so it needs no `main` branch.
  // A remote deployment mounts it too, for an edition that supplies a hosted agent; the community one supplies none.
  if (piAgent) app.use('/api/pi', piAgent.router);
  if (local) {
    app.get(
      '/r2-assets/*',
      createR2AssetHandler(assetStorage, async (res, notePath) => {
        const { handle, config } = await noteRepository(res, notePath);
        if (!['note', 'outline'].includes(classifyResource(notePath, config).type)) throw new Error('Path is not a configured note.');
        return { content: fs.readFileSync(resolveSafePath(asLocal(handle).root, notePath), 'utf8'), repository: handle };
      }),
    );
    app.use(createLocalApp(base));
  } else {
    /** Whether the request carries a signed-in session; each repository still checks its own access. */
    const signedIn = (res: express.Response) => Boolean(requestToken(res));
    /** The remote repository of a notebook key, with that notebook's local id and the alias that keys its answers. */
    const remoteNotebook = async (res: express.Response, notebookId: unknown) => {
      const { handle, alias, notebook } = await notebookRepository(res, notebookId);
      return { ...asRemote(handle), alias, localId: notebook.id };
    };
    /** Without a notebook a listing covers the default repository's first notebook. */
    const defaultNotebook = async (res: express.Response) => {
      const { handle, alias, config } = await defaultRepository(res);
      return { ...asRemote(handle), alias, localId: config.notebooks[0]?.id };
    };
    const remoteNote = async (res: express.Response, file: unknown, notebookId?: unknown) => {
      const { handle, alias } = await noteRepository(res, file, notebookId);
      return { ...asRemote(handle), alias };
    };
    const remoteRepositories = async (res: express.Response) => (await eachRepository(res)).map(({ handle, alias }) => ({ ...asRemote(handle), alias }));
    app.use(createGistRouter());
    /** Pushes committed notes that name a Gist to it; notes that name none cost nothing. */
    const publishedGists = async (res: express.Response, notes: { path: string; content: string; metadata: Record<string, unknown>; }[]) => {
      const token = gistToken(res);
      return token && notes.some(note => noteGist(note.metadata)) ? { gists: await syncGists(token, notes, gistSite(res)) } : {};
    };
    app.get('/api/workspace', async (_req, res) => {
      try {
        const workspace = workspaceOf(res);
        // `?fresh=1` opened every repository at its current branch head, and each manifest is read from that snapshot.
        const [keyedConfig, listed] = await Promise.all([workspace.keyedConfig(), workspace.all()]);
        // A signed-out visitor is told only of repositories the provider let them read: one it refused, a private one among
        // them, or one it was never asked for is not named.
        const entries = signedIn(res) ? listed : listed.filter(entry => !('unavailable' in entry) || READABLE_UNAVAILABLE.includes(entry.unavailable.reason));
        const repositories = await Promise.all(entries.map(async (entry): Promise<RepositoryStatus> => {
          const base = { id: entry.ref.id, type: entry.ref.source.type, repository: entry.ref.source.type === 'local' ? undefined : entry.ref.source.repository, alias: entry.alias, notebooks: entry.notebooks.map(notebook => notebook.key) };
          const manifest = repositoryManifestStatus(await workspace.manifestOf(entry.ref.id));
          // A repository whose manifest does not load is still read, so Settings can fix that manifest.
          const handle = ('handle' in entry ? entry.handle : await workspace.handleOf(entry.ref.id)) as RemoteHandle | undefined;
          if (!handle) return { ...base, ...manifest, branch: entry.ref.source.type === 'local' ? '' : entry.ref.source.branch, revision: '', write: false, ...('unavailable' in entry ? { unavailable: entry.unavailable } : {}) };
          const snapshot = await handle.reader.getSnapshot();
          return { ...base, ...manifest, branch: handle.reader.branch, revision: snapshot.sha, write: handle.authenticated && handle.reader.canWrite(snapshot), ...('unavailable' in entry ? { unavailable: entry.unavailable } : {}) };
        }));
        const body: WorkspaceStatus = { keyedConfig, local: false, defaultRepository: workspace.default?.ref.id ?? null, repositories, coreUpdate: Boolean(product), ...(visitorChoice ? { repositoryChoice: true } : {}) };
        res.json(body);
      } catch (error) {
        fail(res, error);
      }
    });
    app.put('/api/workspace/config', async (req, res) => {
      try {
        if (!signedIn(res)) throw new SourceError('Sign in with write permission to edit the workspace manifest.', 403);
        const { repository, configYaml, configRevision } = req.body;
        if (typeof repository !== 'string' || !repository) throw new SourceError('repository is required.');
        if (typeof configYaml !== 'string') throw new SourceError('configYaml is required.');
        const saved = await workspaceOf(res).saveManifest(repository, configYaml, String(configRevision || ''));
        res.json({ success: true, configRevision: saved.revision });
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/notes', async (req, res) => {
      try {
        const { notebookId } = req.query;
        const readers = notebookId ? [await remoteNotebook(res, notebookId)] : (await remoteRepositories(res)).map(repository => ({ ...repository, localId: undefined }));
        res.json({ notes: (await Promise.all(readers.map(async ({ reader, alias, localId }) => (await reader.notes(localId)).map(keyedItem(alias))))).flat() });
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
        res.json({ folders: (await Promise.all((await remoteRepositories(res)).map(async ({ reader, alias }) => (await reader.folders()).map(keyedItem(alias))))).flat() });
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/templates/render', async (req, res) => {
      try {
        const { notebookId, templateId, title } = req.query;
        const { reader, localId } = await remoteNotebook(res, notebookId);
        res.json(await reader.renderTemplate(localId, String(templateId || ''), String(title || '')));
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/notes/read', async (req, res) => {
      try {
        const { reader, alias } = await remoteNote(res, req.query.path, req.query.notebookId);
        res.json({ note: keyedItem(alias)(await reader.note(String(req.query.path))) });
      } catch (error) {
        fail(res, error);
      }
    });
    app.post('/api/notes/read-batch', async (req, res) => {
      try {
        const { handle, alias } = await namedRepository(res, req.body?.repository);
        res.json({ notes: (await asRemote(handle).reader.readNotes(req.body.paths, req.body.revision)).map(keyedItem(alias)) });
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/assets', async (req, res) => {
      try {
        const { reader, localId } = req.query.notebookId ? await remoteNotebook(res, req.query.notebookId) : await defaultNotebook(res);
        res.json({ assets: await reader.assets(localId) });
      } catch (error) {
        fail(res, error);
      }
    });
    for (const [method, operation] of [['post', 'upload'], ['patch', 'move'], ['delete', 'delete']] as const) {
      app[method]('/api/assets', async (req, res) => {
        try {
          if (!signedIn(res)) throw new SourceError('Sign in with write permission to manage assets.', 403);
          const args = { ...req.query, ...req.body };
          if (operation === 'upload') {
            const target = await remoteNotebook(res, args.notebookId);
            return res.json(await target.reader.mutateAsset(operation, { ...args, notebookId: target.localId }));
          }
          res.json(await (await remoteNote(res, args.path)).reader.mutateAsset(operation, args));
        } catch (error) {
          fail(res, error);
        }
      });
    }
    app.get(
      '/r2-assets/*',
      createR2AssetHandler(assetStorage, async (res, notePath) => {
        const repository = await remoteNote(res, notePath);
        return { content: (await repository.reader.note(notePath)).content, repository };
      }),
    );
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
        const { repository, notes, revision, message, documents, version } = req.body;
        const { handle, alias } = await namedRepository(res, repository);
        const target = asRemote(handle);
        if (!target.authenticated) throw new SourceError('Sign in with write permission to commit notes.', 403);
        const receipt = await target.reader.commitNotes(notes, revision, message, storedDocumentDrafts(alias, documents), newVersion(version));
        // A deleted note publishes nothing.
        res.json({ ...receipt, ...await publishedGists(res, notes.filter((note: { delete?: boolean; }) => note?.delete !== true)), ...await publishNotes(publishing, { req, res, repository: target, notes }) });
      } catch (error) {
        fail(res, error);
      }
    });
    app.post('/api/notes', async (req, res) => {
      try {
        if (!signedIn(res)) throw new SourceError('Sign in with write permission to edit notes.', 403);
        const { path: file, content, metadata, revision, createOnly, notebookId } = req.body;
        if (typeof file !== 'string' || typeof content !== 'string') throw new SourceError('path and content are required.');
        const target = await remoteNote(res, file, notebookId);
        const saved = await target.reader.save(file, content, metadata, revision, createOnly);
        res.json({ ...saved, note: keyedItem(target.alias)(saved.note), ...await publishedGists(res, [saved.note]), ...await publishNotes(publishing, { req, res, repository: target, notes: [saved.note] }) });
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
          const patched = replaceFileTags(raw, String(entry.path), entry.tags as string[]);
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
    // Agent routes act on the repository a request names, the default repository otherwise.
    app.get('/api/git/status', async (req, res) => {
      try {
        const { handle } = await repositoryOrDefault(res, req.query.repository);
        res.json({ status: { branch: asRemote(handle).reader.branch, isClean: true, staged: [], modified: [], untracked: [] }, commits: [] });
      } catch (error) {
        fail(res, error);
      }
    });
    // Every workspace file of one snapshot, so a listing never mixes two commits.
    const snapshotFiles = (entries: { path: string; type: string; mode: string; }[], notebooks: NotebookConfig[]) => entries.flatMap(entry => entry.type === 'blob' && entry.mode !== '120000' ? [agentWorkspaceFile(entry.path, notebooks)].filter(file => file !== undefined) : []).sort((a, b) => a.path.localeCompare(b.path, 'en'));
    app.get('/api/agent-resources/workspaces', async (_req, res) => {
      try {
        const repositories = await eachRepository(res);
        const listed = await Promise.all(repositories.map(async ({ id, handle, config }) => agentWorkspaces(snapshotFiles((await asRemote(handle).reader.getSnapshot()).entries, config.notebooks)).map(workspace => ({ repository: id, ...workspace }))));
        res.json({ workspaces: listed.flat() });
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/agent-resources', async (req, res) => {
      try {
        const { handle, config } = await repositoryOrDefault(res, req.query.repository);
        const { reader, authenticated } = asRemote(handle);
        const snapshot = await reader.getSnapshot();
        const editable = Boolean(authenticated && snapshot.info.permissions?.push && reader.branch === 'main');
        const files = snapshotFiles(snapshot.entries, config.notebooks);
        res.json({ workspaces: agentWorkspaces(files), files: files.map(file => ({ ...file, editable })), revision: snapshot.sha });
      } catch (error) {
        fail(res, error);
      }
    });
    app.get('/api/agent-resources/read', async (req, res) => {
      try {
        const targetPath = req.query.path as string;
        if (!targetPath) throw new SourceError('path query required', 400);
        const { handle, config } = await repositoryOrDefault(res, req.query.repository);
        if (!agentWorkspaceFile(targetPath, config.notebooks)) throw new SourceError('Path is not an agent workspace file.', 403);
        const { reader } = asRemote(handle);
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
        const result = await asRemote((await repositoryOrDefault(res, repository)).handle).reader.saveAgentResource(file, content, revision, create);
        res.json({ ...result, path: file });
      } catch (error) {
        fail(res, error);
      }
    });
    app.post('/api/agent-resources/rename-skill', async (req, res) => {
      try {
        if (!signedIn(res)) throw new SourceError('Sign in with write permission to edit Agent documents.', 403);
        const { path: file, slug, content, revision, repository } = req.body;
        const result = await asRemote((await repositoryOrDefault(res, repository)).handle).reader.renameAgentSkill(file, slug, content, revision);
        res.json(result);
      } catch (error) {
        fail(res, error);
      }
    });
    app.use('/api', (req, res) => res.status(403).json({ error: 'This operation is available only in a local workspace.' }));
  }
  const web = services.webDist;
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
