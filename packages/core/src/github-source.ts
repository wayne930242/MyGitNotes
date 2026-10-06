import { createHash } from 'node:crypto';
import { GitHubApi, SourceError } from './github-api.js';
import { readGitHubArchive } from './github-archive.js';
import { type RemoteChange, type RemoteEntry, type RemoteSnapshot, RemoteSource, type RepositoryInfo } from './remote-source.js';
import { hashJson, REMOTE_CACHE_MAX_VALUE, REMOTE_CACHE_TTL, type RemoteCache } from './remote-cache.js';
import { reaching, type RepositoryScope } from './repository.js';
import { sourceIdentity } from './source-config.js';
export { SourceError } from './github-api.js';
export type { RepositoryInfo } from './remote-source.js';
export type GitHubEntry = RemoteEntry;

/** A tree listing as the shared cache keeps it: path, mode, type, sha and size, without the API's URLs. */
type TreeRow = [string, string, string, string, number | null];
const TREE_KEY_VERSION = 1;
/** Recent tree listings of this process, keyed like the GitHub runtime by its `fetch`, so test doubles never share one. */
const processTrees = new WeakMap<typeof fetch, Map<string, GitHubEntry[]>>();
const PROCESS_TREES = 8;

const BLOB_BATCH_COUNT = 500;
const BLOB_BATCH_BYTES = 4 * 1024 * 1024;

