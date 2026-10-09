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
function serverConfigFile(base: string, env: NodeJS.ProcessEnv): string {
  const configured = env.MYGITNOTES_SERVER_CONFIG || env.GITHUB_NOTES_SERVER_CONFIG || undefined;
  return path.resolve(base, configured || (fs.existsSync(path.join(base, 'mygitnotes.server.yaml')) ? 'mygitnotes.server.yaml' : SERVER_CONFIG_FILENAME));
}

/** A local deployment's worktree for one platform repository, from `repositories` in the server configuration. */
export interface RepositoryMapping {
  source: RemoteSourceConfig extends infer T ? T extends RemoteSourceConfig ? Omit<T, 'branch'> : never : never;
  path: string;
}

/** Whether a mapping names the platform repository `source` serves; the worktree's checked-out branch is its own. */
export function mapsRepository(mapping: RepositoryMapping, source: RemoteSourceConfig): boolean {
  if (mapping.source.type !== source.type || mapping.source.repository !== source.repository) return false;
  return mapping.source.url === source.url;
}

/** Worktree paths for notebook repositories; a relative `path` resolves against the server configuration file. */
export function loadRepositoryMappings(base: string, env: NodeJS.ProcessEnv = process.env): RepositoryMapping[] {
  const file = serverConfigFile(base, env);
  if (!fs.existsSync(file)) return [];
  const listed = (YAML.parse(fs.readFileSync(file, 'utf8')) as { repositories?: unknown; } | null)?.repositories;
  if (listed === undefined) return [];
  if (!Array.isArray(listed)) throw new Error(`${file}: repositories must be a list.`);
  return listed.map((entry: Record<string, unknown>, index) => {
    if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) throw new Error(`${file}: repositories[${index}] needs a path.`);
    let source: SourceConfig;
    try {
      source = parseSourceConfig({ source: { ...entry, branch: 'main' } }, path.dirname(file));
    } catch (error) {
      throw new Error(`${file}: repositories[${index}]: ${(error as Error).message}`);
    }
    if (source.type === 'local') throw new Error(`${file}: repositories[${index}] must name a github or gitlab repository.`);
    const { branch: _branch, ...identity } = source;
    return { source: identity as RepositoryMapping['source'], path: path.resolve(path.dirname(file), entry.path) };
  });
}

export function loadSourceConfig(base: string, env: NodeJS.ProcessEnv = process.env): SourceConfig {
  // An empty key, as .env.example ships them, counts as unset.
  const get = (suffix: string) => env[`MYGITNOTES_${suffix}`] || env[`GITHUB_NOTES_${suffix}`] || undefined;
  const type = get('SOURCE');
  if (type) return parseSourceConfig({ source: type === 'local' ? { type, path: get('LOCAL_PATH') || env.REPO_ROOT || defaultLocalPath(base) } : { type, repository: get('REPOSITORY'), branch: get('BRANCH'), url: type === 'github' ? get('GITHUB_URL') : get('GITLAB_URL') || env.GITLAB_URL || undefined } }, base);
  const file = serverConfigFile(base, env);
  if (fs.existsSync(file)) return parseSourceConfig(YAML.parse(fs.readFileSync(file, 'utf8')), path.dirname(file));
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
