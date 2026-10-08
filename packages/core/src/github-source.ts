import { createHash } from 'node:crypto';
import { GitHubApi, SourceError } from './github-api.js';
import { readGitHubArchive } from './github-archive.js';
import { type RemoteChange, type RemoteCommit, type RemoteEntry, type RemoteSnapshot, RemoteSource, type RepositoryInfo } from './remote-source.js';
import { hashJson, REMOTE_CACHE_MAX_VALUE, REMOTE_CACHE_TTL, type RemoteCache } from './remote-cache.js';
import { reaching, type RepositoryScope } from './repository.js';
import { sourceIdentity } from './source-config.js';
export { SourceError } from './github-api.js';
export type { RepositoryInfo } from './remote-source.js';
export type GitHubEntry = RemoteEntry;

/** A commit as GitHub's REST API lists it. */
interface GitHubCommit {
  sha: string;
  parents: { sha: string; }[];
  author?: { login?: string; } | null;
  commit: { message: string; author?: { name?: string; date?: string; } | null; committer?: { date?: string; } | null; };
}

/** A tree listing as the shared cache keeps it: path, mode, type, sha and size, without the API's URLs. */
type TreeRow = [string, string, string, string, number | null];
const TREE_KEY_VERSION = 1;
/** Recent tree listings of this process, keyed like the GitHub runtime by its `fetch`, so test doubles never share one. */
const processTrees = new WeakMap<typeof fetch, Map<string, GitHubEntry[]>>();
/** The most entries these listings hold together, so a few large repositories cannot grow the process without bound. */
const PROCESS_TREE_ENTRIES = 200_000;

const BLOB_BATCH_COUNT = 500;
const BLOB_BATCH_BYTES = 4 * 1024 * 1024;

/**
 * Whether a recursive listing is exactly the tree `treeSha`: every directory's git object id, recomputed from the
 * entries listed under it, matches the id its parent lists, up to the root. A shared-cache value that passes is the
 * tree an authorized commit read named, so a writer of the cache cannot substitute paths or blob ids.
 */
export function listingMatchesTree(entries: GitHubEntry[], treeSha: string): boolean {
  const children = new Map<string, GitHubEntry[]>([['', []]]);
  const listed = new Map<string, GitHubEntry>();
  for (const entry of entries) {
    if (!/^[0-9a-f]{40}$/.test(entry.sha) || !entry.path || entry.path.split('/').some(part => !part)) return false;
    if (listed.has(entry.path)) return false;
    listed.set(entry.path, entry);
    const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
    let siblings = children.get(parent);
    if (!siblings) children.set(parent, siblings = []);
    siblings.push(entry);
    if (entry.type === 'tree' && !children.has(entry.path)) children.set(entry.path, []);
  }
  const name = (entry: GitHubEntry) => entry.path.slice(entry.path.lastIndexOf('/') + 1);
  const sortKey = (entry: GitHubEntry) => Buffer.from(entry.type === 'tree' ? `${name(entry)}/` : name(entry));
  for (const [directory, rows] of children) {
    const tree = listed.get(directory);
    // Every parent of a listed path must itself be a listed tree.
    if (directory !== '' && tree?.type !== 'tree') return false;
    const expected = directory === '' ? treeSha : tree!.sha;
    const body = Buffer.concat(rows.sort((a, b) => Buffer.compare(sortKey(a), sortKey(b))).map(entry => Buffer.concat([Buffer.from(`${entry.type === 'tree' ? '40000' : entry.mode} ${name(entry)}\0`), Buffer.from(entry.sha, 'hex')])));
    const id = createHash('sha1').update(`tree ${body.length}\0`).update(body).digest('hex');
    if (id !== expected) return false;
  }
  return true;
}

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
  /** `url` names a GitHub Enterprise site; without it the repository is on github.com. */
  constructor(repository: string, branch: string, token: string | undefined, private request: typeof fetch, cache: RemoteCache | undefined, scope: RepositoryScope, private url?: string) {
    super(repository, branch, token, cache, scope);
    this.client = new GitHubApi(repository, token, request, url);
  }
  get id() {
    return sourceIdentity({ type: 'github', ...(this.url ? { url: this.url } : {}), repository: this.repository, branch: this.branch });
  }
  protected override cacheRepository() {
    return this.url ? `${this.url}/${super.cacheRepository()}` : super.cacheRepository();
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
    const key = `mgn:tree:v${TREE_KEY_VERSION}:${this.cacheRepository()}:${treeSha}`;
    let recent = processTrees.get(this.request);
    if (!recent) processTrees.set(this.request, recent = new Map());
    const remembered = recent.get(key);
    if (remembered) {
      // Refresh its place, so the least recently used listing goes first.
      recent.delete(key);
      recent.set(key, remembered);
      return remembered;
    }
    const entries = await this.cachedTree(key, treeSha) ?? await this.listTree(treeSha, key);
    // Requests of every user share these entries; freezing keeps one from changing another's snapshot.
    for (const entry of entries) Object.freeze(entry);
    Object.freeze(entries);
    recent.set(key, entries);
    let total = 0;
    for (const listing of recent.values()) total += listing.length;
    for (const [oldest, listing] of recent) {
      if (total <= PROCESS_TREE_ENTRIES || oldest === key) break;
      recent.delete(oldest);
      total -= listing.length;
    }
    return entries;
  }
  /** The shared cache's listing of `treeSha`, accepted only when it hashes back to that tree. */
  private async cachedTree(key: string, treeSha: string): Promise<GitHubEntry[] | undefined> {
    const hit = this.cache ? (await this.cache.get([key]))[0] : null;
    if (hit === null) return undefined;
    try {
      const rows = JSON.parse(hit) as TreeRow[];
      if (Array.isArray(rows) && rows.every(row => Array.isArray(row) && row.slice(0, 4).every(field => typeof field === 'string'))) {
        const entries: GitHubEntry[] = rows.map(([path, mode, type, sha, size]) => size === null ? { path, mode, type, sha } : { path, mode, type, sha, size });
        if (listingMatchesTree(entries, treeSha)) return entries;
      }
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

  protected async historyPage(file: string, head: string, page: number, perPage: number): Promise<{ commits: RemoteCommit[]; more: boolean; }> {
    const listed: GitHubCommit[] = await this.api(`/commits?sha=${head}&path=${encodeURIComponent(file)}&per_page=${perPage}&page=${page}`);
    if (!Array.isArray(listed)) throw new SourceError('GitHub returned an invalid commit list.', 502);
    return { commits: listed.map(commit => ({ sha: commit.sha, parents: commit.parents.map(parent => parent.sha), date: commit.commit.author?.date || commit.commit.committer?.date || '', author: commit.commit.author?.name || commit.author?.login || '', message: commit.commit.message })), more: listed.length === perPage };
  }
  protected async objectAt(commit: string, file: string): Promise<{ sha: string; size: number; } | null> {
    try {
      const found = await this.api(`/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`);
      return found && !Array.isArray(found) && found.type === 'file' ? { sha: found.sha, size: found.size } : null;
    } catch (error) {
      if (error instanceof SourceError && error.status === 404) return null;
      throw error;
    }
  }
  protected async commitInfo(commit: string): Promise<{ date: string; paths: string[]; } | null> {
    let found: GitHubCommit & { files?: { filename: string; status: string; }[]; };
    try {
      found = await this.api(`/commits/${commit}`);
    } catch (error) {
      if (error instanceof SourceError && [404, 422].includes(error.status)) return null;
      throw error;
    }
    return { date: found.commit.author?.date || '', paths: (found.files || []).filter(entry => entry.status !== 'removed').map(entry => entry.filename) };
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
