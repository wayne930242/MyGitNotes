import { type Request, type Response, Router } from 'express';
import { getCurrentBranch } from '@mygitnotes/git';
import { githubSite, MembershipError, type MembershipLimit, type MembershipStore, normalizeNotebookFolder, openRemoteRepository, parseSourceConfig, type RemoteSnapshot, type RepositoryId, type RepositoryRef, repositoryRef, RepositoryUnavailableError, SourceError, type WorkspaceConfigSource, type WorkspaceMember, type WorkspaceRequest, type WorkspaceSettings, WorkspaceSetupError, type WorkspaceSite } from '@mygitnotes/core';
import type { AssetStorage } from './asset-storage.js';
import { authToken, CredentialRejected, type SessionServices } from './auth.js';
import { endEventStreams } from './event-stream.js';
import { github } from './workspace-choice.js';

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
  /** What adding takes where membership can be changed: a worktree path, or a platform repository from the picker. */
  adds?: MembershipStore['adds'];
  /** The visible-repository limit, where the store has one. */
  limit?: MembershipLimit;
}
/** The answer of `GET /api/workspace/members/folders`: what adding a platform repository found on its branch. */
export interface MemberFoldersAnswer {
  /** The repository as the provider names it, and the branch looked at. */
  repository: string;
  branch: string;
  /** Whether the branch keeps a manifest, which then names its notebooks and needs no folder. */
  manifest: boolean;
  /** Its top-level folders, where the one notebook of a repository without a manifest may live. */
  folders: string[];
}
/** What the members router is told beside the configuration source. */
export interface MembersRouterOptions {
  /** Each visitor opens the one repository they chose (decision C2): changes are made with Switch repository. */
  repositoryChoice?: boolean;
  /** Runs after a change, without holding up the answer, with the new settings and the request that made it. */
  onChange?: (settings: WorkspaceSettings, request: WorkspaceRequest) => Promise<void>;
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

/** A folder a person typed or picked, normalized as a configured one is; one outside the repository is refused as `invalid`. */
const notebookFolder = (folder: string) => {
  try {
    return normalizeNotebookFolder(folder);
  } catch (error) {
    throw new MembershipError('invalid', (error as Error).message, 400);
  }
};

/** Whoever a members request acts for: the workspace's site, and the token signed in on it (none for a local site). */
interface Requester {
  site: WorkspaceSite;
  token?: string;
}

/** A platform repository a person names to add, checked with their sign-in. */
interface InspectedRepository {
  ref: RepositoryRef;
  answer: MemberFoldersAnswer;
}

/**
 * Checks, with the person's token, that the repository a person names to add exists and is reachable on the
 * workspace's GitHub site, that its branch (the repository's default branch when none is named) exists, and whether
 * that branch keeps a manifest, read by the same lookup a member's manifest is. A manifest that does not load, one that
 * still names `source` included, is refused with its error rather than taken for none. Nothing is written.
 */
async function inspectRepository(site: WorkspaceSite, token: string, repository: unknown, branch: unknown): Promise<InspectedRepository> {
  // The picker lists repositories of a GitHub site; another platform's people add theirs through the configuration.
  if (site.type !== 'github') throw new SourceError('Settings adds repositories on a GitHub site only.', 400);
  const name = typeof repository === 'string' ? repository.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(name)) throw new MembershipError('invalid', 'Name a repository as owner/name.', 400);
  const requested = typeof branch === 'string' && branch.trim() ? branch.trim() : undefined;
  const { body: found } = await github<{ full_name: string; default_branch: string; }>(githubSite(site.url).api, token, `/repos/${name}`);
  if (!found) throw new SourceError('That repository does not exist or this sign-in cannot reach it.', 404);
  let source;
  try {
    source = parseSourceConfig({ source: { type: 'github', ...(site.url ? { url: site.url } : {}), repository: found.full_name, branch: requested ?? found.default_branch } }, '.');
  } catch {
    throw new MembershipError('invalid', 'That branch name is not valid.', 400);
  }
  if (source.type !== 'github') throw new MembershipError('invalid', 'That branch name is not valid.', 400);
  const { reader, manifest } = openRemoteRepository(source, token);
  let snapshot: RemoteSnapshot;
  try {
    snapshot = await reader.getSnapshot(true);
  } catch (error) {
    if (error instanceof RepositoryUnavailableError) throw new SourceError(error.reason === 'missing-branch' ? `Branch ${source.branch} does not exist in ${source.repository}.` : 'That repository does not exist or this sign-in cannot reach it.', 404);
    throw error;
  }
  const read = await manifest.read();
  if (read.state === 'invalid') throw new MembershipError('invalid-manifest', `The manifest of ${source.repository} on ${source.branch} does not load: ${read.error}`);
  const folders = snapshot.entries.filter(entry => entry.type === 'tree' && !entry.path.includes('/') && !entry.path.startsWith('.')).map(entry => entry.path).sort((a, b) => a.localeCompare(b, 'en'));
  return { ref: repositoryRef(source), answer: { repository: source.repository, branch: source.branch, manifest: read.state === 'file', folders } };
}

/**
 * Settings → Repositories: the workspace's members, read from its configuration without opening any repository, so the
 * list works while every repository is hidden or unreachable; and, where the configuration source lets this request
 * change them, adding, removing, hiding, showing, reordering and choosing the default. Mounted ahead of the routes that
 * open repositories. A change ends the open event streams, so every page reconnects to the new membership.
 */
