import { type Request, type Response, Router } from 'express';
import { getCurrentBranch } from '@mygitnotes/git';
import { MembershipError, type MembershipStore, type RepositoryId, SourceError, type WorkspaceConfigSource, type WorkspaceMember, type WorkspaceSettings, WorkspaceSetupError } from '@mygitnotes/core';
import type { AssetStorage } from './asset-storage.js';
import { authToken, CredentialRejected, type SessionServices } from './auth.js';
import { endEventStreams } from './event-stream.js';
import { choosesRepository } from './workspace-choice.js';

/** One member as Settings → Repositories lists it. */
export interface MemberStatus {
  id: RepositoryId;
  alias: string;
  type: 'github' | 'gitlab' | 'local';
  /** The platform repository; absent for a worktree that names none. */
  repository?: string;
  /**
   * The branch this member serves, which keys the drafts a browser holds for it: a hosted repository's configured
   * branch, or the branch a worktree has checked out (empty when detached), as `GET /api/workspace` reports it. A
   * hidden member is not loaded, so this is how Settings finds its drafts before removing it.
   */
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
  /** Hidden members the requester cannot change, counted but not named (see `namedTo`). */
  hiddenUnnamed?: number;
}

/**
 * Whether a member may be named to someone who cannot change the membership: a visible member, which the workspace
 * shows anyway, or a hidden one the requester can change (a local deployment's, or a person's own account member).
 * A hosted deployment's hidden members are the administrator's, so its visitors only learn how many there are.
 */
export const namedTo = (member: WorkspaceMember) => !member.hidden || member.editable !== 'none';

/** The branch a worktree has checked out, read from its `HEAD` without loading any note; undefined where it is gone. */
const worktreeBranch = (worktree: string) => getCurrentBranch(worktree).catch(() => undefined);

const status = async (member: WorkspaceMember): Promise<MemberStatus> => {
  const { source } = member.ref;
  const branch = member.localPath ? await worktreeBranch(member.localPath) : source.type === 'local' ? undefined : source.branch;
  return { id: member.ref.id, alias: member.alias, type: source.type, ...(source.type === 'local' ? {} : { repository: source.repository }), ...(branch === undefined ? {} : { branch }), ...(member.localPath ? { path: member.localPath } : {}), default: member.default, hidden: member.hidden, ...(member.folder ? { folder: member.folder } : {}), editable: member.editable };
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
export function createWorkspaceMembersRouter(configSource: WorkspaceConfigSource, assetStorage: AssetStorage, auth: SessionServices, onChange?: (settings: WorkspaceSettings) => Promise<void>): Router {
  const router = Router();
  /** Answers 401 (or 503) and returns false when a remote request carries no usable sign-in. */
  const signedIn = async (req: Request, res: Response, settings: WorkspaceSettings) => {
    if (settings.site.type === 'local') return true;
    let token: string | undefined;
    try {
      token = await authToken(req, res, auth, settings.site);
    } catch (error) {
      // The session store or provider did not answer; the reader's session still stands.
      if (!(error instanceof CredentialRejected)) throw new SourceError('Session service temporarily unavailable. Retry shortly.', 503);
    }
    if (token) return true;
    res.status(401).json({ error: 'Sign in to see the repositories of this workspace.', code: 'sign-in' });
    return false;
  };
  const change = (action: (store: MembershipStore, req: Request) => Promise<{ revision: string; }>) => async (req: Request, res: Response) => {
    try {
      const store = configSource.membership?.(req);
      if (!store) return res.status(405).json({ error: choosesRepository() ? 'Each visitor of this deployment opens the one repository they chose; use Switch repository to open another.' : 'This deployment lists its repositories in mygitnotes.server.yaml or its environment; the administrator changes them there and redeploys.', code: 'read-only' });
      const { revision } = await action(store, req);
      endEventStreams();
      // What else follows the members (the agent's session) hears of the change without holding up the answer.
      if (onChange) void configSource.settings(req).then(onChange).catch((error: Error) => console.warn(`[members] after a membership change: ${error.message}`));
      res.json({ revision });
    } catch (error) {
      fail(res, error);
    }
  };

  router.get('/', async (req, res) => {
    try {
      const settings = await configSource.settings(req);
      // A local deployment answers only this computer; a remote one names its repositories only to someone signed in,
      // since a private repository's name is not for anonymous visitors.
      if (!(await signedIn(req, res, settings))) return;
      const store = configSource.membership?.(req);
      const environment = store?.environment?.();
      const named = settings.members.filter(namedTo);
      const hiddenUnnamed = settings.members.length - named.length;
      const answer: MembersAnswer = { members: await Promise.all(named.map(status)), changeable: Boolean(store), revision: store ? await store.revision() : null, sharedAssetKeys: Boolean(await assetStorage.sharedKeys?.(req, res)), ...(environment ? { environment } : {}), ...(choosesRepository() ? { repositoryChoice: true as const } : {}), ...(hiddenUnnamed ? { hiddenUnnamed } : {}) };
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
