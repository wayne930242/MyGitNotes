import fs from 'node:fs';
import path from 'node:path';
import type express from 'express';
import { type AvailableRepository, createRemoteSource, createWorkspaceRepositories, localManifest, type NotebookConfig, type NoteCatalog, parseRevisions, prewarmNotebookScans, type RemoteCache, RemoteManifest, type RemoteSource, type RepositoryCatalog, type RepositoryId, type RepositoryRef, RepositoryUnavailableError, sharesCredential, SourceError, workspaceCatalog, type WorkspaceConfig, type WorkspaceConfigSource, workspaceDocument, type WorkspaceRepositories, type WorkspaceSettings, WorkspaceSetupError } from '@mygitnotes/core';
import { stageAndCommit } from '@mygitnotes/git';
import { authToken, type SessionServices } from './auth.js';
import { regularPath } from './workspace-files.js';

export interface LocalHandle {
  kind: 'local';
  id: RepositoryId;
  root: string;
}
export interface RemoteHandle {
  kind: 'remote';
  id: RepositoryId;
  reader: RemoteSource;
  /** Whether the request carries a signed-in credential for this repository. */
  authenticated: boolean;
}
export type RepositoryHandle = LocalHandle | RemoteHandle;
export type RequestWorkspace = WorkspaceRepositories<RepositoryHandle>;

/** Opens the workspace of one request: the home repository from its settings, the manifest where the settings keep it, and each notebook repository the manifest declares. */
export function openWorkspace(settings: WorkspaceSettings, token: string | undefined, cache?: RemoteCache): RequestWorkspace {
  const { home } = settings;
  if (home.source.type === 'local') {
    const root = home.source.path;
    const mapped = (ref: RepositoryRef) => settings.localPath(ref);
    return createWorkspaceRepositories<RepositoryHandle>({
      home,
      openHome: () => ({ kind: 'local', id: home.id, root }),
      manifest: () => settings.manifest(() => localManifest(root, stageAndCommit)),
      isHome: ref => sameDirectory(mapped(ref), root),
      async openRepository(ref) {
        const worktree = mapped(ref);
        if (!worktree) return { reason: 'unmapped', message: `No worktree is mapped for ${ref.id}. Add it under repositories in mygitnotes.server.yaml.` };
        if (!fs.existsSync(path.join(worktree, '.git'))) return { reason: 'unmapped', message: `${worktree} is not a Git worktree.` };
        return { kind: 'local', id: ref.id, root: worktree };
      },
    });
  }
  const source = home.source;
  return createWorkspaceRepositories<RepositoryHandle>({
    home,
    openHome: scope => ({ kind: 'remote', id: home.id, reader: createRemoteSource(source, token, fetch, cache, scope), authenticated: Boolean(token) }),
    manifest: handle => settings.manifest(() => new RemoteManifest((handle as RemoteHandle).reader)),
    async openRepository(ref, scope) {
      if (ref.source.type === 'local' || !sharesCredential(source, ref.source)) return { reason: 'unsupported-platform', message: `${ref.id} is not on the home repository's platform and site.` };
      const reader = createRemoteSource(ref.source, token, fetch, cache, scope);
      try {
        await reader.getSnapshot();
      } catch (error) {
        if (error instanceof RepositoryUnavailableError) return { reason: error.reason, message: error.message };
        throw error;
      }
      return { kind: 'remote', id: ref.id, reader, authenticated: Boolean(token) };
    },
  });
}

/** Whether a mapped worktree is the directory `root`, following symbolic links. */
function sameDirectory(candidate: string | undefined, root: string): boolean {
  if (!candidate) return false;
  try {
    return fs.realpathSync(candidate) === fs.realpathSync(root);
  } catch {
    return false;
  }
}

