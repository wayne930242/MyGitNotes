import fs from 'node:fs';
import path from 'node:path';
import { SourceError } from './github-api.js';
import { folderManifest } from './folder-manifest.js';
import { deriveAlias, repositoryName } from './notebook-key.js';
import { type RepositoryId, type RepositoryRef, repositoryRef } from './repository.js';
import type { ManifestRead } from './repository-manifest.js';
import { loadServerRepositories, loadSourceConfig, type RemoteSourceConfig, type RepositoryIdentity, serverConfigFile, type ServerRepositoryEntry, type SourceConfig } from './source-config.js';
import { serverFileMembership } from './workspace-membership.js';

/** What an adapter may inspect to decide which workspace a request belongs to. */
export interface WorkspaceRequest {
  headers: Record<string, string | string[] | undefined>;
  /**
   * Set by `/mcp` from a verified grant: the person the grant was made for, at the provider realm they signed in to, so
   * an adapter can find their workspace without a browser session. A request carrying it carries no browser cookie.
   */
  person?: WorkspacePerson;
}
/** A signed-in person: the provider realm of their sign-in and their user id there. */
export interface WorkspacePerson {
  realm: string;
  userId: number | string;
}
/** Reads and saves one repository's manifest wherever the configuration source keeps it. */
export interface ManifestStore {
  read(): Promise<ManifestRead>;
  /** Writes `yaml` while `revision` is still current, creating the file when there is none; a stale revision answers 409. */
  save(yaml: string, revision: string): Promise<{ revision: string; }>;
}
/** The platform and site every repository of a workspace is on; sign-in, grants and Gists follow it. */
export interface WorkspaceSite {
  type: 'github' | 'gitlab' | 'local';
  /** A GitHub Enterprise or GitLab site; absent for github.com and for local worktrees. */
  url?: string;
}
/** One source repository of a workspace. */
export interface WorkspaceMember {
  ref: RepositoryRef;
  /** The member's slug in this workspace, the first part of its notebooks' keys; fixed once stored. */
  alias: string;
  /** The member whose default notebook the workspace opens at; exactly one member of a non-empty workspace is. */
  default: boolean;
  /** A hidden member is listed but never opened. */
  hidden: boolean;
  /** Only for a repository without a manifest: the repository-relative folder of its one notebook. */
  folder?: string;
  /** Local mode: the member's worktree. */
  localPath?: string;
  /**
   * Who can change this member from Settings: `server-file` in a local deployment, `environment` for the repository the
   * deployment's environment (or the file's top-level `source`) names, `none` on a hosted community deployment
   * (visitor choice included), `account` in an edition that keeps membership per person.
   */
  editable: 'server-file' | 'account' | 'environment' | 'none';
}
/** A repository to add to a workspace: a platform repository, or in local mode a worktree; `folder` when it has no manifest. */
export interface NewMember {
  ref?: RepositoryRef;
  localPath?: string;
  folder?: string;
}
/**
 * Changes one request's workspace membership. Every change names the `revision` it was read at and is refused with 409
 * when the membership moved since; each answers the new revision. The drafts check before hiding or removing is the
 * browser's, which owns drafts; a store checks the default rule, uniqueness and the site.
 */
