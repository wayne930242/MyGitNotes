import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export type SourceConfig = { type: 'local'; path: string } | { type: 'github'; repository: string; branch: string };
export const SERVER_CONFIG_FILENAME = 'github-notes.server.yaml';

export function parseSourceConfig(raw: unknown, base: string): SourceConfig {
  const source = (raw as { source?: Record<string, unknown> })?.source;
  if (source?.type === 'local' && typeof source.path === 'string' && source.path.trim()) {
    return { type: 'local', path: path.resolve(base, source.path) };
  }
  if (source?.type === 'github' && typeof source.repository === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(source.repository) && !/\/\.{1,2}$/.test(source.repository) &&
    typeof source.branch === 'string' && source.branch.trim() && !/[\x00-\x20~^:?*\[\\]/.test(source.branch) &&
    !source.branch.includes('..') && !source.branch.startsWith('-')) {
    return { type: 'github', repository: source.repository, branch: source.branch };
  }
  throw new Error('Configure source.type local with path, or github with repository (owner/repo) and branch.');
}

export function loadSourceConfig(base: string, env: NodeJS.ProcessEnv = process.env): SourceConfig {
  if (env.GITHUB_NOTES_SOURCE) {
    return parseSourceConfig({ source: env.GITHUB_NOTES_SOURCE === 'local'
      ? { type: 'local', path: env.GITHUB_NOTES_LOCAL_PATH || env.REPO_ROOT || base }
      : { type: env.GITHUB_NOTES_SOURCE, repository: env.GITHUB_NOTES_REPOSITORY, branch: env.GITHUB_NOTES_BRANCH } }, base);
  }
  const file = path.resolve(base, env.GITHUB_NOTES_SERVER_CONFIG || SERVER_CONFIG_FILENAME);
  if (fs.existsSync(file)) return parseSourceConfig(YAML.parse(fs.readFileSync(file, 'utf8')), path.dirname(file));
  if (env.VERCEL) throw new Error('Set GITHUB_NOTES_SOURCE=github, GITHUB_NOTES_REPOSITORY=owner/repo and GITHUB_NOTES_BRANCH in Vercel.');
  return { type: 'local', path: path.resolve(env.REPO_ROOT || base) };
}

export function sourceIdentity(source: SourceConfig): string {
  return source.type === 'local' ? `local:${source.path}` : `github:${source.repository}@${source.branch}`;
}
