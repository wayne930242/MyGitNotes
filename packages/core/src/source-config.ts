import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import YAML from 'yaml';
import { resolveWorkspaceConfigPath } from './config.js';
import { normalizeGitHubUrl } from './github-site.js';
import { normalizeHttpsSiteUrl } from './site-url.js';

/** A GitHub source names its site with `url` unless it is github.com, which a source leaves out. */
export type RemoteSourceConfig = { type: 'github'; url?: string; repository: string; branch: string; } | { type: 'gitlab'; url: string; repository: string; branch: string; };
export type SourceConfig = { type: 'local'; path: string; } | RemoteSourceConfig;
export const SERVER_CONFIG_FILENAME = 'github-notes.server.yaml';

/** Deployment-owned HTTPS base URL, including an optional relative installation root. */
export function normalizeGitLabUrl(value: unknown): string {
  return normalizeHttpsSiteUrl(value, 'GitLab');
}
export function parseSourceConfig(raw: unknown, base: string): SourceConfig {
  const source = (raw as { source?: Record<string, unknown>; })?.source;
  if (source?.type === 'local' && typeof source.path === 'string' && source.path.trim()) return { type: 'local', path: path.resolve(base, source.path) };
  const branch = source?.branch;
  /* eslint-disable no-control-regex -- Reject control characters in persisted paths, identifiers or filenames. */
  const validBranch = typeof branch === 'string' && branch.trim() && !/[\x00-\x20~^:?*[\\]/.test(branch) && !branch.includes('..') && !branch.startsWith('-') && !branch.endsWith('/') && !branch.endsWith('.') && !branch.endsWith('.lock') && !branch.includes('//') && !branch.includes('@{');
  /* eslint-enable no-control-regex */
  if (validBranch && typeof source?.repository === 'string') {
    if (source.type === 'github' && /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(source.repository) && !/\/\.{1,2}$/.test(source.repository)) {
      const url = source.url === undefined ? undefined : normalizeGitHubUrl(source.url);
      return { type: 'github', ...(url ? { url } : {}), repository: source.repository, branch };
    }
    if (source.type === 'gitlab' && source.repository.split('/').length >= 2 && source.repository.split('/').every(part => /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part) && !part.endsWith('.git') && !part.endsWith('.atom'))) {
      return { type: 'gitlab', url: normalizeGitLabUrl(source.url ?? 'https://gitlab.com'), repository: source.repository, branch };
    }
  }
  throw new Error('Configure source.type local with path, github with owner/repo and branch, or gitlab with url, group/project and branch.');
}
/** Fills keys that are missing or empty in `env` from a `.env` file; a missing file changes nothing. */
export function loadEnvDefaults(file: string, env: NodeJS.ProcessEnv = process.env) {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const [key, value] of Object.entries(parseEnv(text))) if (!env[key]) env[key] = value;
}
/** A fork-model checkout holds its workspace at the application root; a Core checkout names its `main` worktree. */
function defaultLocalPath(base: string): string {
  if (resolveWorkspaceConfigPath(base)) return base;
  throw new Error(`No MyGitNotes workspace at ${base}. Run \`pnpm link-workspace <path>\` to use an existing workspace, or \`pnpm bootstrap-workspace\` to create one.`);
}
/** The deployment's server configuration file, whether or not it exists. */
export function serverConfigFile(base: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.MYGITNOTES_SERVER_CONFIG || env.GITHUB_NOTES_SERVER_CONFIG || undefined;
  // The compatible name is used only where it exists and the standard one does not; a new file takes the standard name.
  return path.resolve(base, configured || (!fs.existsSync(path.join(base, 'mygitnotes.server.yaml')) && fs.existsSync(path.join(base, SERVER_CONFIG_FILENAME)) ? SERVER_CONFIG_FILENAME : 'mygitnotes.server.yaml'));
}

/** A platform repository without its branch, as a worktree mapping names it; a worktree that names none is `local`. */
export type RepositoryIdentity = (RemoteSourceConfig extends infer T ? T extends RemoteSourceConfig ? Omit<T, 'branch'> : never : never) | { type: 'local'; path: string; };

/**
 * One entry under `repositories` in the server configuration: a member of the deployment's workspace. In local mode
 * it maps a worktree (`path`) and names the platform repository it checks out, or `type: local` for none; in remote
 * mode it names a platform repository and its branch. `alias`, `default`, `hidden` and `folder` are the member's own.
 */
export interface ServerRepositoryEntry {
  /** Position under `repositories`, which errors name. */
  index: number;
  /** Local mode: the platform repository the worktree checks out (the worktree's branch is its own), or `local`. */
  identity: RepositoryIdentity;
  /** Remote mode: the branch; required unless the entry names the deployment's own repository. */
  branch?: string;
  /** Local mode: the worktree, resolved against the server configuration file. */
  path?: string;
  alias?: string;
  default?: boolean;
  hidden?: boolean;
  /** For a repository without a manifest: the repository-relative folder of its one notebook. */
  folder?: string;
}

