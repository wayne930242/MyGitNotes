import { GitHubApi, SourceError } from './github-api.js';
import { readGitHubArchive } from './github-archive.js';
import { RemoteSource, type RemoteEntry, type RemoteSnapshot, type RemoteChange, type RepositoryInfo } from './remote-source.js';
export { SourceError } from './github-api.js';
export type { RepositoryInfo } from './remote-source.js';
export type GitHubEntry = RemoteEntry;

/** GitHub transport with its existing authorization-scoped cache. */
export class GitHubSource extends RemoteSource {
  private client: GitHubApi;
  constructor(repository: string, branch: string, token?: string, request: typeof fetch = fetch) {
    super(repository, branch, token);
    this.client = new GitHubApi(repository, token, request);
  }
  async api(endpoint: string, init: RequestInit = {}): Promise<any> {
    return this.client.json(endpoint, init, this.fresh && (endpoint === '' || endpoint.startsWith('/commits/')));
  }
  protected async loadSnapshot(): Promise<RemoteSnapshot> {

      const info: RepositoryInfo = await this.api('');
      if (info.private && !this.token) throw new SourceError('Sign in to read this private repository.', 401);
      const commit = await this.api(`/commits/${encodeURIComponent(this.branch)}`);
      const treeSha: string = commit.commit.tree.sha;
      const result = await this.api(`/git/trees/${treeSha}?recursive=1`);
      let entries: GitHubEntry[] = result.tree;
      if (result.truncated) {
        entries = [];
        const pending = [{ sha: treeSha, prefix: '' }];
        while (pending.length) {
          const next = pending.shift()!;
          const tree = await this.api(`/git/trees/${next.sha}`);
          if (tree.truncated) throw new SourceError('Repository directory is too large to list completely.', 422);
          for (const entry of tree.tree as GitHubEntry[]) {
            const full = { ...entry, path: `${next.prefix}${entry.path}` };
            entries.push(full);
            if (entry.type === 'tree') pending.push({ sha: entry.sha, prefix: `${full.path}/` });
          }
          if (entries.length > 100000) throw new SourceError('Repository exceeds the supported file listing size.', 422);
        }
      }
      return { sha: commit.sha as string, treeSha, entries, info };
  }
  protected async readBlob(sha: string): Promise<Buffer> {
    const blob = await this.api(`/git/blobs/${sha}`);
    if (blob.encoding !== 'base64') throw new SourceError('Unsupported GitHub file encoding.', 422);
    return Buffer.from(blob.content, 'base64');
  }
  protected invalidate() { this.client.invalidate(); }
  async prefetchFiles(files: string[]) {
    const snapshot = await this.getSnapshot();
    const wanted = new Set(files);
    const missing = snapshot.entries.filter(entry => wanted.has(entry.path) && entry.type === 'blob' && entry.mode !== '120000' &&
      (entry.size || 0) <= 5 * 1024 * 1024 && !this.client.hasBlob(entry.sha));
    if (missing.length <= 6) return;
    await this.client.once(`archive:${snapshot.sha}`, async () => {
      if (missing.every(entry => this.client.hasBlob(entry.sha))) return;
      try {
        const archive = await this.client.archive(snapshot.sha);
        const contents = await readGitHubArchive(archive, snapshot.entries.filter(entry => entry.type === 'blob' && entry.mode !== '120000' &&
          /\.(md|markdown|txt|ya?ml)$/i.test(entry.path)));
        for (const [sha, bytes] of contents) this.client.putBlob(sha, bytes);
      } catch (error) {
        // A missing archive may still have individually readable blobs. Never fall back through a cooldown.
        if (!(error instanceof SourceError) || ![404, 413].includes(error.status)) throw error;
      }
    });
  }

  protected async publishChanges(changes: RemoteChange[], snapshot: RemoteSnapshot, message: string): Promise<string> {
    const entries = [];
    for (const change of changes) {
      const value = change.content !== undefined ? { content: change.content } : {
        sha: change.base64 !== undefined ? (await this.api('/git/blobs', { method: 'POST', body: JSON.stringify({ content: change.base64, encoding: 'base64' }) })).sha : change.sha,
      };
      entries.push({ path: change.path, mode: '100644', type: 'blob', ...value });
    }
    const tree = await this.api('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: snapshot.treeSha, tree: entries }) });
    const commit = await this.api('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [snapshot.sha] }) });
    await this.api(`/git/refs/heads/${encodeURIComponent(this.branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
    return commit.sha as string;
  }
}
