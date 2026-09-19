import { type RemoteChange, type RemoteEntry, type RemoteSnapshot, RemoteSource } from './remote-source.js';
import { SourceError } from './github-api.js';
import { normalizeGitLabUrl } from './source-config.js';
import type { RemoteCache } from './remote-cache.js';

/** GitLab API v4 adapter. Reads remain pinned to immutable Git objects. */
export class GitLabSource extends RemoteSource {
  readonly url: string;
  private blobs = new Map<string, Promise<Buffer>>();
  constructor(url: string, repository: string, branch: string, token?: string, private request: typeof fetch = fetch, cache?: RemoteCache) {
    super(repository, branch, token, cache);
    this.url = normalizeGitLabUrl(url);
  }
  private async response(endpoint: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await this.request(`${this.url}/api/v4/projects/${encodeURIComponent(this.repository)}${endpoint}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', 'User-Agent': 'MyGitNotes', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
    } catch {
      throw new SourceError('GitLab could not be reached. Check the configured site and connection.', 502);
    }
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const seconds = retry && /^\d+$/.test(retry) ? Math.max(1, Number(retry)) : 60;
      if (response.status === 429) throw new SourceError('GitLab rate limit reached. Retry later.', 429, seconds);
      if (response.status === 401) throw new SourceError('Sign in again to authorize GitLab access.', 401);
      if (response.status === 403) throw new SourceError('GitLab permission denied.', 403);
      if (response.status === 404) throw new SourceError('GitLab repository, branch or file is unavailable. Sign in for private access.', 404);
      if ([400, 409, 422].includes(response.status) && init.method === 'POST') throw new SourceError('GitLab could not commit this change. Reload and review the latest files before retrying.', 409);
      throw new SourceError('GitLab request failed.', 502);
    }
    return response;
  }
  private async json(endpoint: string, init?: RequestInit): Promise<any> {
    return (await this.response(endpoint, init)).json();
  }
  protected async loadSnapshot(): Promise<RemoteSnapshot> {
    const project = await this.json('');
    if (project.visibility !== 'public' && !this.token) throw new SourceError('Sign in to read this private repository.', 401);
    const branch = await this.json(`/repository/branches/${encodeURIComponent(this.branch)}`);
    const sha = branch.commit?.id;
    if (typeof sha !== 'string' || !/^[a-f0-9]{40,64}$/.test(sha)) throw new SourceError('GitLab returned an invalid branch revision.', 502);
    const entries: RemoteEntry[] = [];
    const seen = new Set<string>();
    for (let page = 1;; page++) {
      const response = await this.response(`/repository/tree?ref=${sha}&recursive=true&per_page=100&page=${page}`);
      const tree = await response.json() as { path: string; type: string; mode: string; id: string; }[];
      if (!Array.isArray(tree)) throw new SourceError('GitLab returned an invalid repository tree.', 502);
      for (const entry of tree) {
        if (!entry.path || !entry.id || seen.has(entry.path)) throw new SourceError('GitLab returned an incomplete repository listing.', 502);
        seen.add(entry.path);
        entries.push({ path: entry.path, type: entry.type, mode: entry.mode, sha: entry.id });
      }
      if (entries.length > 100000) throw new SourceError('Repository exceeds the supported file listing size.', 422);
      const next = response.headers.get('x-next-page');
      if (next === '' || (next === null && tree.length < 100)) break;
      if (!tree.length || next !== null && next !== String(page + 1)) throw new SourceError('GitLab returned invalid pagination.', 502);
    }
    return { sha, treeSha: sha, entries, info: { private: project.visibility !== 'public', default_branch: project.default_branch, permissions: { push: Boolean(this.token && branch.can_push) } } };
  }
  protected async readBlob(sha: string): Promise<Buffer> {
    let pending = this.blobs.get(sha);
    if (!pending) {
      pending = (async () => {
        const blob = await this.json(`/repository/blobs/${encodeURIComponent(sha)}`);
        if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new SourceError('Unsupported GitLab blob encoding.', 422);
        if (blob.size > 5 * 1024 * 1024 || blob.content.length > 7 * 1024 * 1024) throw new SourceError('File exceeds the 5 MiB read limit.', 413);
        return Buffer.from(blob.content, 'base64');
      })();
      this.blobs.set(sha, pending);
    }
    return pending;
  }
  protected async publishChanges(changes: RemoteChange[], snapshot: RemoteSnapshot, message: string): Promise<string> {
    const actions = [];
    let total = 0;
    for (const change of changes) {
      const existing = snapshot.entries.find(entry => entry.path === change.path);
      let lastCommit: string | undefined;
      if (existing) {
        const file = await this.json(`/repository/files/${encodeURIComponent(change.path)}?ref=${snapshot.sha}`);
        if (file.blob_id !== existing.sha || typeof file.last_commit_id !== 'string') throw new SourceError('GitLab file version is unavailable.', 409);
        lastCommit = file.last_commit_id;
      }
      if (change.sha === null) {
        actions.push({ action: 'delete', file_path: change.path, last_commit_id: lastCommit });
        continue;
      }
      const bytes = change.content !== undefined ? Buffer.from(change.content) : change.base64 !== undefined ? Buffer.from(change.base64, 'base64') : await this.readBlob(change.sha!);
      total += bytes.length;
      if (total > 5 * 1024 * 1024) throw new SourceError('Mutation exceeds the 5 MiB limit.', 413);
      actions.push({ action: existing ? 'update' : 'create', file_path: change.path, content: bytes.toString('base64'), encoding: 'base64', ...(lastCommit ? { last_commit_id: lastCommit } : {}) });
    }
    // Refresh permissions and the branch after preparing actions; GitLab validates file versions atomically.
    const branch = await this.json(`/repository/branches/${encodeURIComponent(this.branch)}`);
    if (!branch.can_push) throw new SourceError('Write access on the main workspace branch is required.', 403);
    if (branch.commit?.id !== snapshot.sha) throw new SourceError('The repository changed. Reload before saving.', 409);
    const commit = await this.json('/repository/commits', { method: 'POST', body: JSON.stringify({ branch: this.branch, commit_message: message, actions, force: false }) });
    if (typeof commit.id !== 'string' || !/^[a-f0-9]{40,64}$/.test(commit.id)) throw new SourceError('GitLab returned no commit revision. Reload to check whether the change was saved.', 502);
    return commit.id;
  }
}