export interface MembershipStore {
  /** The membership's current revision. */
  revision(): Promise<string>;
  /** Adds a repository, deriving its alias; a repository is a member once. */
  add(member: NewMember, revision: string): Promise<{ revision: string; member: WorkspaceMember; }>;
  /** Removes a member; the default only when it is the last member (decision C8). */
  remove(id: RepositoryId, revision: string): Promise<{ revision: string; }>;
  /** Hides or unhides a member; the default cannot be hidden, and the first member unhidden without a visible default becomes it. */
  setHidden(id: RepositoryId, hidden: boolean, revision: string): Promise<{ revision: string; }>;
  /** Makes a member the default, unhiding it. */
  setDefault(id: RepositoryId, revision: string): Promise<{ revision: string; }>;
  /** Puts every member in the given order. */
  reorder(order: RepositoryId[], revision: string): Promise<{ revision: string; }>;
  /** Sets the folder of a member's one notebook while it has no manifest. */
  setFolder(id: RepositoryId, folder: string, revision: string): Promise<{ revision: string; }>;
  /** The setting that names the member Settings cannot remove (`editable: 'environment'`), for Settings to say so. */
  environment?(): string;
}
/** Configuration of the workspace serving one request. */
export interface WorkspaceSettings {
  site: WorkspaceSite;
  /** Ordered; exactly one `default` when not empty. Empty means the workspace has no repository yet. */
  members: WorkspaceMember[];
  /** Chooses the manifest store of one member; `inRepository` keeps the manifest as a file in that repository. */
  manifest(member: WorkspaceMember, inRepository: () => ManifestStore): ManifestStore;
}
/** Where workspace configuration comes from. Callers resolve settings per request and never read deployment files themselves. */
export interface WorkspaceConfigSource {
  /** Local deployments serve worktrees; remote deployments reach every repository through a provider API. */
  readonly mode: 'local' | 'remote';
  settings(request: WorkspaceRequest): Promise<WorkspaceSettings>;
  /** Changes the membership of the request's workspace; absent, or undefined for a request, where it is read-only. */
  membership?(request: WorkspaceRequest): MembershipStore | undefined;
}

/** The deployment has no usable source configuration yet. */
export class WorkspaceSetupError extends SourceError {
  constructor(message: string) {
    super(message, 503);
  }
}

/** The site a repository is on. */
export function siteOf(source: SourceConfig): WorkspaceSite {
  if (source.type === 'local') return { type: 'local' };
  return { type: source.type, ...(source.url ? { url: source.url } : {}) };
}

/** Whether a repository is on the site: the same platform and the same site URL, the one a sign-in there reaches. */
export function sameSite(site: WorkspaceSite, source: SourceConfig): boolean {
  if (site.type === 'local' || source.type === 'local') return site.type === source.type;
  return site.type === source.type && site.url === source.url;
}

/** A site as an agent grant records it: `github` for github.com, else the platform and the site's URL. */
export function siteIdentity(site: WorkspaceSite): string {
  return site.url ? `${site.type}:${site.url}` : site.type;
}

/** The default member, when the workspace has one that is not hidden. */
export function defaultMember(settings: Pick<WorkspaceSettings, 'members'>): WorkspaceMember | null {
  return settings.members.find(member => member.default && !member.hidden) ?? null;
}

/** The members a request opens: every one that is not hidden, in order. */
export function visibleMembers(settings: Pick<WorkspaceSettings, 'members'>): WorkspaceMember[] {
  return settings.members.filter(member => !member.hidden);
}

/** Whether two paths are the same directory, following symbolic links; a path that does not exist compares as written. */
function sameDirectory(a: string, b: string): boolean {
  const real = (value: string) => {
    try {
      return fs.realpathSync(value);
    } catch {
      return path.resolve(value);
    }
  };
  return real(a) === real(b);
}

/**
 * The branch a worktree has checked out, read from its `HEAD` (a linked worktree's `.git` file names its Git
 * directory); undefined when the path is not a worktree or its `HEAD` is detached.
 */
