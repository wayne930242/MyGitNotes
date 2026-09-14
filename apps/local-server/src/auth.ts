import { loadSourceConfig, sourceIdentity, SourceError } from '@github-notes/core';
import { Router, Request, Response } from 'express';
import { createHash, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const lifetime = 30 * 24 * 60 * 60;
const cookieName = 'gh_notes_session';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Set SESSION_SECRET to at least 32 random characters.');
  return createHash('sha256').update(secret).digest();
}
export function seal(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}
export function unseal(value: string): any {
  const data = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString());
}

function redisConnection() {
  return process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN
    ? { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }
    : { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
}

/** Encrypted records remain server-side; production requires a durable Redis REST store. */
export class SessionStore {
  private readonly prefix: string;
  constructor(private base: string) {
    const namespace = process.env.MYGITNOTES_SESSION_NAMESPACE || '';
    if (namespace && !/^[A-Za-z0-9_-]{1,64}$/.test(namespace)) throw new Error('MYGITNOTES_SESSION_NAMESPACE must contain 1-64 letters, digits, underscores or hyphens.');
    this.prefix = namespace ? `gh-notes:${namespace}` : 'gh-notes';
  }
  private get redis() { return Boolean(process.env.VERCEL || redisConnection().url); }
  async command(command: string[]): Promise<any> {
    const { url, token } = redisConnection();
    if (!url || !token || !url.startsWith('https://')) throw new Error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for server-held sessions.');
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
    if (!response.ok) throw new Error('Session store unavailable.');
    const body = await response.json() as { result: unknown; error?: string };
    if (body.error) throw new Error('Session store command failed.');
    return body.result;
  }
  async set(id: string, value: unknown, ttl: number | null = lifetime) {
    const record = seal({ value, expires: ttl === null ? null : Date.now() + ttl * 1000 });
    if (this.redis) {
      await this.command(['SET', `${this.prefix}:${digest(id)}`, record, ...(ttl === null ? [] : ['EX', String(ttl)])]);
      return;
    }
    const dir = path.join(this.base, '.github-notes-sessions');
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(dir, digest(id)), record, { mode: 0o600 });
  }
  async get(id: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
    return this.getByDigest(digest(id));
  }
  async getByDigest(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    let raw: string | null;
    if (this.redis) raw = await this.command(['GET', `${this.prefix}:${hash}`]);
    else {
      try { raw = await fs.readFile(path.join(this.base, '.github-notes-sessions', hash), 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    }
    if (!raw) return null;
    let record: any;
    try {
      record = unseal(raw);
    } catch {
      // Key rotated or record corrupted; self-heal by pruning stale record
      await this.deleteByDigest(hash);
      return null;
    }
    if (record?.expires !== null && record?.expires <= Date.now()) { await this.deleteByDigest(hash); return null; }
    return record?.value;
  }
  async delete(id: string) {
    if (/^[A-Za-z0-9_-]{43}$/.test(id)) await this.deleteByDigest(digest(id));
  }
  async deleteByDigest(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) return;
    if (this.redis) await this.command(['DEL', `${this.prefix}:${hash}`]);
    else await fs.rm(path.join(this.base, '.github-notes-sessions', hash), { force: true });
  }
  async withCredentialLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const lockKey = `${this.base}:${this.prefix}:${id}`;
    const previous = credentialLocks.get(lockKey) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => gate);
    credentialLocks.set(lockKey, tail);
    await previous;
    const nonce = random(), redisKey = `${this.prefix}:refresh:${digest(id)}`;
    let acquired = false;
    try {
      if (this.redis) {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (await this.command(['SET', redisKey, nonce, 'NX', 'PX', '30000']) === 'OK') { acquired = true; break; }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!acquired) throw new SourceError('Authorization refresh is busy. Retry shortly.', 503);
      }
      return await work();
    } finally {
      try {
        if (acquired) await this.command(['EVAL', "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", '1', redisKey, nonce]);
      } finally { release(); if (credentialLocks.get(lockKey) === tail) credentialLocks.delete(lockKey); }
    }
  }
  async indexGrant(token: string, ownerId: number | string) {
    if (this.redis) await this.command(['SADD', `${this.prefix}:grants:${ownerId}`, digest(token)]);
  }
  async listGrants(ownerId: number | string) {
    let hashes: string[];
    if (this.redis) hashes = await this.command(['SMEMBERS', `${this.prefix}:grants:${ownerId}`]);
    else {
      try { hashes = await fs.readdir(path.join(this.base, '.github-notes-sessions')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    }
    const results = [];
    for (const id of hashes) {
      const grant = await this.getByDigest(id);
      if (grant?.kind === 'agent' && grant.ownerId === ownerId) results.push({ id, name: grant.name, write: grant.write, source: grant.source, createdAt: grant.createdAt, expiresAt: null });
      else if (!grant && this.redis) await this.command(['SREM', `${this.prefix}:grants:${ownerId}`, id]);
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }
  async revokeGrant(id: string, ownerId: number | string) {
    const grant = await this.getByDigest(id);
    if (grant?.kind !== 'agent' || grant.ownerId !== ownerId) return false;
    await this.deleteByDigest(id);
    if (this.redis) await this.command(['SREM', `${this.prefix}:grants:${ownerId}`, id]);
    return true;
  }
}
type Provider = { type: 'github' | 'gitlab'; site: string; realm: string; clientId?: string; clientSecret?: string; authorize: string; token: string; user: string };
const credentialLocks = new Map<string, Promise<void>>();
function providerFor(base: string): Provider {
  const source = loadSourceConfig(base);
  const type = source.type === 'gitlab' ? 'gitlab' : 'github';
  const site = source.type === 'gitlab' ? source.url : 'https://github.com';
  const clientId = process.env[type === 'gitlab' ? 'GITLAB_CLIENT_ID' : 'GITHUB_CLIENT_ID'];
  const clientSecret = process.env[type === 'gitlab' ? 'GITLAB_CLIENT_SECRET' : 'GITHUB_CLIENT_SECRET'];
  return { type, site, clientId, clientSecret, realm: `${type}:${site}:${clientId || ''}`,
    authorize: `${site}${type === 'gitlab' ? '/oauth/authorize' : '/login/oauth/authorize'}`,
    token: `${site}${type === 'gitlab' ? '/oauth/token' : '/login/oauth/access_token'}`,
    user: type === 'gitlab' ? `${site}/api/v4/user` : 'https://api.github.com/user' };
}
function matchesProvider(record: any, provider: Provider) { return record?.realm === provider.realm || (!record?.realm && provider.type === 'github'); }
function ownerOf(session: any, provider: Provider): string | number { return provider.type === 'github' ? session.userId : `${digest(provider.realm)}:${session.userId}`; }
function credentialId(userId: number, provider: Provider) {
  return createHash('sha256').update(provider.type === 'github' ? `github-credential:${provider.clientId}:${userId}` : `${provider.realm}:credential:${userId}`).digest('base64url');
}
async function saveCredential(store: SessionStore, session: any, provider: Provider) {
  if (session.credential) return session.credential as string;
  const id = credentialId(session.userId, provider);
  await store.withCredentialLock(id, () => store.set(id, { kind: 'credential', realm: provider.realm, token: session.token, refreshToken: session.refreshToken, upstreamExpiresAt: session.upstreamExpiresAt }, null));
  return id;
}
function cookies(req: Request): Record<string, string> {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(p => p.trim().split('=')).filter(p => p.length === 2));
}
function options() { return { httpOnly: true, secure: process.env.APP_URL?.startsWith('https://') || Boolean(process.env.VERCEL), sameSite: 'lax' as const, path: '/' }; }
async function getSession(req: Request, store: SessionStore, provider: Provider) {
  const id = cookies(req)[cookieName];
  const session = id ? await store.get(id) : null;
  return session?.kind === 'session' && matchesProvider(session, provider) ? session : null;
}
async function tokenRequest(provider: Provider, body: Record<string, unknown>) {
  const response = await fetch(provider.token, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: provider.clientId, client_secret: provider.clientSecret, ...body }) });
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!response.ok || typeof data.access_token !== 'string' || !data.access_token || provider.type === 'gitlab' && (typeof data.refresh_token !== 'string' || !data.refresh_token || !Number.isFinite(data.expires_in) || data.expires_in! <= 0)) {
    throw new SourceError('Authorization failed. Sign in again to reconnect.', 401);
  }
  return data;
}
export async function credentialToken(base: string, id: string): Promise<string> {
  const provider = providerFor(base), store = new SessionStore(base);
  const resolve = async (record: any) => {
    if (!record || !['credential', 'session'].includes(record.kind) || !matchesProvider(record, provider) || typeof record.token !== 'string') throw new SourceError('Agent authorization unavailable. Sign in again.', 401);
    if (provider.type === 'gitlab' && record.upstreamExpiresAt <= Date.now() + 60000) {
      if (!record.refreshToken) throw new SourceError('GitLab authorization expired. Sign in again.', 401);
      const data = await tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: record.refreshToken, redirect_uri: `${process.env.APP_URL}/api/auth/gitlab/callback` });
      record = { ...record, token: data.access_token, refreshToken: data.refresh_token, upstreamExpiresAt: Date.now() + data.expires_in! * 1000 };
      await store.set(id, record, null);
    }
    if (record.upstreamExpiresAt && record.upstreamExpiresAt <= Date.now()) throw new SourceError('Authorization expired. Sign in again to reconnect existing agent grants.', 401);
    return record.token as string;
  };
  const record = await store.get(id);
  if (provider.type === 'gitlab') return store.withCredentialLock(id, async () => resolve(await store.get(id)));
  return resolve(record);
}
export async function authToken(req: Request, base: string): Promise<string | undefined> {
  const provider = providerFor(base), store = new SessionStore(base);
  const session = await getSession(req, store, provider);
  if (!session) return undefined;
  return session.credential ? credentialToken(base, session.credential) : session.token;
}
export function createAuth(base: string): Router {
  const router = Router(), store = new SessionStore(base);
  router.get('/session', async (req, res) => {
    try {
      const provider = providerFor(base), session = await getSession(req, store, provider);
      res.json({ authenticated: Boolean(session), login: session?.login, provider: provider.type, loginUrl: `/api/auth/${provider.type}`,
        configured: Boolean(provider.clientId && provider.clientSecret && process.env.SESSION_SECRET && (!process.env.VERCEL || (redisConnection().url && redisConnection().token))) });
    } catch { res.status(503).json({ error: 'Session store or source configuration unavailable.' }); }
  });
  router.get('/:provider(github|gitlab)', async (req, res) => {
    try {
      const provider = providerFor(base);
      if (req.params.provider !== provider.type) return res.status(404).json({ error: 'This login provider is not configured.' });
      if (!provider.clientId || !provider.clientSecret || !process.env.APP_URL) throw new Error(`Configure ${provider.type.toUpperCase()}_CLIENT_ID, ${provider.type.toUpperCase()}_CLIENT_SECRET, APP_URL and SESSION_SECRET.`);
      const state = random(), verifier = random();
      await store.set(state, { kind: 'oauth', realm: provider.realm, verifier }, 600);
      res.cookie('gh_notes_oauth', state, { ...options(), maxAge: 600000 });
      const params = new URLSearchParams({ client_id: provider.clientId, redirect_uri: `${process.env.APP_URL}/api/auth/${provider.type}/callback`, state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      if (provider.type === 'gitlab') { params.set('response_type', 'code'); params.set('scope', 'api'); }
      else if (process.env.GITHUB_APP_TYPE !== 'github-app') params.set('scope', 'repo');
      res.redirect(`${provider.authorize}?${params}`);
    } catch (error) { res.status(503).json({ error: (error as Error).message }); }
  });
  router.get('/:provider(github|gitlab)/callback', async (req, res) => {
    try {
      const provider = providerFor(base);
      if (req.params.provider !== provider.type) throw new Error('This login provider is not configured.');
      const state = String(req.query.state || ''), browserState = cookies(req).gh_notes_oauth || '';
      if (!/^[A-Za-z0-9_-]{43}$/.test(state) || state.length !== browserState.length || !timingSafeEqual(Buffer.from(state), Buffer.from(browserState))) throw new Error('Invalid OAuth state. Start sign-in again.');
      const pending = await store.get(state);
      await store.delete(state);
      res.clearCookie('gh_notes_oauth', options());
      if (pending?.kind !== 'oauth' || pending.realm !== provider.realm || typeof req.query.code !== 'string') throw new Error('OAuth request expired. Start sign-in again.');
      const data = await tokenRequest(provider, { code: req.query.code, code_verifier: pending.verifier, redirect_uri: `${process.env.APP_URL}/api/auth/${provider.type}/callback`, ...(provider.type === 'gitlab' ? { grant_type: 'authorization_code' } : {}) });
      const response = await fetch(provider.user, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${data.access_token}`, 'User-Agent': 'MyGitNotes' } });
      if (!response.ok) throw new Error('Account lookup failed.');
      const user = await response.json() as { login?: string; username?: string; id: number };
      const login = provider.type === 'gitlab' ? user.username : user.login;
      if (!Number.isSafeInteger(user.id) || !login) throw new Error('Account lookup returned an invalid identity.');
      const old = cookies(req)[cookieName]; if (old) await store.delete(old);
      const id = random(), ttl = provider.type === 'gitlab' ? lifetime : Math.min(lifetime, data.expires_in || lifetime);
      const session = { kind: 'session', realm: provider.realm, token: data.access_token, refreshToken: data.refresh_token, login, userId: user.id, upstreamExpiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined };
      const credential = await saveCredential(store, session, provider);
      await store.set(id, provider.type === 'gitlab' ? { kind: 'session', realm: provider.realm, login, userId: user.id, credential } : session, ttl);
      res.cookie(cookieName, id, { ...options(), maxAge: ttl * 1000 });
      res.redirect('/');
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.post('/agent-token', async (req, res) => {
    try {
      const provider = providerFor(base), session = await getSession(req, store, provider);
      if (!session) return res.status(401).json({ error: 'Sign in before creating an agent grant.' });
      const source = loadSourceConfig(base);
      if (source.type === 'local' || !process.env.APP_URL) return res.status(400).json({ error: 'A remote source and APP_URL are required.' });
      const token = random(), credential = await saveCredential(store, session, provider), ownerId = ownerOf(session, provider);
      const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
      await store.set(token, { kind: 'agent', ownerId, credential, name: name || 'MCP client', createdAt: Date.now(), source: sourceIdentity(source), audience: `${process.env.APP_URL}/mcp`, write: req.body.write === true }, null);
      try { await store.indexGrant(token, ownerId); } catch (error) { await store.delete(token); throw error; }
      res.json({ token, id: digest(token), endpoint: `${process.env.APP_URL}/mcp`, url: `${process.env.APP_URL}/mcp/${token}`, expiresIn: null, write: req.body.write === true });
    } catch { res.status(503).json({ error: 'Agent grant storage unavailable.' }); }
  });
  router.get('/agent-tokens', async (req, res) => {
    try {
      const provider = providerFor(base), session = await getSession(req, store, provider);
      if (!session) return res.status(401).json({ error: 'Sign in to manage agent access.' });
      res.json({ grants: await store.listGrants(ownerOf(session, provider)) });
    } catch { res.status(503).json({ error: 'Agent grant storage unavailable.' }); }
  });
  router.delete('/agent-tokens/:id', async (req, res) => {
    try {
      const provider = providerFor(base), session = await getSession(req, store, provider);
      if (!session) return res.status(401).json({ error: 'Sign in to manage agent access.' });
      if (!await store.revokeGrant(String(req.params.id), ownerOf(session, provider))) return res.status(404).json({ error: 'Agent grant not found.' });
      res.json({ success: true });
    } catch { res.status(503).json({ error: 'Agent grant storage unavailable.' }); }
  });
  router.post('/logout', async (req, res) => {
    try { const id = cookies(req)[cookieName]; if (id) await store.delete(id); res.clearCookie(cookieName, options()); res.json({ success: true }); }
    catch { res.status(503).json({ error: 'Session store unavailable.' }); }
  });
  return router;
}
