import { loadSourceConfig, sourceIdentity } from '@github-notes/core';
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

/** Encrypted records remain server-side; production requires a durable Redis REST store. */
export class SessionStore {
  constructor(private base: string) {}
  private get redis() { return Boolean(process.env.VERCEL || process.env.UPSTASH_REDIS_REST_URL); }
  async command(command: string[]): Promise<any> {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
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
      await this.command(['SET', `gh-notes:${digest(id)}`, record, ...(ttl === null ? [] : ['EX', String(ttl)])]);
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
    if (this.redis) raw = await this.command(['GET', `gh-notes:${hash}`]);
    else {
      try { raw = await fs.readFile(path.join(this.base, '.github-notes-sessions', hash), 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    }
    if (!raw) return null;
    const record = unseal(raw);
    if (record.expires !== null && record.expires <= Date.now()) { await this.deleteByDigest(hash); return null; }
    return record.value;
  }
  async delete(id: string) {
    if (/^[A-Za-z0-9_-]{43}$/.test(id)) await this.deleteByDigest(digest(id));
  }
  async deleteByDigest(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) return;
    if (this.redis) await this.command(['DEL', `gh-notes:${hash}`]);
    else await fs.rm(path.join(this.base, '.github-notes-sessions', hash), { force: true });
  }
  async indexGrant(token: string, ownerId: number) {
    if (this.redis) await this.command(['SADD', `gh-notes:grants:${ownerId}`, digest(token)]);
  }
  async listGrants(ownerId: number) {
    let hashes: string[];
    if (this.redis) hashes = await this.command(['SMEMBERS', `gh-notes:grants:${ownerId}`]);
    else {
      try { hashes = await fs.readdir(path.join(this.base, '.github-notes-sessions')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    }
    const results = [];
    for (const id of hashes) {
      const grant = await this.getByDigest(id);
      if (grant?.kind === 'agent' && grant.ownerId === ownerId) results.push({ id, name: grant.name, write: grant.write, source: grant.source, createdAt: grant.createdAt, expiresAt: null });
      else if (!grant && this.redis) await this.command(['SREM', `gh-notes:grants:${ownerId}`, id]);
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }
  async revokeGrant(id: string, ownerId: number) {
    const grant = await this.getByDigest(id);
    if (grant?.kind !== 'agent' || grant.ownerId !== ownerId) return false;
    await this.deleteByDigest(id);
    if (this.redis) await this.command(['SREM', `gh-notes:grants:${ownerId}`, id]);
    return true;
  }
}
function credentialId(userId: number) {
  return createHash('sha256').update(`github-credential:${process.env.GITHUB_CLIENT_ID}:${userId}`).digest('base64url');
}
async function saveCredential(store: SessionStore, session: { userId: number; token: string; upstreamExpiresAt?: number }) {
  const id = credentialId(session.userId);
  await store.set(id, { kind: 'credential', token: session.token, upstreamExpiresAt: session.upstreamExpiresAt }, null);
  return id;
}
function cookies(req: Request): Record<string, string> {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(p => p.trim().split('=')).filter(p => p.length === 2));
}
function options() { return { httpOnly: true, secure: process.env.APP_URL?.startsWith('https://') || Boolean(process.env.VERCEL), sameSite: 'lax' as const, path: '/' }; }
export async function authToken(req: Request, base: string): Promise<string | undefined> {
  const sessionId = cookies(req)[cookieName];
  const session = sessionId ? await new SessionStore(base).get(sessionId) : null;
  return session?.kind === 'session' ? session.token : undefined;
}
export function createAuth(base: string): Router {
  const router = Router();
  const store = new SessionStore(base);
  router.get('/session', async (req, res) => {
    try { const id = cookies(req)[cookieName]; const session = id ? await store.get(id) : null;
      res.json({ authenticated: session?.kind === 'session', login: session?.kind === 'session' ? session.login : undefined,
        configured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && process.env.SESSION_SECRET && (!process.env.VERCEL || (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN))) });
    } catch { res.status(503).json({ error: 'Session store unavailable.' }); }
  });
  router.get('/github', async (req, res) => {
    try {
      if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET || !process.env.APP_URL) throw new Error('Configure GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, APP_URL and SESSION_SECRET.');
      const state = random(); const verifier = random();
      await store.set(state, { kind: 'oauth', verifier }, 600);
      res.cookie('gh_notes_oauth', state, { ...options(), maxAge: 600000 });
      const params = new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID,
        redirect_uri: `${process.env.APP_URL}/api/auth/github/callback`, state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      // GitHub Apps use configured repository permissions; OAuth Apps require the repo scope.
      if (process.env.GITHUB_APP_TYPE !== 'github-app') params.set('scope', 'repo');
      res.redirect(`https://github.com/login/oauth/authorize?${params}`);
    } catch (error) { res.status(503).json({ error: (error as Error).message }); }
  });
  router.get('/github/callback', async (req, res) => {
    try {
      const state = String(req.query.state || '');
      const browserState = cookies(req).gh_notes_oauth || '';
      if (state.length !== 43 || state.length !== browserState.length || !timingSafeEqual(Buffer.from(state), Buffer.from(browserState))) throw new Error('Invalid OAuth state. Start sign-in again.');
      const pending = await store.get(state);
      await store.delete(state);
      res.clearCookie('gh_notes_oauth', options());
      if (pending?.kind !== 'oauth' || typeof req.query.code !== 'string') throw new Error('OAuth request expired. Start sign-in again.');
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET,
          code: req.query.code, code_verifier: pending.verifier, redirect_uri: `${process.env.APP_URL}/api/auth/github/callback` }),
      });
      const data = await response.json() as { access_token?: string; expires_in?: number };
      if (!response.ok || !data.access_token) throw new Error('GitHub authorization failed. Start sign-in again.');
      const userResponse = await fetch('https://api.github.com/user', { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${data.access_token}`, 'User-Agent': 'GitHub-Notes' } });
      if (!userResponse.ok) throw new Error('GitHub user lookup failed.');
      const user = await userResponse.json() as { login: string; id: number };
      const old = cookies(req)[cookieName]; if (old) await store.delete(old);
      const id = random(); const ttl = Math.min(lifetime, data.expires_in || lifetime);
      const session = { kind: 'session', token: data.access_token, login: user.login, userId: user.id, upstreamExpiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined };
      await store.set(id, session, ttl);
      await saveCredential(store, session);
      res.cookie(cookieName, id, { ...options(), maxAge: ttl * 1000 });
      res.redirect('/');
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.post('/agent-token', async (req, res) => {
    try {
      const id = cookies(req)[cookieName];
      const session = id ? await store.get(id) : null;
      if (session?.kind !== 'session') return res.status(401).json({ error: 'Sign in before creating an agent grant.' });
      const source = loadSourceConfig(base);
      if (source.type !== 'github' || !process.env.APP_URL) return res.status(400).json({ error: 'A GitHub source and APP_URL are required.' });
      const token = random();
      const credential = await saveCredential(store, session);
      const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
      await store.set(token, { kind: 'agent', ownerId: session.userId, credential, name: name || 'MCP client', createdAt: Date.now(), source: sourceIdentity(source), audience: `${process.env.APP_URL}/mcp`, write: req.body.write === true }, null);
      try { await store.indexGrant(token, session.userId); }
      catch (error) { await store.delete(token); throw error; }
      res.json({ token, id: digest(token), endpoint: `${process.env.APP_URL}/mcp`, url: `${process.env.APP_URL}/mcp/${token}`, expiresIn: null, write: req.body.write === true });
    } catch { res.status(503).json({ error: 'Agent grant storage unavailable.' }); }
  });
  router.get('/agent-tokens', async (req, res) => {
    try {
      const id = cookies(req)[cookieName];
      const session = id ? await store.get(id) : null;
      if (session?.kind !== 'session') return res.status(401).json({ error: 'Sign in to manage agent access.' });
      res.json({ grants: await store.listGrants(session.userId) });
    } catch { res.status(503).json({ error: 'Agent grant storage unavailable.' }); }
  });
  router.delete('/agent-tokens/:id', async (req, res) => {
    try {
      const id = cookies(req)[cookieName];
      const session = id ? await store.get(id) : null;
      if (session?.kind !== 'session') return res.status(401).json({ error: 'Sign in to manage agent access.' });
      if (!await store.revokeGrant(String(req.params.id), session.userId)) return res.status(404).json({ error: 'Agent grant not found.' });
      res.json({ success: true });
    } catch { res.status(503).json({ error: 'Agent grant storage unavailable.' }); }
  });
  router.post('/logout', async (req, res) => {
    try { const id = cookies(req)[cookieName]; if (id) await store.delete(id); res.clearCookie(cookieName, options()); res.json({ success: true }); }
    catch { res.status(503).json({ error: 'Session store unavailable.' }); }
  });
  return router;
}
