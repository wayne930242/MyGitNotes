import fs from 'node:fs';
import path from 'node:path';
import type express from 'express';
import { type AvailableRepository, createRemoteSource, createWorkspaceRepositories, type KeyedNotebook, localIdIn, localManifest, type NotebookConfig, type NotebookKey, notebookKey, type NoteCatalog, parseRevisions, prewarmNotebookScans, type RemoteCache, RemoteManifest, type RemoteSource, type RepositoryCatalog, type RepositoryId, type RepositoryRef, RepositoryUnavailableError, sharesCredential, SourceError, workspaceCatalog, type WorkspaceConfig, type WorkspaceConfigSource, type WorkspaceDocument, workspaceDocument, type WorkspaceRepositories, type WorkspaceSettings, WorkspaceSetupError } from '@mygitnotes/core';
import { stageAndCommit } from '@mygitnotes/git';
import { authToken, CredentialRejected, type SessionServices } from './auth.js';
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

/** A notebook as its repository's manifest declares it, without its workspace key. */
const localNotebook = ({ key: _key, ...notebook }: KeyedNotebook): NotebookConfig => notebook;

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
      } catch (error) {
        if (error instanceof CredentialRejected) return res.status(401).json({ error: 'Session unavailable. Sign in again.' });
        // The session store or provider did not answer; the reader's session still stands.
        console.warn(`[auth] session service unavailable: ${(error as Error).message}`);
        return res.status(503).json({ error: 'Session service temporarily unavailable. Retry shortly.' });
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
export async function homeRepository(res: express.Response): Promise<{ handle: RepositoryHandle; alias: string; config: WorkspaceConfig; }> {
  const workspace = workspaceOf(res);
  return { handle: workspace.home.handle, alias: workspace.home.alias, config: await workspace.scope(workspace.home.ref.id) };
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
    if ('handle' in repository && repository.handle.kind === 'local') await prewarmNotebookScans(repository.handle.root, repository.notebooks.map(localNotebook));
  }
}

/** The note catalog over every available repository of the request's workspace, checked against the `revisions` the caller works from. */
export async function requestCatalog(res: express.Response, revisions: unknown, open: (handle: RepositoryHandle, notebooks: NotebookConfig[]) => RepositoryCatalog): Promise<NoteCatalog> {
  const expected = parseRevisions(revisions);
  const workspace = workspaceOf(res);
  const [{ config }, repositories] = await Promise.all([workspace.manifest(), workspace.all()]);
  const available = repositories.filter((repository): repository is AvailableRepository<RepositoryHandle> => 'handle' in repository);
  return workspaceCatalog(config, available.map(repository => {
    const notebooks = repository.notebooks.map(localNotebook);
    return { id: repository.ref.id, alias: repository.alias, notebooks, catalog: open(repository.handle, notebooks) };
  }), expected);
}