/** Resolves the request's workspace once and stores it in `res.locals.workspace`. */
export function requestWorkspace(auth: SessionServices, configSource: WorkspaceConfigSource, cache?: RemoteCache): express.RequestHandler {
  return async (req, res, next) => {
    let settings: WorkspaceSettings;
    try {
      settings = await configSource.settings(req);
    } catch (error) {
      if (error instanceof WorkspaceSetupError) return res.status(503).json({ error: error.message, setupRequired: true, ...(error.reason ? { reason: error.reason } : {}) });
      return next(error);
    }
    let token: string | undefined;
    if (settings.home.source.type !== 'local') {
      try {
        token = await authToken(req, res, auth, settings.home.source);
      } catch {
        return res.status(401).json({ error: 'Session unavailable. Sign in again.' });
      }
    }
    res.locals.workspace = openWorkspace(settings, token, cache);
    res.locals.token = token;
    next();
  };
}

/** The signed-in platform token of the request, for calls outside its repositories such as Gists. */
export function requestToken(res: express.Response): string | undefined {
  return res.locals.token as string | undefined;
}

export function workspaceOf(res: express.Response): RequestWorkspace {
  const workspace = res.locals.workspace as RequestWorkspace | undefined;
  if (!workspace) throw new SourceError('Workspace unavailable.', 503);
  return workspace;
}

/** The home repository's handle with the manifest scope it serves. */
export async function homeRepository(res: express.Response): Promise<{ handle: RepositoryHandle; config: WorkspaceConfig; }> {
  const workspace = workspaceOf(res);
  return { handle: workspace.home.handle, config: await workspace.scope(workspace.home.ref.id) };
}

/**
 * Parses every local worktree's notebooks in the background once the server listens, so the first page load does not
 * wait for a cold scan; requests arriving meanwhile are served between batches of files. A remote workspace has nothing to warm.
 */
export async function prewarmLocalScans(configSource: WorkspaceConfigSource): Promise<void> {
  const settings = await configSource.settings({ headers: {} });
  if (settings.home.source.type !== 'local') return;
  const repositories = await openWorkspace(settings, undefined).all();
  for (const repository of repositories) {
    if ('handle' in repository && repository.handle.kind === 'local') await prewarmNotebookScans(repository.handle.root, repository.notebooks);
  }
}

/** The note catalog over every available repository of the request's workspace, checked against the `revisions` the caller works from. */
export async function requestCatalog(res: express.Response, revisions: unknown, open: (handle: RepositoryHandle, notebooks: NotebookConfig[]) => RepositoryCatalog): Promise<NoteCatalog> {
  const expected = parseRevisions(revisions);
  const workspace = workspaceOf(res);
  const [{ config }, repositories] = await Promise.all([workspace.manifest(), workspace.all()]);
  const available = repositories.filter((repository): repository is AvailableRepository<RepositoryHandle> => 'handle' in repository);
  return workspaceCatalog(config, available.map(repository => ({ id: repository.ref.id, notebooks: repository.notebooks, catalog: open(repository.handle, repository.notebooks) })), expected);
}

/** The repository a workspace-level request names, or the home repository when it names none; with the manifest scope that repository serves. */
export async function repositoryOrHome(res: express.Response, id: unknown): Promise<{ id: RepositoryId; handle: RepositoryHandle; config: WorkspaceConfig; }> {
  const workspace = workspaceOf(res);
  if (id !== undefined && typeof id !== 'string') throw new SourceError('repository must be a string.');
  const { ref, handle } = id ? await workspace.byId(id) : { ref: workspace.home.ref, handle: workspace.home.handle };
  return { id: ref.id, handle, config: await workspace.scope(ref.id) };
}

/** The repository a request names in its `repository` field. */
export async function namedRepository(res: express.Response, id: unknown): Promise<AvailableRepository<RepositoryHandle>> {
  if (typeof id !== 'string' || !id) throw new SourceError('repository is required.');
  return workspaceOf(res).byId(id);
}

/** The remote repository a request names, with its handle. */
export async function namedRemote(res: express.Response, id: unknown): Promise<RemoteHandle> {
  const { handle } = await namedRepository(res, id);
  if (handle.kind !== 'remote') throw new SourceError('This operation requires a remote source.', 400);
  return handle;
}

