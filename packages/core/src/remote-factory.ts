import { GitHubSource } from './github-source.js';
import { GitLabSource } from './gitlab-source.js';
import { RemoteManifest } from './remote-manifest.js';
import type { RemoteSource } from './remote-source.js';
import type { RemoteSourceConfig } from './source-config.js';
import type { RemoteCache } from './remote-cache.js';
import type { RepositoryScope } from './repository.js';

/** Opens a repository that serves the notebooks `scope` supplies. */
export function createRemoteSource(source: RemoteSourceConfig, token: string | undefined, request: typeof fetch, cache: RemoteCache | undefined, scope: RepositoryScope): RemoteSource {
  return source.type === 'github' ? new GitHubSource(source.repository, source.branch, token, request, cache, scope) : new GitLabSource(source.url, source.repository, source.branch, token, request, cache, scope);
}

/** Opens a repository that keeps its own workspace manifest and serves every notebook in it. */
export function openRemoteHome(source: RemoteSourceConfig, token?: string, request: typeof fetch = fetch, cache?: RemoteCache): { reader: RemoteSource; manifest: RemoteManifest; } {
  const reader = createRemoteSource(source, token, request, cache, async () => (await manifest.load()).config);
  const manifest = new RemoteManifest(reader);
  return { reader, manifest };
}
