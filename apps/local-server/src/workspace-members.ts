import { type Request, type Response, Router } from 'express';
import { MembershipError, type MembershipStore, type RepositoryId, SourceError, type WorkspaceConfigSource, type WorkspaceMember, WorkspaceSetupError } from '@mygitnotes/core';
import type { AssetStorage } from './asset-storage.js';
import { endEventStreams } from './event-stream.js';
import { choosesRepository } from './workspace-choice.js';

/** One member as Settings → Repositories lists it. */
export interface MemberStatus {
  id: RepositoryId;
  alias: string;
  type: 'github' | 'gitlab' | 'local';
  /** The platform repository; absent for a worktree that names none. */
  repository?: string;
  /** The branch of a platform repository; a worktree serves the branch it has checked out. */
  branch?: string;
  /** Local mode: the worktree. */
  path?: string;
  default: boolean;
  hidden: boolean;
  folder?: string;
  editable: WorkspaceMember['editable'];
}
/** The answer of `GET /api/workspace/members`. */
export interface MembersAnswer {
  members: MemberStatus[];
  /** Whether this deployment changes membership from Settings; a hosted community deployment is read-only. */
  changeable: boolean;
  /** The revision every change sends back; null where membership cannot be changed. */
  revision: string | null;
  /** Every repository reaches one R2 key space, so equal local ids share keys (see `AssetStorage.sharedKeys`). */
  sharedAssetKeys: boolean;
  /** The setting that names the member Settings cannot remove, where there is one. */
  environment?: string;
  /** Each visitor chooses the one repository (decision C2), so the list changes through Switch repository, not a file. */
  repositoryChoice?: true;
}

const status = (member: WorkspaceMember): MemberStatus => {
  const { source } = member.ref;
  return { id: member.ref.id, alias: member.alias, type: source.type, ...(source.type === 'local' ? {} : { repository: source.repository, branch: source.branch }), ...(member.localPath ? { path: member.localPath } : {}), default: member.default, hidden: member.hidden, ...(member.folder ? { folder: member.folder } : {}), editable: member.editable };
};

function fail(res: Response, error: unknown) {
  if (error instanceof WorkspaceSetupError) return res.status(503).json({ error: error.message, setupRequired: true });
  res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Request failed.', ...(error instanceof MembershipError ? { code: error.code } : {}) });
}

const text = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value) throw new SourceError(`${name} is required.`, 400);
  return value;
};

/**
 * Settings → Repositories: the workspace's members, read from its configuration without opening any repository, so the
 * list works while every repository is hidden or unreachable; and, where the configuration source lets this request
 * change them, adding, removing, hiding, showing, reordering and choosing the default. Mounted ahead of the routes that
 * open repositories. A change ends the open event streams, so every page reconnects to the new membership.
 */
export function createWorkspaceMembersRouter(configSource: WorkspaceConfigSource, assetStorage: AssetStorage): Router {
  const router = Router();
  const change = (action: (store: MembershipStore, req: Request) => Promise<{ revision: string; }>) => async (req: Request, res: Response) => {
    try {
      const store = configSource.membership?.(req);
      if (!store) return res.status(405).json({ error: choosesRepository() ? 'Each visitor of this deployment opens the one repository they chose; use Switch repository to open another.' : 'This deployment lists its repositories in mygitnotes.server.yaml or its environment; the administrator changes them there and redeploys.', code: 'read-only' });
      const { revision } = await action(store, req);
      endEventStreams();
      res.json({ revision });
    } catch (error) {
      fail(res, error);
    }
  };

  router.get('/', async (req, res) => {
    try {
      const settings = await configSource.settings(req);
      const store = configSource.membership?.(req);
      const environment = store?.environment?.();
      const answer: MembersAnswer = { members: settings.members.map(status), changeable: Boolean(store), revision: store ? await store.revision() : null, sharedAssetKeys: Boolean(await assetStorage.sharedKeys?.(req, res)), ...(environment ? { environment } : {}), ...(choosesRepository() ? { repositoryChoice: true as const } : {}) };
      res.json(answer);
    } catch (error) {
      fail(res, error);
    }
  });
  router.post('/', change((store, req) => store.add({ localPath: req.body?.path, ...(typeof req.body?.folder === 'string' ? { folder: req.body.folder } : {}) }, text(req.body?.revision, 'revision'))));
  router.patch(
    '/',
    change((store, req) => {
      const { repository, revision, hidden, folder } = req.body ?? {};
      const changes = ['hidden', 'default', 'folder'].filter(key => req.body?.[key] !== undefined);
      if (changes.length !== 1) throw new SourceError('Change one of hidden, default or folder.', 400);
      const id = text(repository, 'repository'), current = text(revision, 'revision');
      if (typeof hidden === 'boolean') return store.setHidden(id, hidden, current);
      if (req.body.default === true) return store.setDefault(id, current);
      if (typeof folder === 'string') return store.setFolder(id, folder, current);
      throw new SourceError('hidden must be a boolean, default true and folder a string.', 400);
    }),
  );
  router.put('/order', change((store, req) => store.reorder(req.body?.order, text(req.body?.revision, 'revision'))));
  router.delete('/', change((store, req) => store.remove(text(req.query.repository, 'repository'), text(req.query.revision, 'revision'))));
  router.all('/', (_req, res) => res.status(405).set('Allow', 'GET, POST, PATCH, DELETE').end());
  return router;
}
