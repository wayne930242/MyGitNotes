import type express from 'express';
import { createRemoteSource, createWorkspaceRepositories, localManifest, RemoteManifest, type RemoteCache, type RemoteSource, type RepositoryId, SourceError, type WorkspaceConfig, type WorkspaceConfigSource, type WorkspaceRepositories, type WorkspaceSettings, WorkspaceSetupError } from '@mygitnotes/core';
import { stageAndCommit } from '@mygitnotes/git';
import { authToken } from './auth.js';

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

/** Opens the workspace of one request: the home repository from its settings and the manifest where the settings keep it. */
export function openWorkspace(settings: WorkspaceSettings, token: string | undefined, cache?: RemoteCache): RequestWorkspace {
  const { home } = settings;
  if (home.source.type === 'local') {
    const root = home.source.path;
    return createWorkspaceRepositories<RepositoryHandle>({
      home,
      openHome: () => ({ kind: 'local', id: home.id, root }),
      manifest: () => settings.manifest(() => localManifest(root, stageAndCommit)),
    });
  }
  const source = home.source;
  return createWorkspaceRepositories<RepositoryHandle>({
    home,
    openHome: scope => ({ kind: 'remote', id: home.id, reader: createRemoteSource(source, token, fetch, cache, scope), authenticated: Boolean(token) }),
    manifest: handle => settings.manifest(() => new RemoteManifest((handle as RemoteHandle).reader)),
  });
}

/** Resolves the request's workspace once and stores it in `res.locals.workspace`. */
export function requestWorkspace(base: string, configSource: WorkspaceConfigSource, cache?: RemoteCache): express.RequestHandler {
  return async (req, res, next) => {
    let settings: WorkspaceSettings;
    try {
      settings = await configSource.settings(req);
    } catch (error) {
      if (error instanceof WorkspaceSetupError) return res.status(503).json({ error: error.message, setupRequired: true });
      return next(error);
    }
    let token: string | undefined;
    if (settings.home.source.type !== 'local') {
      try {
        token = await authToken(req, base, settings.home.source);
      } catch {
        return res.status(401).json({ error: 'Session unavailable. Sign in again.' });
      }
    }
    res.locals.workspace = openWorkspace(settings, token, cache);
    next();
  };
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
