import { GitHubSource } from './github-source.js';
import { GitLabSource } from './gitlab-source.js';
import type { RemoteSource } from './remote-source.js';
import type { RemoteSourceConfig } from './source-config.js';
import type { RemoteCache } from './remote-cache.js';

export function createRemoteSource(source: RemoteSourceConfig, token?: string, request: typeof fetch = fetch, cache?: RemoteCache): RemoteSource {
  return source.type === 'github' ? new GitHubSource(source.repository, source.branch, token, request, cache) : new GitLabSource(source.url, source.repository, source.branch, token, request, cache);
}