/** A local deployment's worktree for one repository, from `repositories` in the server configuration. */
export type RepositoryMapping = ServerRepositoryEntry & { source: RepositoryIdentity; path: string; };

/** Whether a mapping names the platform repository `source` serves; the worktree's checked-out branch is its own. */
export function mapsRepository(mapping: RepositoryMapping, source: RemoteSourceConfig): boolean {
  if (mapping.source.type === 'local' || mapping.source.type !== source.type || mapping.source.repository !== source.repository) return false;
  return mapping.source.url === source.url;
}

const ENTRY_KEYS = new Set(['type', 'repository', 'branch', 'url', 'path', 'alias', 'default', 'hidden', 'folder']);

/** A folder a notebook may root at: relative, inside the repository and not the repository itself. */
export function normalizeNotebookFolder(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('folder must name a folder inside the repository.');
  const folder = path.posix.normalize(value.trim().replace(/\\/g, '/')).replace(/\/+$/, '');
  if (path.posix.isAbsolute(folder) || /^[A-Za-z]:/.test(folder) || folder === '.' || folder === '..' || folder.startsWith('../') || folder.split('/').some(part => part.startsWith('.'))) throw new Error(`folder must be a folder inside the repository, not its root, a dot folder or outside it: '${value}'.`);
  return folder;
}

/**
 * The parsed server configuration file, or null when there is none. `text` is the file's text already read (null for no
 * file), so a caller that checked a revision of that text parses exactly what it checked.
 */
export function readServerConfig(base: string, env: NodeJS.ProcessEnv = process.env, text?: string | null): { file: string; raw: Record<string, unknown> | null; } | null {
  const file = serverConfigFile(base, env);
  if (text === undefined) text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (text === null) return null;
  const raw = YAML.parse(text) as unknown;
  if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) throw new Error(`${file} must be a mapping.`);
  return { file, raw: raw as Record<string, unknown> | null };
}

/**
 * The entries under `repositories` in the server configuration, validated for a local or a remote deployment; every
 * error names the file and the entry's index. A relative `path` resolves against the file.
 */
export function loadServerRepositories(base: string, env: NodeJS.ProcessEnv, mode: 'local' | 'remote', text?: string | null): ServerRepositoryEntry[] {
  const config = readServerConfig(base, env, text);
  const listed = config?.raw?.repositories;
  if (!config || listed === undefined || listed === null) return [];
  const { file } = config;
  if (!Array.isArray(listed)) throw new Error(`${file}: repositories must be a list.`);
  const aliases = new Set<string>();
  return listed.map((value: unknown, index): ServerRepositoryEntry => {
    const where = `${file}: repositories[${index}]`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be a mapping.`);
    const entry = value as Record<string, unknown>;
    const unknown = Object.keys(entry).filter(key => !ENTRY_KEYS.has(key));
    if (unknown.length) throw new Error(`${where} has unknown keys: ${unknown.join(', ')}.`);
    const flags: Pick<ServerRepositoryEntry, 'alias' | 'default' | 'hidden' | 'folder'> = {};
    if (entry.alias !== undefined) {
      if (typeof entry.alias !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(entry.alias) || entry.alias.length > 40) throw new Error(`${where}: alias must be a lowercase slug ([a-z0-9][a-z0-9-]*) of at most 40 characters.`);
      if (aliases.has(entry.alias)) throw new Error(`${where}: alias ${entry.alias} is already another repository's.`);
      aliases.add(entry.alias);
      flags.alias = entry.alias;
    }
    for (const key of ['default', 'hidden'] as const) {
      if (entry[key] === undefined) continue;
      if (typeof entry[key] !== 'boolean') throw new Error(`${where}: ${key} must be true or false.`);
      flags[key] = entry[key] as boolean;
    }
    if (entry.folder !== undefined) {
      try {
        flags.folder = normalizeNotebookFolder(entry.folder);
      } catch (error) {
        throw new Error(`${where}: ${(error as Error).message}`);
      }
    }
    if (mode === 'local') {
      if (typeof entry.path !== 'string' || !entry.path.trim()) throw new Error(`${where} needs a path.`);
      if (entry.branch !== undefined) throw new Error(`${where}: a worktree serves the branch it has checked out; remove branch.`);
      const worktree = path.resolve(path.dirname(file), entry.path);
      if (entry.type === 'local') {
        if (entry.repository !== undefined || entry.url !== undefined) throw new Error(`${where}: a local entry names only its path.`);
        return { index, identity: { type: 'local', path: worktree }, path: worktree, ...flags };
      }
      let source: SourceConfig;
      try {
        source = parseSourceConfig({ source: { type: entry.type, repository: entry.repository, url: entry.url, branch: 'main' } }, path.dirname(file));
      } catch (error) {
        throw new Error(`${where}: ${(error as Error).message}`);
      }
      if (source.type === 'local') throw new Error(`${where} must be local, github or gitlab.`);
      const { branch: _branch, ...identity } = source;
      return { index, identity: identity as RepositoryIdentity, path: worktree, ...flags };
    }
    if (entry.path !== undefined || entry.type === 'local') throw new Error(`${where}: a remote deployment reaches repositories through their platform; remove path and name a github or gitlab repository.`);
    let source: SourceConfig;
    try {
      source = parseSourceConfig({ source: { type: entry.type, repository: entry.repository, url: entry.url, branch: entry.branch ?? 'main' } }, path.dirname(file));
    } catch (error) {
      throw new Error(`${where}: ${(error as Error).message}`);
    }
    const { branch, ...identity } = source as RemoteSourceConfig;
    return { index, identity: identity as RepositoryIdentity, ...(entry.branch !== undefined ? { branch } : {}), ...flags };
  });
}

