import fs from 'node:fs';
import { SourceError } from './github-api.js';
import { deriveAlias, repositoryName } from './notebook-key.js';
import { type RepositoryRef, repositoryRef } from './repository.js';
import type { ManifestRead } from './repository-manifest.js';
import { loadRepositoryMappings, loadSourceConfig, type SourceConfig } from './source-config.js';

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
  /** Local mode: the member's worktree. */
  localPath?: string;
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

/** Whether two paths are the same directory, following symbolic links. */
function sameDirectory(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * The deployment's members: the repository the environment or the file's top-level `source` names, which is the
 * default, then in local mode each worktree `repositories` maps, in the file's order. A mapping onto the default
 * worktree is that repository by another name. Aliases derive from repository names in that order.
 */
function readDeploymentSettings(base: string, env: NodeJS.ProcessEnv): WorkspaceSettings {
  let source;
  let mappings;
  try {
    source = loadSourceConfig(base, env);
    if (env.VERCEL && source.type === 'local') throw new Error('Vercel requires a GitHub or GitLab source. Configure MYGITNOTES_SOURCE, MYGITNOTES_REPOSITORY and MYGITNOTES_BRANCH.');
    mappings = source.type === 'local' ? loadRepositoryMappings(base, env) : [];
  } catch (error) {
    throw new WorkspaceSetupError((error as Error).message);
  }
  const taken = new Set<string>();
  const member = (ref: RepositoryRef, isDefault: boolean, localPath?: string): WorkspaceMember => {
    const alias = deriveAlias(repositoryName(ref.source), taken);
    taken.add(alias);
    return { ref, alias, default: isDefault, hidden: false, ...(localPath ? { localPath } : {}) };
  };
  const members = [member(repositoryRef(source), true, source.type === 'local' ? source.path : undefined)];
  const defaultPath = source.type === 'local' ? source.path : undefined;
  for (const mapping of mappings) {
    if (defaultPath && sameDirectory(mapping.path, defaultPath)) continue;
    members.push(member(repositoryRef({ ...mapping.source, branch: 'main' } as SourceConfig), false, mapping.path));
  }
  return { site: siteOf(source), members, manifest: (_member, inRepository) => inRepository() };
}

/** Configuration from the environment and `mygitnotes.server.yaml`, each repository keeping its own manifest. Settings are read on every call; the mode is fixed when the deployment starts. */
export function deploymentConfigSource(base: string, env: NodeJS.ProcessEnv = process.env): WorkspaceConfigSource {
  let mode: WorkspaceConfigSource['mode'] = 'remote';
  try {
    mode = readDeploymentSettings(base, env).site.type === 'local' ? 'local' : 'remote';
  } catch {
    // A deployment without a usable source starts in remote mode and reports the setup error per request.
  }
  return {
    mode,
    settings: async () => {
      const settings = readDeploymentSettings(base, env);
      if ((settings.site.type === 'local') !== (mode === 'local')) throw new WorkspaceSetupError('The deployment source changed between local and remote. Restart the server.');
      return settings;
    },
  };
}
