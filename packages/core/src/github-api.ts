import { createHash } from 'node:crypto';

export class SourceError extends Error {
  constructor(message: string, public status = 400, public retryAfter?: number) { super(message); }
}

type Cached = { value: any; expires: number; etag?: string; bytes: number; immutable: boolean };
type Lane = { tail: Promise<unknown>; queued: number; blockedUntil: number; lastWrite: number };
type Runtime = { cache: Map<string, Cached>; pending: Map<string, Promise<any>>; lanes: Map<string, Lane>; bytes: number; generation: Map<string, number> };
const runtimes = new WeakMap<typeof fetch, Runtime>();
const MAX_BYTES = 64 * 1024 * 1024;
const IMMUTABLE_TTL = 60 * 60 * 1000;
const FRESH_TTL = 60 * 1000;

/** Process-local optimization. Authorization scopes never share cached repository data. */
export class GitHubApi {
  private runtime: Runtime;
  private scope: string;
  private prefix: string;
  private lane: Lane;
  constructor(private repository: string, private token: string | undefined, private request: typeof fetch) {
    let runtime = runtimes.get(request);
    if (!runtime) { runtime = { cache: new Map(), pending: new Map(), lanes: new Map(), bytes: 0, generation: new Map() }; runtimes.set(request, runtime); }
    this.runtime = runtime;
    this.scope = token ? createHash('sha256').update(token).digest('hex') : 'anonymous';
    this.prefix = `${this.scope}:${repository.toLowerCase()}:`;
    let lane = runtime.lanes.get(this.scope);
    if (!lane) {
      // Drop idle lanes, retaining active cooldowns and queued work.
      if (runtime.lanes.size >= 1000) for (const [key, entry] of runtime.lanes) {
        if (!entry.queued && entry.blockedUntil < Date.now() && entry.lastWrite < Date.now() - IMMUTABLE_TTL) runtime.lanes.delete(key);
      }
      if (runtime.lanes.size >= 1000) throw new SourceError('GitHub service is busy. Retry later.', 503, 60);
      lane = { tail: Promise.resolve(), queued: 0, blockedUntil: 0, lastWrite: 0 }; runtime.lanes.set(this.scope, lane);
    }
    this.lane = lane;
  }