/** The worktrees `repositories` maps in a local deployment's server configuration, with each entry's own settings. */
export function loadRepositoryMappings(base: string, env: NodeJS.ProcessEnv = process.env): RepositoryMapping[] {
  return loadServerRepositories(base, env, 'local').map(entry => ({ ...entry, source: entry.identity, path: entry.path! }));
}

/** The deployment's own source; `text` is the server configuration's text already read, as `readServerConfig` takes it. */
export function loadSourceConfig(base: string, env: NodeJS.ProcessEnv = process.env, text?: string | null): SourceConfig {
  // An empty key, as .env.example ships them, counts as unset.
  const get = (suffix: string) => env[`MYGITNOTES_${suffix}`] || env[`GITHUB_NOTES_${suffix}`] || undefined;
  const type = get('SOURCE');
  if (type) return parseSourceConfig({ source: type === 'local' ? { type, path: get('LOCAL_PATH') || env.REPO_ROOT || defaultLocalPath(base) } : { type, repository: get('REPOSITORY'), branch: get('BRANCH'), url: type === 'github' ? get('GITHUB_URL') : get('GITLAB_URL') || env.GITLAB_URL || undefined } }, base);
  const file = serverConfigFile(base, env);
  // A file that lists only repositories, as Settings may create one in local mode, leaves the source to the environment.
  const config = readServerConfig(base, env, text);
  if (config && config.raw?.source !== undefined) return parseSourceConfig(config.raw, path.dirname(file));
  if (config && !env.VERCEL && config.raw?.repositories === undefined) return parseSourceConfig(config.raw, path.dirname(file));
  if (env.VERCEL) throw new Error('Set MYGITNOTES_SOURCE, MYGITNOTES_REPOSITORY and MYGITNOTES_BRANCH. Existing GITHUB_NOTES_REPOSITORY and related settings remain supported.');
  return { type: 'local', path: env.REPO_ROOT ? path.resolve(env.REPO_ROOT) : defaultLocalPath(base) };
}
/**
 * The deployment's product repository: where Core updates act, on its `core` branch. `MYGITNOTES_PRODUCT_REPOSITORY`
 * (`owner/name`) or `product_repository` in the server configuration names it, on the deployment's GitHub site
 * (`MYGITNOTES_GITHUB_URL`, github.com when unset); null when neither does, and Core updates are then not offered.
 */
export function productRepository(base: string, env: NodeJS.ProcessEnv = process.env): (RemoteSourceConfig & { type: 'github'; }) | null {
  let repository: unknown = env.MYGITNOTES_PRODUCT_REPOSITORY || undefined;
  let where = 'MYGITNOTES_PRODUCT_REPOSITORY';
  if (repository === undefined) {
    const file = serverConfigFile(base, env);
    repository = fs.existsSync(file) ? (YAML.parse(fs.readFileSync(file, 'utf8')) as { product_repository?: unknown; } | null)?.product_repository : undefined;
    where = `${file}: product_repository`;
  }
  if (repository === undefined || repository === null) return null;
  const url = env.MYGITNOTES_GITHUB_URL || env.GITHUB_NOTES_GITHUB_URL || undefined;
  try {
    return parseSourceConfig({ source: { type: 'github', repository, branch: 'core', ...(url ? { url } : {}) } }, base) as RemoteSourceConfig & { type: 'github'; };
  } catch {
    throw new Error(`${where} must name a GitHub repository as owner/name.`);
  }
}

export function sourceIdentity(source: SourceConfig): string {
  if (source.type === 'local') return `local:${source.path}`;
  if (source.type === 'github') return source.url ? `github:${source.url}/${source.repository}@${source.branch}` : `github:${source.repository}@${source.branch}`;
  return `gitlab:${source.url}/${source.repository}@${source.branch}`;
}