/** The local worktree a request names, with the manifest scope it serves. */
export async function namedLocal(res: express.Response, id: unknown): Promise<{ root: string; config: WorkspaceConfig; }> {
  const { ref, handle } = await namedRepository(res, id);
  if (handle.kind !== 'local') throw new SourceError('This operation requires a local workspace.', 400);
  return { root: handle.root, config: await workspaceOf(res).scope(ref.id) };
}

/** A repository with the manifest scope it serves and, when one was named or found, the notebook. */
export interface ResolvedRepository {
  handle: RepositoryHandle;
  config: WorkspaceConfig;
  notebook: NotebookConfig;
}

/** The repository of the notebook a request names. */
export async function notebookRepository(res: express.Response, notebookId: unknown): Promise<ResolvedRepository> {
  if (typeof notebookId !== 'string' || !notebookId) throw new SourceError('notebookId is required.');
  const workspace = workspaceOf(res);
  const entry = await workspace.forNotebook(notebookId);
  return { handle: entry.handle, config: await workspace.scope(entry.ref.id), notebook: entry.notebooks.find(notebook => notebook.id === notebookId)! };
}

/**
 * The repository of a note or asset path: through the notebook the request names, which must
 * contain the path, or else through the notebook whose root contains it.
 */
export async function noteRepository(res: express.Response, file: unknown, notebookId?: unknown): Promise<ResolvedRepository> {
  if (typeof file !== 'string' || !file) throw new SourceError('path is required.');
  if (workspaceDocument(file)) throw new SourceError('Workspace metadata is protected.', 403);
  let resolved: ResolvedRepository;
  if (notebookId !== undefined && notebookId !== '') {
    resolved = await notebookRepository(res, notebookId);
    if (!file.startsWith(`${resolved.notebook.root}/`)) throw new SourceError('Path is not in the named notebook.', 403);
  } else {
    const workspace = workspaceOf(res);
    const entry = await workspace.forPath(file);
    resolved = { handle: entry.handle, config: await workspace.scope(entry.ref.id), notebook: entry.notebook };
  }
  // Match managed-file policy: a lexical notebook path cannot alias metadata or another owner.
  if (resolved.handle.kind === 'local') regularPath(resolved.handle.root, file.replace(/\\/g, '/'));
  return resolved;
}

/** Every available repository of the request's workspace with the manifest scope it serves. */
export async function eachRepository(res: express.Response): Promise<{ handle: RepositoryHandle; config: WorkspaceConfig; }[]> {
  const workspace = workspaceOf(res);
  const entries = (await workspace.all()).filter((entry): entry is AvailableRepository<RepositoryHandle> => 'handle' in entry);
  return Promise.all(entries.map(async entry => ({ handle: entry.handle, config: await workspace.scope(entry.ref.id) })));
}

/** A local handle, for routes that exist only in a local workspace. */
export function asLocal(handle: RepositoryHandle): LocalHandle {
  if (handle.kind !== 'local') throw new SourceError('This operation requires a local workspace.', 400);
  return handle;
}

/** A remote handle, for routes that exist only for remote sources. */
export function asRemote(handle: RepositoryHandle): RemoteHandle {
  if (handle.kind !== 'remote') throw new SourceError('This operation requires a remote source.', 400);
  return handle;
}

/** The local home worktree with the manifest scope it serves. */
export async function localRepository(res: express.Response): Promise<{ root: string; config: WorkspaceConfig; }> {
  const { root } = localHome(res);
  const workspace = workspaceOf(res);
  return { root, config: await workspace.scope(workspace.home.ref.id) };
}

/** The home repository when the deployment is remote; routes that exist only for remote sources use this. */
export function remoteHome(res: express.Response): RemoteHandle {
  const { handle } = workspaceOf(res).home;
  if (handle.kind !== 'remote') throw new SourceError('This operation requires a remote source.', 400);
  return handle;
}

/** The home repository when the deployment is local. */
export function localHome(res: express.Response): LocalHandle {
  const { handle } = workspaceOf(res).home;
  if (handle.kind !== 'local') throw new SourceError('This operation requires a local workspace.', 400);
  return handle;
}