  private key(endpoint: string) { return this.prefix + endpoint; }
  private cached(endpoint: string) {
    const key = this.key(endpoint); const entry = this.runtime.cache.get(key);
    if (entry) { this.runtime.cache.delete(key); this.runtime.cache.set(key, entry); }
    return entry;
  }
  private put(endpoint: string, value: any, ttl: number, etag?: string, immutable = true) {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    const key = this.key(endpoint); const previous = this.runtime.cache.get(key);
    if (previous) { this.runtime.bytes -= previous.bytes; this.runtime.cache.delete(key); }
    if (bytes > MAX_BYTES / 2) return;
    while (this.runtime.cache.size >= 5000 || this.runtime.bytes + bytes > MAX_BYTES) {
      const oldest = this.runtime.cache.keys().next().value!;
      this.runtime.bytes -= this.runtime.cache.get(oldest)!.bytes; this.runtime.cache.delete(oldest);
    }
    this.runtime.cache.set(key, { value, expires: Date.now() + ttl, etag, bytes, immutable }); this.runtime.bytes += bytes;
  }
  invalidate() {
    this.runtime.generation.set(this.prefix, (this.runtime.generation.get(this.prefix) || 0) + 1);
    for (const [key, entry] of this.runtime.cache) if (key.startsWith(this.prefix) && !entry.immutable) {
      this.runtime.bytes -= entry.bytes; this.runtime.cache.delete(key);
    }
  }
  hasBlob(sha: string) { const entry = this.cached(`/git/blobs/${sha}`); return Boolean(entry && entry.expires > Date.now()); }
  putBlob(sha: string, bytes: Buffer) {
    this.put(`/git/blobs/${sha}`, { encoding: 'base64', content: bytes.toString('base64') }, IMMUTABLE_TTL);
  }
  async once<T>(key: string, work: () => Promise<T>): Promise<T> {
    const id = this.key(key);
    const pending = this.runtime.pending.get(id);
    if (pending) return pending;
    const result = work(); this.runtime.pending.set(id, result);
    try { return await result; } finally { if (this.runtime.pending.get(id) === result) this.runtime.pending.delete(id); }
  }
  private cooldown() {
    const seconds = Math.ceil((this.lane.blockedUntil - Date.now()) / 1000);
    if (seconds > 0) throw new SourceError(`GitHub API is temporarily rate limited. Retry in ${seconds} seconds.`, 429, seconds);
  }
  private async send(url: string, init: RequestInit, credentials = true): Promise<Response> {
    this.cooldown();
    if (this.lane.queued >= 128) throw new SourceError('Too many pending GitHub requests. Retry shortly.', 429, 5);
    this.lane.queued++;
    const run = this.lane.tail.catch(() => {}).then(async () => {
      this.cooldown();
      const write = Boolean(init.method && init.method !== 'GET' && init.method !== 'HEAD');
      if (write) {
        const wait = this.lane.lastWrite + 1000 - Date.now();
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        this.cooldown(); this.lane.lastWrite = Date.now();
      }
      const response = await this.request(url, {
        ...init, signal: AbortSignal.timeout(20000),
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'GitHub-Notes',
          ...(credentials && this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      });
      const remaining = response.headers.get('x-ratelimit-remaining');
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
      if (remaining === '0') this.lane.blockedUntil = Math.max(this.lane.blockedUntil, reset || Date.now() + 60_000);
      if (response.status === 403 || response.status === 429) {
        const message = await response.clone().text();
        const retry = response.headers.get('retry-after');
        if (response.status === 429 || remaining === '0' || retry !== null || /rate.?limit|abuse detection/i.test(message)) {
          const seconds = retry === null ? 60 : Number(retry);
          const until = Number.isFinite(seconds) ? Date.now() + Math.max(seconds, 1) * 1000 : Date.parse(retry!);
          this.lane.blockedUntil = Math.max(this.lane.blockedUntil, until || Date.now() + 60_000);
          this.cooldown();
        }
      }
      return response;
    });
    this.lane.tail = run.catch(() => {});
    try { return await run; } finally { this.lane.queued--; }
  }

  async json(endpoint: string, init: RequestInit = {}, fresh = false): Promise<any> {
    const write = Boolean(init.method && init.method !== 'GET');
    const immutable = /^\/git\/(blobs|trees)\//.test(endpoint) || /^\/commits\/[a-f0-9]{40}$/.test(endpoint);
    const cached = write ? undefined : this.cached(endpoint);
    // Revalidate repository access on every authenticated request, even for immutable cached files.
    if (!fresh && !(this.token && endpoint === '') && cached && cached.expires > Date.now()) return structuredClone(cached.value);
    const generation = this.runtime.generation.get(this.prefix) || 0;
    const load = async () => {
      const response = await this.send(`https://api.github.com/repos/${this.repository}${endpoint}`, {
        ...init, redirect: 'error', headers: { ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}), ...init.headers },
      });
      if (!response.ok && !(response.status === 304 && cached)) {
        if ([401, 403, 404].includes(response.status)) this.invalidate();
        throw this.error(response.status);
      }
      const data = response.status === 304 ? cached!.value : response.status === 204 ? null : await response.json();
      if (!write && generation === (this.runtime.generation.get(this.prefix) || 0)) {
        this.put(endpoint, data, immutable ? IMMUTABLE_TTL : FRESH_TTL, response.headers.get('etag') || cached?.etag, immutable);
      }
      return data;
    };
    const result = write ? await load() : await this.once(`json:${endpoint}:${generation}:${fresh}`, load);
    return structuredClone(result);
  }

  async archive(sha: string): Promise<Response> {
    const response = await this.send(`https://api.github.com/repos/${this.repository}/tarball/${encodeURIComponent(sha)}`, { redirect: 'manual' });
    if (response.status !== 302) {
      if (response.ok) return response;
      throw this.error(response.status);
    }
    const location = new URL(response.headers.get('location') || '');
    if (location.protocol !== 'https:' || location.hostname !== 'codeload.github.com' || location.port || location.username || location.password) {
      throw new SourceError('GitHub returned an unexpected archive destination.', 502);
    }
    // The short-lived GitHub download URL carries its own authorization. Never forward the user's token.
    const archive = await this.send(location.href, { redirect: 'error' }, false);
    if (!archive.ok) throw this.error(archive.status);
    return archive;
  }

  private error(status: number) {
    return new SourceError(status === 404 ? 'Repository, branch or file unavailable. Private repositories require GitHub sign-in.' :
      status === 403 ? 'GitHub denied access. Check repository permissions.' :
      status === 409 || status === 422 ? 'The repository changed. Reload the note before saving again.' : `GitHub request failed (${status}).`, status === 422 ? 409 : status);
  }
}
