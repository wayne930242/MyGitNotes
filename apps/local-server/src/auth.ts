import { type SourceConfig, SourceError, sourceIdentity, type WorkspaceConfigSource } from '@mygitnotes/core';
import { Request, Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { digest, random, recordLifetime as lifetime, type RecordStore, redisRestConnection, sealedElsewhere, type StoredRecord } from './record-store/index.js';

export { seal, unseal } from './record-store/index.js';

const cookieName = 'gh_notes_session';

export class CredentialRejected extends SourceError {
  constructor(public reason: string, message: string) {
    super(message, 401);
  }
}
type Provider = { type: 'github' | 'gitlab'; site: string; realm: string; clientId?: string; clientSecret?: string; authorize: string; token: string; user: string; };
/** The sign-in provider follows the home repository's platform and site. */
function providerFor(source: SourceConfig): Provider {
  const type = source.type === 'gitlab' ? 'gitlab' : 'github';
  const site = source.type === 'gitlab' ? source.url : 'https://github.com';
  const clientId = process.env[type === 'gitlab' ? 'GITLAB_CLIENT_ID' : 'GITHUB_CLIENT_ID'];
  const clientSecret = process.env[type === 'gitlab' ? 'GITLAB_CLIENT_SECRET' : 'GITHUB_CLIENT_SECRET'];
  return { type, site, clientId, clientSecret, realm: `${type}:${site}:${clientId || ''}`, authorize: `${site}${type === 'gitlab' ? '/oauth/authorize' : '/login/oauth/authorize'}`, token: `${site}${type === 'gitlab' ? '/oauth/token' : '/login/oauth/access_token'}`, user: type === 'gitlab' ? `${site}/api/v4/user` : 'https://api.github.com/user' };
}
function matchesProvider(record: any, provider: Provider) {
  return record?.realm === provider.realm || (!record?.realm && provider.type === 'github');
}
function ownerOf(session: any, provider: Provider): string | number {
  return provider.type === 'github' ? session.userId : `${digest(provider.realm)}:${session.userId}`;
}
function credentialId(userId: number, provider: Provider) {
  return createHash('sha256').update(provider.type === 'github' ? `github-credential:${provider.clientId}:${userId}` : `${provider.realm}:credential:${userId}`).digest('base64url');
}
async function saveCredential(store: RecordStore, session: StoredRecord, provider: Provider) {
  if (session.credential) return session.credential as string;
  const id = credentialId(session.userId, provider);
  await store.withCredentialLock(id, () => store.set(id, { kind: 'credential', realm: provider.realm, token: session.token, refreshToken: session.refreshToken, upstreamExpiresAt: session.upstreamExpiresAt }, null));
  return id;
}
function cookies(req: Request): Record<string, string> {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(p => p.trim().split('=')).filter(p => p.length === 2));
}
function options() {
  return { httpOnly: true, secure: process.env.APP_URL?.startsWith('https://') || Boolean(process.env.VERCEL), sameSite: 'lax' as const, path: '/' };
}
async function getSession(req: Request, store: RecordStore, provider: Provider) {
  const id = cookies(req)[cookieName];
  const session = id ? await store.get(id) : null;
  return session?.kind === 'session' && matchesProvider(session, provider) ? session : null;
}
async function tokenRequest(provider: Provider, body: Record<string, unknown>) {
  const response = await fetch(provider.token, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: provider.clientId, client_secret: provider.clientSecret, ...body }) });
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; };
  if (!response.ok || typeof data.access_token !== 'string' || !data.access_token || provider.type === 'gitlab' && (typeof data.refresh_token !== 'string' || !data.refresh_token || !Number.isFinite(data.expires_in) || data.expires_in! <= 0)) {
    throw new SourceError('Authorization failed. Sign in again to reconnect.', 401);
  }
  return data;
}
/** The provider token behind a stored credential, refreshed under the credential lock when it is about to expire. */
export async function credentialToken(store: RecordStore, id: string, home: SourceConfig): Promise<string> {
  const provider = providerFor(home);
  // GitHub OAuth apps with short-lived tokens return a refresh token; long-lived GitHub tokens carry neither.
  const refreshable = (record: any) => (provider.type === 'gitlab' || Boolean(record?.refreshToken)) && record?.upstreamExpiresAt <= Date.now() + 60000;
  const reject = (reason: string, message: string) => {
    console.warn(`[auth] credential rejected: ${reason}`);
    return new CredentialRejected(reason, message);
  };
  const resolve = async (record: any) => {
    const invalid = record === sealedElsewhere ? 'sealed-elsewhere' : !record ? 'missing' : !['credential', 'session'].includes(record.kind) ? 'kind' : !matchesProvider(record, provider) ? 'realm' : typeof record.token !== 'string' ? 'token' : '';
    if (invalid) throw reject(invalid, 'Agent authorization unavailable. Sign in again.');
    if (refreshable(record)) {
      if (!record.refreshToken) throw reject('expired', 'GitLab authorization expired. Sign in again.');
      const data = await tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: record.refreshToken, ...(provider.type === 'gitlab' ? { redirect_uri: `${process.env.APP_URL}/api/auth/gitlab/callback` } : {}) }).catch(error => {
        console.warn('[auth] credential rejected: refresh-failed');
        throw error instanceof SourceError ? new CredentialRejected('refresh-failed', error.message) : error;
      });
      record = { ...record, token: data.access_token, refreshToken: data.refresh_token, upstreamExpiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined };
      await store.set(id, record, null);
    }
    if (record.upstreamExpiresAt && record.upstreamExpiresAt <= Date.now()) throw reject('expired', 'Authorization expired. Sign in again to reconnect existing agent grants.');
    return record.token as string;
  };
  const record = await store.readRecord(id);
  if (provider.type === 'gitlab' || refreshable(record)) return store.withCredentialLock(id, async () => resolve(await store.readRecord(id)));
  return resolve(record);
}
/** The provider token of the browser session that made the request, if one is signed in. */
export async function authToken(req: Request, store: RecordStore, home: SourceConfig): Promise<string | undefined> {
  const provider = providerFor(home);
  const session = await getSession(req, store, provider);
  if (!session) return undefined;
  return session.credential ? credentialToken(store, session.credential, home) : session.token;
}
export interface AuthServices {
  store: RecordStore;
  configSource: WorkspaceConfigSource;
}
/** Sign-in and persistent agent grants, mounted at /api/auth. */
export function createAuth(services: AuthServices): Router {
  const router = Router();
  router.use(signInRouter(services));
  router.use(grantsRouter(services));
  return router;
}
const homeSourceOf = (configSource: WorkspaceConfigSource) => async (req: Request) => (await configSource.settings(req)).home.source;
/** Provider sign-in, the session probe and logout. */
export function signInRouter({ store, configSource }: AuthServices): Router {
  const router = Router(), homeSource = homeSourceOf(configSource);
  router.get('/session', async (req, res) => {
    try {
      const provider = providerFor(await homeSource(req)), session = await getSession(req, store, provider);
      res.json({ authenticated: Boolean(session), login: session?.login, provider: provider.type, loginUrl: `/api/auth/${provider.type}`, configured: Boolean(provider.clientId && provider.clientSecret && process.env.SESSION_SECRET && (!process.env.VERCEL || (redisRestConnection().url && redisRestConnection().token))) });
    } catch {
      res.status(503).json({ error: 'Session store or source configuration unavailable.' });
    }
  });
  router.get('/:provider(github|gitlab)', async (req, res) => {
    try {
      const provider = providerFor(await homeSource(req));
      if (req.params.provider !== provider.type) return res.status(404).json({ error: 'This login provider is not configured.' });
      if (!provider.clientId || !provider.clientSecret || !process.env.APP_URL) throw new Error(`Configure ${provider.type.toUpperCase()}_CLIENT_ID, ${provider.type.toUpperCase()}_CLIENT_SECRET, APP_URL and SESSION_SECRET.`);
      const state = random(), verifier = random();
      await store.set(state, { kind: 'oauth', realm: provider.realm, verifier }, 600);
      res.cookie('gh_notes_oauth', state, { ...options(), maxAge: 600000 });
      const params = new URLSearchParams({ client_id: provider.clientId, redirect_uri: `${process.env.APP_URL}/api/auth/${provider.type}/callback`, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      if (provider.type === 'gitlab') {
        params.set('response_type', 'code');
        params.set('scope', 'api');
      } else if (process.env.GITHUB_APP_TYPE !== 'github-app') params.set('scope', 'repo workflow gist');
      res.redirect(`${provider.authorize}?${params}`);
    } catch (error) {
      res.status(503).json({ error: (error as Error).message });
    }
  });
  router.get('/:provider(github|gitlab)/callback', async (req, res) => {
    try {
      const provider = providerFor(await homeSource(req));
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
      const user = await response.json() as { login?: string; username?: string; id: number; };
      const login = provider.type === 'gitlab' ? user.username : user.login;
      if (!Number.isSafeInteger(user.id) || !login) throw new Error('Account lookup returned an invalid identity.');
      const old = cookies(req)[cookieName];
      if (old) await store.delete(old);
      const id = random(), ttl = provider.type === 'gitlab' ? lifetime : Math.min(lifetime, data.expires_in || lifetime);
      const session = { kind: 'session', realm: provider.realm, token: data.access_token, refreshToken: data.refresh_token, login, userId: user.id, upstreamExpiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined };
      const credential = await saveCredential(store, session, provider);
      await store.set(id, provider.type === 'gitlab' ? { kind: 'session', realm: provider.realm, login, userId: user.id, credential } : session, ttl);
      res.cookie(cookieName, id, { ...options(), maxAge: ttl * 1000 });
      res.redirect('/');
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  router.post('/logout', async (req, res) => {
    try {
      const id = cookies(req)[cookieName];
      if (id) await store.delete(id);
      res.clearCookie(cookieName, options());
      res.json({ success: true });
    } catch {
      res.status(503).json({ error: 'Session store unavailable.' });
    }
  });
  return router;
}
/** Persistent agent (MCP) grants: create, list and revoke. A store that does not outlive the process offers none. */
export function grantsRouter({ store, configSource }: AuthServices): Router {
  const router = Router(), homeSource = homeSourceOf(configSource);
  router.use(['/agent-token', '/agent-tokens'], (_req, res, next) => store.durable ? next() : res.status(404).json({ error: 'This deployment does not keep agent grants.' }));
  router.post('/agent-token', async (req, res) => {
    try {
      const provider = providerFor(await homeSource(req)), session = await getSession(req, store, provider);
      if (!session) return res.status(401).json({ error: 'Sign in before creating an agent grant.' });
      const source = await homeSource(req);
      if (source.type === 'local' || !process.env.APP_URL) return res.status(400).json({ error: 'A remote source and APP_URL are required.' });
      const token = random(), credential = await saveCredential(store, session, provider), ownerId = ownerOf(session, provider);
      const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
      await store.set(token, { kind: 'agent', ownerId, credential, name: name || 'MCP client', createdAt: Date.now(), source: sourceIdentity(source), audience: `${process.env.APP_URL}/mcp`, write: req.body.write === true }, null);
      try {
        await store.indexGrant(token, ownerId);
      } catch (error) {
        await store.delete(token);
        throw error;
      }
      res.json({ token, id: digest(token), endpoint: `${process.env.APP_URL}/mcp`, url: `${process.env.APP_URL}/mcp/${token}`, expiresIn: null, write: req.body.write === true });
    } catch {
      res.status(503).json({ error: 'Agent grant storage unavailable.' });
    }
  });
  router.get('/agent-tokens', async (req, res) => {
    try {
      const provider = providerFor(await homeSource(req)), session = await getSession(req, store, provider);
      if (!session) return res.status(401).json({ error: 'Sign in to manage agent access.' });
      res.json({ grants: await store.listGrants(ownerOf(session, provider)) });
    } catch {
      res.status(503).json({ error: 'Agent grant storage unavailable.' });
    }
  });
  router.delete('/agent-tokens/:id', async (req, res) => {
    try {
      const provider = providerFor(await homeSource(req)), session = await getSession(req, store, provider);
      if (!session) return res.status(401).json({ error: 'Sign in to manage agent access.' });
      if (!await store.revokeGrant(String(req.params.id), ownerOf(session, provider))) return res.status(404).json({ error: 'Agent grant not found.' });
      res.json({ success: true });
    } catch {
      res.status(503).json({ error: 'Agent grant storage unavailable.' });
    }
  });
  return router;
}