/** Consecutive groups of at most `BLOB_BATCH_COUNT` blobs and, unless one blob alone exceeds it, `BLOB_BATCH_BYTES`. */
export function blobBatches(entries: RemoteEntry[]): RemoteEntry[][] {
  const batches: RemoteEntry[][] = [];
  let current: RemoteEntry[] = [], bytes = 0;
  for (const entry of entries) {
    const size = entry.size || 0;
    if (current.length && (current.length >= BLOB_BATCH_COUNT || bytes + size > BLOB_BATCH_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** GitHub transport with its existing authorization-scoped cache. */
export class GitHubSource extends RemoteSource {
  private client: GitHubApi;
  constructor(repository: string, branch: string, token: string | undefined, private request: typeof fetch, cache: RemoteCache | undefined, scope: RepositoryScope) {
    super(repository, branch, token, cache, scope);
    this.client = new GitHubApi(repository, token, request);
  }
  get id() {
    return sourceIdentity({ type: 'github', repository: this.repository, branch: this.branch });
  }
  async api(endpoint: string, init: RequestInit = {}): Promise<any> {
    return this.client.json(endpoint, init, this.fresh && (endpoint === '' || endpoint.startsWith('/commits/')));
  }
  protected async loadSnapshot(): Promise<RemoteSnapshot> {
    const info: RepositoryInfo = await reaching('no-access', async () => {
      const found: RepositoryInfo = await this.api('');
      if (found.private && !this.token) throw new SourceError('Sign in to read this private repository.', 401);
      return found;
    });
    const commit = await reaching('missing-branch', () => this.api(`/commits/${encodeURIComponent(this.branch)}`));
    const treeSha: string = commit.commit.tree.sha;
    return { sha: commit.sha as string, treeSha, entries: await this.treeEntries(treeSha), info };
  }
  /**
   * The recursive listing of `treeSha`, which an authorized commit read just named. A tree never changes, so a new
   * server instance takes the listing from this process or the shared cache instead of listing it again.
   */
  private async treeEntries(treeSha: string): Promise<GitHubEntry[]> {
    const key = `mgn:tree:v${TREE_KEY_VERSION}:${this.repository.toLowerCase()}:${treeSha}`;
    let recent = processTrees.get(this.request);
    if (!recent) processTrees.set(this.request, recent = new Map());
    const remembered = recent.get(key);
    if (remembered) return remembered;
    const entries = await this.cachedTree(key) ?? await this.listTree(treeSha, key);
    if (recent.size >= PROCESS_TREES) recent.delete(recent.keys().next().value!);
    recent.set(key, entries);
    return entries;
  }
  private async cachedTree(key: string): Promise<GitHubEntry[] | undefined> {
    const hit = this.cache ? (await this.cache.get([key]))[0] : null;
    if (hit === null) return undefined;
    try {
      const rows = JSON.parse(hit) as TreeRow[];
      if (Array.isArray(rows) && rows.every(row => Array.isArray(row) && row.slice(0, 4).every(field => typeof field === 'string'))) return rows.map(([path, mode, type, sha, size]) => size === null ? { path, mode, type, sha } : { path, mode, type, sha, size });
    } catch { /* A damaged value is listed again. */ }
    return undefined;
  }
  private async listTree(treeSha: string, key: string): Promise<GitHubEntry[]> {
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
    entries = entries.map(({ path, mode, type, sha, size }) => size === undefined ? { path, mode, type, sha } : { path, mode, type, sha, size });
    const text = JSON.stringify(entries.map(({ path, mode, type, sha, size }): TreeRow => [path, mode, type, sha, size ?? null]));
    if (this.cache && Buffer.byteLength(text) <= REMOTE_CACHE_MAX_VALUE) await this.cache.set([[key, text]], REMOTE_CACHE_TTL);
    return entries;
  }
  protected async readBlob(sha: string): Promise<Buffer> {
    const blob = await this.api(`/git/blobs/${sha}`);
    if (blob.encoding !== 'base64') throw new SourceError('Unsupported GitHub file encoding.', 422);
    return Buffer.from(blob.content, 'base64');
  }
  protected invalidate() {
    this.client.invalidate();
  }
  async prefetchFiles(files: string[]) {
    const snapshot = await this.getSnapshot();
    const wanted = new Set(files);
    const candidates = snapshot.entries.filter(entry => wanted.has(entry.path) && entry.type === 'blob' && entry.mode !== '120000' && (entry.size || 0) <= 5 * 1024 * 1024);
    const missing = (await this.loadCached(candidates)).filter(entry => !this.client.hasBlob(entry.sha));
    if (missing.length <= 6) return;
    // Concurrent requests for different file sets each complete their own prefetch.
    await this.client.once(`archive:${snapshot.sha}:${hashJson(missing.map(entry => entry.sha).sort())}`, async () => {
      if (missing.every(entry => this.client.hasBlob(entry.sha))) return;
      // Authenticated reads never download repository archives inside the server function.
      if (this.token) return this.prefetchBlobBatches(missing);
      try {
        const archive = await this.client.archive(snapshot.sha);
        const contents = await readGitHubArchive(archive, snapshot.entries.filter(entry => entry.type === 'blob' && entry.mode !== '120000' && /\.(md|markdown|mdx|txt|ya?ml)$/i.test(entry.path)));
        for (const [sha, bytes] of contents) this.client.putBlob(sha, bytes);
      } catch (error) {
        // A missing archive may still have individually readable blobs. Never fall back through a cooldown.
        if (!(error instanceof SourceError) || ![404, 413].includes(error.status)) throw error;
      }
    });
  }

  /**
   * Loads only the requested files, verified against their Git SHA. Requests for one user stay serial, as GitHub asks,
   * so each GraphQL request takes as many blobs as its size bounds allow: the round trips, not the bytes, dominate.
   */
  private async prefetchBlobBatches(entries: RemoteEntry[]) {
    const pending = entries.filter(entry => !this.client.hasBlob(entry.sha));
    for (const batch of blobBatches(pending)) {
      let texts: Map<string, string>;
      try {
        texts = await this.client.blobTexts(batch.map(entry => entry.sha));
      } catch (error) {
        // Unloaded notes fall back to individual blob reads. Never fall back through a cooldown or lost access.
        if (!(error instanceof SourceError) || [401, 403, 404, 429].includes(error.status)) throw error;
        return;
      }
      const verified: [RemoteEntry, Buffer][] = [];
      for (const entry of batch) {
        const text = texts.get(entry.sha);
        if (text === undefined) continue;
        const bytes = Buffer.from(text, 'utf8');
        if (createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== entry.sha) continue;
        this.client.putBlob(entry.sha, bytes);
        verified.push([entry, bytes]);
      }
      if (verified.some(([entry]) => this.cacheable(entry))) await this.storeCached(verified);
    }
  }

  protected async publishChanges(changes: RemoteChange[], snapshot: RemoteSnapshot, message: string): Promise<string> {
    const entries = [];
    for (const change of changes) {
      const value = change.content !== undefined ? { content: change.content } : { sha: change.base64 !== undefined ? (await this.api('/git/blobs', { method: 'POST', body: JSON.stringify({ content: change.base64, encoding: 'base64' }) })).sha : change.sha };
      entries.push({ path: change.path, mode: '100644', type: 'blob', ...value });
    }
    const tree = await this.api('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: snapshot.treeSha, tree: entries }) });
    const commit = await this.api('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [snapshot.sha] }) });
    await this.api(`/git/refs/heads/${encodeURIComponent(this.branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
    return commit.sha as string;
  }
}
