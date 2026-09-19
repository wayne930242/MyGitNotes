import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import YAML from 'yaml';
import { resolveWorkspaceConfigPath } from './config.js';

export type RemoteSourceConfig = { type: 'github'; repository: string; branch: string; } | { type: 'gitlab'; url: string; repository: string; branch: string; };
export type SourceConfig = { type: 'local'; path: string; } | RemoteSourceConfig;
export const SERVER_CONFIG_FILENAME = 'github-notes.server.yaml';

/** Deployment-owned HTTPS base URL, including an optional relative installation root. */
export function normalizeGitLabUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Configure a GitLab HTTPS site URL.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /[\\\s]/.test(value) || /%2f|%5c|%2e/i.test(value)) throw new Error('GitLab URL must use HTTPS with a site path and no credentials, query or fragment.');
  return url.href.replace(/\/+$/, '');
}
export function parseSourceConfig(raw: unknown, base: string): SourceConfig {
  const source = (raw as { source?: Record<string, unknown>; })?.source;
  if (source?.type === 'local' && typeof source.path === 'string' && source.path.trim()) return { type: 'local', path: path.resolve(base, source.path) };
  const branch = source?.branch;
  const validBranch = typeof branch === 'string' && branch.trim() && !/[\x00-\x20~^:?*\[\\]/.test(branch) && !branch.includes('..') && !branch.startsWith('-') && !branch.endsWith('/') && !branch.endsWith('.') && !branch.endsWith('.lock') && !branch.includes('//') && !branch.includes('@{');
  if (validBranch && typeof source?.repository === 'string') {
    if (source.type === 'github' && /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(source.repository) && !/\/\.{1,2}$/.test(source.repository)) {
      return { type: 'github', repository: source.repository, branch };
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
  throw new Error(`No MyGitNotes workspace at ${base}. Run \`pnpm bootstrap-workspace\` or set MYGITNOTES_LOCAL_PATH to your main worktree.`);
}
export function loadSourceConfig(base: string, env: NodeJS.ProcessEnv = process.env): SourceConfig {
  // An empty key, as .env.example ships them, counts as unset.
  const get = (suffix: string) => env[`MYGITNOTES_${suffix}`] || env[`GITHUB_NOTES_${suffix}`] || undefined;
  const type = get('SOURCE');
  if (type) return parseSourceConfig({ source: type === 'local' ? { type, path: get('LOCAL_PATH') || env.REPO_ROOT || defaultLocalPath(base) } : { type, repository: get('REPOSITORY'), branch: get('BRANCH'), url: get('GITLAB_URL') || env.GITLAB_URL || undefined } }, base);
  const configured = get('SERVER_CONFIG');
  const file = path.resolve(base, configured || (fs.existsSync(path.join(base, 'mygitnotes.server.yaml')) ? 'mygitnotes.server.yaml' : SERVER_CONFIG_FILENAME));
  if (fs.existsSync(file)) return parseSourceConfig(YAML.parse(fs.readFileSync(file, 'utf8')), path.dirname(file));
  if (env.VERCEL) throw new Error('Set MYGITNOTES_SOURCE, MYGITNOTES_REPOSITORY and MYGITNOTES_BRANCH. Existing GITHUB_NOTES_REPOSITORY and related settings remain supported.');
  return { type: 'local', path: env.REPO_ROOT ? path.resolve(env.REPO_ROOT) : defaultLocalPath(base) };
}
export function sourceIdentity(source: SourceConfig): string {
  if (source.type === 'local') return `local:${source.path}`;
  return source.type === 'github' ? `github:${source.repository}@${source.branch}` : `gitlab:${source.url}/${source.repository}@${source.branch}`;
}