export function createWorkspaceMembersRouter(configSource: WorkspaceConfigSource, assetStorage: AssetStorage, auth: SessionServices, { repositoryChoice = false, onChange }: MembersRouterOptions = {}): Router {
  const router = Router();
  /** The request's sign-in token on the workspace's site; undefined without a usable one. */
  const tokenOf = async (req: Request, res: Response, site: WorkspaceSite) => {
    try {
      return await authToken(req, res, auth, site);
    } catch (error) {
      // The session store or provider did not answer; the reader's session still stands.
      if (!(error instanceof CredentialRejected)) throw new SourceError('Session service temporarily unavailable. Retry shortly.', 503);
      return undefined;
    }
  };
  const signInFirst = (res: Response) => res.status(401).json({ error: 'Sign in to see the repositories of this workspace.', code: 'sign-in' });
  /**
   * Who makes the request: this computer for a local workspace, else the person signed in on its site with their token.
   * Answers 401 (or 503) and returns null when a remote request carries no usable sign-in. The token is read once per
   * request: refreshing an expired cookie session spends its single-use refresh token, which a second read would reuse.
   */
  const signedIn = async (req: Request, res: Response, settings: WorkspaceSettings): Promise<Requester | null> => {
    if (settings.site.type === 'local') return { site: settings.site };
    const token = await tokenOf(req, res, settings.site);
    if (token) return { site: settings.site, token };
    signInFirst(res);
    return null;
  };
  const readOnly = (res: Response) => res.status(405).json({ error: repositoryChoice ? 'Each visitor of this deployment opens the one repository they chose; use Switch repository to open another.' : 'This deployment lists its repositories in mygitnotes.server.yaml or its environment; the administrator changes them there and redeploys.', code: 'read-only' });
  const change = (action: (store: MembershipStore, req: Request, requester: Requester) => Promise<{ revision: string; }>) => async (req: Request, res: Response) => {
    try {
      const store = configSource.membership?.(req);
      if (!store) return readOnly(res);
      // A remote workspace changes only for someone signed in on its site, whatever the store checks itself.
      const requester = await signedIn(req, res, await configSource.settings(req));
      if (!requester) return;
      const { revision } = await action(store, req, requester);
      endEventStreams();
      // What else follows the members (the agent's session) hears of the change without holding up the answer.
      if (onChange) void configSource.settings(req).then(settings => onChange(settings, req)).catch((error: Error) => console.warn(`[members] after a membership change: ${error.message}`));
      res.json({ revision });
    } catch (error) {
      fail(res, error);
    }
  };
  /** A platform repository the request names, checked with the token the requester signed in with. */
  const inspected = async ({ site, token }: Requester, repository: unknown, branch: unknown) => {
    if (!token) throw new SourceError('Sign in to add a repository.', 401);
    return { token, ...await inspectRepository(site, token, repository, branch) };
  };
  /**
   * Adds what the store takes: a worktree path in a local deployment; in an edition that keeps membership per person, a
   * platform repository checked first, which needs a folder exactly when its branch keeps no manifest. That folder is
   * normalized here, as a configured one is, so no store is handed one outside the repository.
   */
  const add = async (store: MembershipStore, req: Request, requester: Requester) => {
    const body = req.body ?? {};
    const folder = typeof body.folder === 'string' ? body.folder : undefined;
    const revision = text(body.revision, 'revision');
    if (store.adds === 'worktree') return store.add({ localPath: body.path, ...(folder !== undefined ? { folder } : {}) }, revision);
    const { token, ref, answer } = await inspected(requester, body.repository, body.branch);
    const picked = folder?.trim();
    if (answer.manifest && picked) throw new MembershipError('folder-unused', `${answer.repository} keeps a manifest on ${answer.branch}, which names its notebooks. Leave the folder empty.`);
    if (!answer.manifest && !picked) throw new MembershipError('folder-required', `${answer.repository} keeps no manifest on ${answer.branch}. Choose the folder its notebook uses.`);
    return store.add({ ref, token, ...(picked ? { folder: notebookFolder(picked) } : {}) }, revision);
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
      const limit = await store?.limit?.();
      const answer: MembersAnswer = { members: await Promise.all(named.map(status)), changeable: Boolean(store), revision: store ? await store.revision() : null, sharedAssetKeys: Boolean(await assetStorage.sharedKeys?.(req, res)), ...(environment ? { environment } : {}), ...(repositoryChoice ? { repositoryChoice: true as const } : {}), ...(hiddenUnnamed ? { hiddenUnnamed } : {}), ...(store ? { adds: store.adds } : {}), ...(limit ? { limit } : {}) };
      res.json(answer);
    } catch (error) {
      fail(res, error);
    }
  });
  // The add flow's folder step: the top-level folders of the branch a person picked, read with their sign-in. A store
  // that adds worktrees asks for a typed folder instead.
  router.get('/folders', async (req, res) => {
    try {
      const store = configSource.membership?.(req);
      if (store?.adds !== 'repository') return readOnly(res);
      const { site } = await configSource.settings(req);
      const requester: Requester = { site, ...(site.type === 'local' ? {} : { token: await tokenOf(req, res, site) }) };
      res.json((await inspected(requester, req.query.repository, req.query.branch)).answer);
    } catch (error) {
      fail(res, error);
    }
  });
  router.post('/', change(add));
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