function worktreeBranch(worktree: string): string | undefined {
  try {
    const dotGit = path.join(worktree, '.git');
    const gitDir = fs.statSync(dotGit).isDirectory() ? dotGit : path.resolve(worktree, /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'))?.[1]?.trim() ?? '');
    return /^ref: refs\/heads\/(.+)$/m.exec(fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8'))?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Whether two members are one repository, whatever their branches: the same platform repository, or the same worktree. */
export function sameMember(a: Pick<WorkspaceMember, 'ref' | 'localPath'>, b: Pick<WorkspaceMember, 'ref' | 'localPath'>): boolean {
  if (a.localPath && b.localPath && sameDirectory(a.localPath, b.localPath)) return true;
  return sameRepository(a.ref.source, b.ref.source);
}

/** Whether two identities name one platform repository, or in local mode one worktree, whatever their branches. */
function sameRepository(a: RepositoryIdentity | SourceConfig, b: RepositoryIdentity | SourceConfig): boolean {
  if (a.type === 'local' || b.type === 'local') return a.type === b.type && sameDirectory((a as { path: string; }).path, (b as { path: string; }).path);
  return a.type === b.type && a.repository === b.repository && a.url === b.url;
}

/** The deployment's members with the `repositories` entry each was read from (none for the environment's member without one). */
export interface DeploymentMembers {
  members: WorkspaceMember[];
  /** Index under `repositories` of each member's entry, in member order. */
  entries: (number | undefined)[];
}

/**
 * The members of a deployment whose source is `source` and whose server configuration `file` lists `entries`. The
 * repository `source` names is a member and, unless an entry says `default: true`, the default; an entry naming it
 * (its worktree in local mode, its platform repository in remote mode) sets only its alias, default, hidden and folder
 * and places it in the order, which is otherwise first. A worktree mapped to a platform repository is on the branch it
 * has checked out (`main` when that cannot be read). An alias an entry stores is kept; the others derive from
 * repository names in member order, avoiding every stored one, which reproduces the aliases of earlier phases.
 * Every error names `file` and the entry's index.
 */
export function resolveDeploymentMembers(source: SourceConfig, entries: ServerRepositoryEntry[], file: string): DeploymentMembers {
  const local = source.type === 'local';
  const at = (entry: ServerRepositoryEntry) => `${file}: repositories[${entry.index}]`;
  const own = entries.filter(entry => local ? sameDirectory(entry.path!, source.path) : sameRepository(entry.identity, source));
  if (own.length > 1) throw new Error(`${at(own[1])} names ${local ? source.path : (source as RemoteSourceConfig).repository} again; a repository is a member once.`);
  const ownEntry = own[0];
  if (ownEntry && !local && ownEntry.branch !== undefined && ownEntry.branch !== (source as RemoteSourceConfig).branch) throw new Error(`${at(ownEntry)} names the deployment's repository on branch ${ownEntry.branch}; a repository is a member once, on the branch the environment names.`);
  for (const [position, entry] of entries.entries()) {
    if (entry === ownEntry) continue;
    if (!local && entry.branch === undefined) throw new Error(`${at(entry)} needs a branch.`);
    const twice = entries.slice(0, position).find(earlier => earlier !== ownEntry && (sameRepository(earlier.identity, entry.identity) || (local && sameDirectory(earlier.path!, entry.path!))));
    if (twice) throw new Error(`${at(entry)} names the repository of repositories[${twice.index}] again; a repository is a member once, even on two branches.`);
  }
  const defaults = entries.filter(entry => entry.default === true);
  if (defaults.length > 1) throw new Error(`${at(defaults[1])} says default: true, as repositories[${defaults[0].index}] does; one repository is the default.`);
  const isDefault = (entry: ServerRepositoryEntry | undefined) => defaults.length ? entry === defaults[0] : entry === ownEntry || entry === undefined;
  const ordered: (ServerRepositoryEntry | undefined)[] = ownEntry ? [...entries] : [undefined, ...entries];
  const hiddenDefault = ordered.find(entry => isDefault(entry) && entry?.hidden === true);
  if (hiddenDefault) throw new Error(`${at(hiddenDefault)} is the default repository and says hidden: true; the default repository cannot be hidden.`);
  const refOf = (entry: ServerRepositoryEntry | undefined): RepositoryRef => {
    if (entry === undefined || entry === ownEntry) return repositoryRef(source);
    if (local && entry.identity.type === 'local') return repositoryRef(entry.identity);
    if (local) return repositoryRef({ ...entry.identity, branch: worktreeBranch(entry.path!) ?? 'main' } as SourceConfig);
    return repositoryRef({ ...entry.identity, branch: entry.branch! } as SourceConfig);
  };
  // Aliases derive with the environment's repository first and then the entries, as earlier phases derived them,
  // whatever position an entry gives that repository.
  const taken = new Set(entries.flatMap(entry => entry.alias ? [entry.alias] : []));
  const aliases = new Map<ServerRepositoryEntry | undefined, string>();
  for (const entry of [ownEntry, ...entries.filter(other => other !== ownEntry)]) {
    const alias = entry?.alias ?? deriveAlias(repositoryName(refOf(entry).source), taken);
    taken.add(alias);
    aliases.set(entry, alias);
  }
  const members = ordered.map((entry): WorkspaceMember => {
    const environment = entry === undefined || entry === ownEntry;
    const localPath = environment ? local ? source.path : undefined : entry.path;
    return { ref: refOf(entry), alias: aliases.get(entry)!, default: isDefault(entry), hidden: entry?.hidden === true, ...(entry?.folder ? { folder: entry.folder } : {}), ...(localPath ? { localPath } : {}), editable: !local ? 'none' : environment ? 'environment' : 'server-file' };
  });
  return { members, entries: ordered.map(entry => entry?.index) };
}

/** The members of a deployment, as `resolveDeploymentMembers` orders them. */
export function deploymentMembers(source: SourceConfig, entries: ServerRepositoryEntry[], file = 'mygitnotes.server.yaml'): WorkspaceMember[] {
  return resolveDeploymentMembers(source, entries, file).members;
}

/**
 * The deployment's source with its server configuration's members, each entry's index kept for writing them back.
 * `text` is the configuration's text already read (null for no file), so the members come from exactly that text.
 */
export function readDeploymentMembers(base: string, env: NodeJS.ProcessEnv, text?: string | null): DeploymentMembers & { source: SourceConfig; file: string; } {
  try {
    const source = loadSourceConfig(base, env, text);
    if (env.VERCEL && source.type === 'local') throw new Error('Vercel requires a GitHub or GitLab source. Configure MYGITNOTES_SOURCE, MYGITNOTES_REPOSITORY and MYGITNOTES_BRANCH.');
    const file = serverConfigFile(base, env);
    return { source, file, ...resolveDeploymentMembers(source, loadServerRepositories(base, env, source.type === 'local' ? 'local' : 'remote', text), file) };
  } catch (error) {
    throw new WorkspaceSetupError((error as Error).message);
  }
}

/** The setting that names the deployment's own repository, which Settings cannot remove (decision C9). */
export function environmentSetting(base: string, env: NodeJS.ProcessEnv): string {
  const type = env.MYGITNOTES_SOURCE || env.GITHUB_NOTES_SOURCE;
  if (type === 'local') return 'MYGITNOTES_LOCAL_PATH';
  if (type) return 'MYGITNOTES_REPOSITORY';
  const file = serverConfigFile(base, env);
  return fs.existsSync(file) ? `source: in ${file}` : 'MYGITNOTES_LOCAL_PATH';
}

/** Each member's manifest stays in its repository; a member with a picked folder serves one notebook there while the repository keeps no manifest. */
export const memberManifest: WorkspaceSettings['manifest'] = (member, inRepository) => member.folder ? folderManifest(inRepository(), member.folder, repositoryName(member.ref.source)) : inRepository();

/** The deployment's members from the environment or the file's top-level `source`, and its `repositories`. */
function readDeploymentSettings(base: string, env: NodeJS.ProcessEnv): WorkspaceSettings {
  const { source, members } = readDeploymentMembers(base, env);
  return { site: siteOf(source), members, manifest: memberManifest };
}

/**
 * Configuration from the environment and `mygitnotes.server.yaml`, each repository keeping its own manifest. Settings
 * are read on every call; the mode is fixed when the deployment starts. A local deployment changes its membership by
 * rewriting the server configuration; a remote one is read-only, its administrator editing the configuration.
 */
export function deploymentConfigSource(base: string, env: NodeJS.ProcessEnv = process.env): WorkspaceConfigSource {
  let mode: WorkspaceConfigSource['mode'] = 'remote';
  try {
    // The mode follows the source alone, so a configuration error in repositories does not start a local deployment in remote mode.
    mode = loadSourceConfig(base, env).type === 'local' && !env.VERCEL ? 'local' : 'remote';
  } catch {
    // A deployment without a usable source starts in remote mode and reports the setup error per request.
  }
  const membership = mode === 'local' ? serverFileMembership(base, env) : undefined;
  return {
    mode,
    settings: async () => {
      const settings = readDeploymentSettings(base, env);
      if ((settings.site.type === 'local') !== (mode === 'local')) throw new WorkspaceSetupError('The deployment source changed between local and remote. Restart the server.');
      return settings;
    },
    ...(membership ? { membership: () => membership } : {}),
  };
}