/** The repository a workspace-level request names, or the home repository when it names none; with the manifest scope that repository serves. */
export async function repositoryOrHome(res: express.Response, id: unknown): Promise<{ id: RepositoryId; alias: string; handle: RepositoryHandle; config: WorkspaceConfig; }> {
  const workspace = workspaceOf(res);
  if (id !== undefined && typeof id !== 'string') throw new SourceError('repository must be a string.');
  const { ref, alias, handle } = id ? await workspace.byId(id) : workspace.home;
  return { id: ref.id, alias, handle, config: await workspace.scope(ref.id) };
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

/**
 * A repository with the manifest scope it serves (local ids) and the notebook a request named or a path fell in.
 * `notebook.id` is the local id that repository content stores; `key` is how responses name it.
 */
export interface ResolvedRepository {
  handle: RepositoryHandle;
  alias: string;
  config: WorkspaceConfig;
  notebook: NotebookConfig;
  key: NotebookKey;
}

const resolved = async (workspace: RequestWorkspace, entry: AvailableRepository<RepositoryHandle> & { notebook: KeyedNotebook; }): Promise<ResolvedRepository> => ({ handle: entry.handle, alias: entry.alias, config: await workspace.scope(entry.ref.id), notebook: localNotebook(entry.notebook), key: entry.notebook.key });

/** The repository of the notebook a request names by its key. */
export async function notebookRepository(res: express.Response, notebookId: unknown): Promise<ResolvedRepository> {
  if (typeof notebookId !== 'string' || !notebookId) throw new SourceError('notebookId is required.');
  const workspace = workspaceOf(res);
  return resolved(workspace, await workspace.forNotebook(notebookId));
}

/** The local id a request's notebook key names inside one repository; a key of another repository is refused. */
export function localNotebookId(alias: string, notebookId: string): string {
  const local = localIdIn(alias, notebookId);
  if (local === null) throw new SourceError(`Notebook ${notebookId} does not belong to this repository.`, 400);
  return local;
}

/** A workspace document as a request names it (notebook keys) turned into what the repository stores (local ids), or back. */
export const storedDocument = <T>(document: WorkspaceDocument<T>, alias: string, value: T): T => document.mapNotebookIds(value, id => localNotebookId(alias, id));
export const keyedDocument = <T>(document: WorkspaceDocument<T>, alias: string, value: T): T => document.mapNotebookIds(value, id => notebookKey(alias, id));

/** A workspace document draft a commit request carries. */
export interface DocumentDraft {
  path: string;
  page: unknown;
  base: unknown;
}

/**
 * The workspace document drafts of a commit request with their notebook keys turned into the repository's local ids.
 * A request without drafts has none; a draft that names no document or fails its schema passes unchanged, for the commit to refuse.
 */
export function storedDocumentDrafts(alias: string, documents: unknown): DocumentDraft[] {
  if (documents === undefined) return [];
  if (!Array.isArray(documents)) throw new SourceError('Select between 1 and 200 files.');
  return documents.map((draft: DocumentDraft) => {
    const document = typeof draft?.path === 'string' ? workspaceDocument(draft.path) : undefined;
    if (!document) return draft;
    const page = document.schema.safeParse(draft.page), base = document.schema.safeParse(draft.base);
    if (!page.success || !base.success) return draft;
    return { ...draft, page: storedDocument(document, alias, page.data), base: storedDocument(document, alias, base.data) };
  });
}

/**
 * The repository of a note or asset path: through the notebook the request names, which must
 * contain the path, or else through the notebook whose root contains it.
 */
export async function noteRepository(res: express.Response, file: unknown, notebookId?: unknown): Promise<ResolvedRepository> {
  if (typeof file !== 'string' || !file) throw new SourceError('path is required.');
  if (workspaceDocument(file)) throw new SourceError('Workspace metadata is protected.', 403);
  let found: ResolvedRepository;
  if (notebookId !== undefined && notebookId !== '') {
    found = await notebookRepository(res, notebookId);
    if (!file.startsWith(`${found.notebook.root}/`)) throw new SourceError('Path is not in the named notebook.', 403);
  } else {
    const workspace = workspaceOf(res);
    found = await resolved(workspace, await workspace.forPath(file));
  }
  // Match managed-file policy: a lexical notebook path cannot alias metadata or another owner.
  if (found.handle.kind === 'local') regularPath(found.handle.root, file.replace(/\\/g, '/'));
  return found;
}

/** Every available repository of the request's workspace with its alias and the manifest scope it serves. */
export async function eachRepository(res: express.Response): Promise<{ id: RepositoryId; alias: string; handle: RepositoryHandle; config: WorkspaceConfig; }[]> {
  const workspace = workspaceOf(res);
  const entries = (await workspace.all()).filter((entry): entry is AvailableRepository<RepositoryHandle> => 'handle' in entry);
  return Promise.all(entries.map(async entry => ({ id: entry.ref.id, alias: entry.alias, handle: entry.handle, config: await workspace.scope(entry.ref.id) })));
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
