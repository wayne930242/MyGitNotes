import { type SourceConfig, SourceError, sourceIdentity, type WorkspaceConfigSource, WorkspaceSetupError } from '@mygitnotes/core';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { createHash } from 'node:crypto';
import type { BrowserSessions } from './browser-sessions.js';
import { choosesRepository, cookieWorkspaceChoices, type WorkspaceChoices } from './repository-choice.js';
import { digest, random, recordLifetime as lifetime, type RecordStore, sealedElsewhere, type StoredRecord } from './record-store/index.js';

export { seal, unseal } from './record-store/index.js';

/** The stores a request's sign-in lives in. */
export interface SessionServices {
  store: RecordStore;
  sessions: BrowserSessions;
}

export class CredentialRejected extends SourceError {
  constructor(public reason: string, message: string) {
    super(message, 401);
  }
}
type Provider = { type: 'github' | 'gitlab'; site: string; realm: string; clientId?: string; clientSecret?: string; authorize: string; token: string; user: string; };
/** The platform a sign-in goes to: the home repository's, or GitHub before a visitor has chosen a repository. */
type ProviderSite = { type: 'github' | 'local'; } | { type: 'gitlab'; url: string; };
/** The sign-in provider follows the home repository's platform and site. */
function providerFor(source: ProviderSite): Provider {
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
async function getSession(req: Request, sessions: BrowserSessions, provider: Provider) {
  const session = await sessions.read(req);
  if (session?.kind !== 'session' || !matchesProvider(session, provider)) return null;
  // A token past its expiry with no way to refresh it signs nobody in.
  return !session.credential && !session.refreshToken && session.upstreamExpiresAt && session.upstreamExpiresAt <= Date.now() ? null : session;
}
/** How long a cookie session may live: until its refresh token, or its token when it has none, expires, within the session lifetime. */
function cookieLifetime(session: StoredRecord) {
  const until = session.refreshExpiresAt ?? (session.refreshToken ? undefined : session.upstreamExpiresAt);
  return until ? Math.max(1, Math.min(lifetime, Math.floor((until - Date.now()) / 1000))) : lifetime;
}
const expiresAt = (seconds: number | undefined) => seconds ? Date.now() + seconds * 1000 : undefined;
async function tokenRequest(provider: Provider, body: Record<string, unknown>) {
  const response = await fetch(provider.token, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: provider.clientId, client_secret: provider.clientSecret, ...body }) });
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; };
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
/**
 * The provider token of the browser session that made the request, if one is signed in. A cookie session whose
 * token expires within `refreshWithinMs` is refreshed and written back, so the browser keeps the rotated refresh token.
 */
export async function authToken(req: Request, res: Response, { store, sessions }: SessionServices, home: ProviderSite, refreshWithinMs = 0): Promise<string | undefined> {
  const provider = providerFor(home);
  const session = await getSession(req, sessions, provider);
  if (!session) return undefined;
  if (session.credential) return credentialToken(store, session.credential, home as SourceConfig);
  if (sessions.kind === 'cookie' && session.refreshToken && session.upstreamExpiresAt && session.upstreamExpiresAt <= Date.now() + refreshWithinMs) {
    let data;
    try {
      data = await tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: session.refreshToken });
    } catch (error) {
      // GitHub refresh tokens are single use; one that failed cannot be retried, so the visitor signs in again.
      await sessions.clear(req, res);
      throw error instanceof SourceError ? new CredentialRejected('refresh-failed', 'Authorization expired. Sign in again.') : error;
    }
    const refreshed = { ...session, token: data.access_token, refreshToken: data.refresh_token ?? session.refreshToken, upstreamExpiresAt: expiresAt(data.expires_in), refreshExpiresAt: expiresAt(data.refresh_token_expires_in) ?? session.refreshExpiresAt };
    await sessions.write(req, res, refreshed, cookieLifetime(refreshed));
    return refreshed.token;
  }
  return session.token;
}
export interface AuthServices extends SessionServices {
  configSource: WorkspaceConfigSource;
  /** Where visitors' repository choices are kept; defaults to the sealed cookie. */
  choices?: WorkspaceChoices;
}
/** Sign-in and persistent agent grants, mounted at /api/auth. */
export function createAuth(services: AuthServices): Router {
  const router = Router();
  router.use(signInRouter(services));
  router.use(grantsRouter(services));
  return router;
}
const homeSourceOf = (configSource: WorkspaceConfigSource) => async (req: Request) => (await configSource.settings(req)).home.source;
/** The platform to sign in with: the home repository's, or GitHub while a visitor has not chosen a repository yet. */
const providerSiteOf = (configSource: WorkspaceConfigSource) => async (req: Request): Promise<ProviderSite> => {
  try {
    return (await configSource.settings(req)).home.source;
  } catch (error) {
    if (error instanceof WorkspaceSetupError && error.reason === 'choose-repository') return { type: 'github' };
    throw error;
  }
};
/** Refresh a cookie session's token this close to its expiry when the app asks for the session, ahead of its parallel reads. */
const sessionProbeRefreshMs = 10 * 60_000;
/** Provider sign-in, the session probe and logout. */
export function signInRouter(services: AuthServices): Router {
  const { store, sessions, configSource, choices = cookieWorkspaceChoices() } = services;
  const router = Router(), providerSite = providerSiteOf(configSource);
  router.get('/session', async (req, res) => {
    try {
      const site = await providerSite(req), provider = providerFor(site);
      let session = await getSession(req, sessions, provider);
      if (session) {
        try {
          await authToken(req, res, services, site, sessionProbeRefreshMs);
        } catch (error) {
          if (!(error instanceof CredentialRejected)) throw error;
          session = null;
        }
      }
      const serverStoreReady = sessions.kind === 'cookie' || store.ready !== false;
      // Where visitors choose their repository, the app shows the sign-in screen or the picker until they have one.
      const choice = choosesRepository() ? { repositoryChoice: true, workspace: await choices.read(req) } : {};
      res.json({ authenticated: Boolean(session), login: session?.login, provider: provider.type, loginUrl: `/api/auth/${provider.type}`, storage: sessions.kind, ...choice, configured: Boolean(provider.clientId && provider.clientSecret && process.env.SESSION_SECRET && serverStoreReady) });
    } catch {
      res.status(503).json({ error: 'Session store or source configuration unavailable.' });
    }
  });
  router.get('/:provider(github|gitlab)', async (req, res) => {
    try {
      const provider = providerFor(await providerSite(req));
      if (req.params.provider !== provider.type) return res.status(404).json({ error: 'This login provider is not configured.' });
      if (!provider.clientId || !provider.clientSecret || !process.env.APP_URL) throw new Error(`Configure ${provider.type.toUpperCase()}_CLIENT_ID, ${provider.type.toUpperCase()}_CLIENT_SECRET, APP_URL and SESSION_SECRET.`);
      if (sessions.kind === 'cookie' && provider.type !== 'github') throw new Error('The lightweight mode signs in with GitHub only. Configure Redis for GitLab sign-in.');
      const verifier = random(), state = await sessions.beginSignIn(res, { realm: provider.realm, verifier });
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
      const provider = providerFor(await providerSite(req));
      if (req.params.provider !== provider.type) throw new Error('This login provider is not configured.');
      // Installing or reconfiguring the GitHub App on github.com returns here without a state this site issued.
      // That code carries no CSRF or PKCE binding, so it is never redeemed; a fresh sign-in completes at once instead.
      if (provider.type === 'github' && !req.query.state && typeof req.query.setup_action === 'string') return res.redirect('/api/auth/github');
      const pending = await sessions.finishSignIn(req, res, String(req.query.state || ''));
      if (!pending) throw new Error('Invalid or expired OAuth state. Start sign-in again.');
      if (pending.realm !== provider.realm || typeof req.query.code !== 'string') throw new Error('OAuth request expired. Start sign-in again.');
      const data = await tokenRequest(provider, { code: req.query.code, code_verifier: pending.verifier, redirect_uri: `${process.env.APP_URL}/api/auth/${provider.type}/callback`, ...(provider.type === 'gitlab' ? { grant_type: 'authorization_code' } : {}) });
      const response = await fetch(provider.user, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${data.access_token}`, 'User-Agent': 'MyGitNotes' } });
      if (!response.ok) throw new Error('Account lookup failed.');
      const user = await response.json() as { login?: string; username?: string; id: number; };
      const login = provider.type === 'gitlab' ? user.username : user.login;
      if (!Number.isSafeInteger(user.id) || !login) throw new Error('Account lookup returned an invalid identity.');
      const session = { kind: 'session', realm: provider.realm, token: data.access_token, refreshToken: data.refresh_token, login, userId: user.id, upstreamExpiresAt: expiresAt(data.expires_in), refreshExpiresAt: expiresAt(data.refresh_token_expires_in) };
      if (sessions.kind === 'cookie') await sessions.write(req, res, session, cookieLifetime(session));
      else {
        const ttl = provider.type === 'gitlab' ? lifetime : Math.min(lifetime, data.expires_in || lifetime);
        const credential = await saveCredential(store, session, provider);
        await sessions.write(req, res, provider.type === 'gitlab' ? { kind: 'session', realm: provider.realm, login, userId: user.id, credential } : session, ttl);
      }
      res.redirect('/');
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  router.post('/logout', async (req, res) => {
    try {
      await choices.signedOut(req, res);
      await sessions.clear(req, res);
      res.json({ success: true });
    } catch {
      res.status(503).json({ error: 'Session store unavailable.' });
    }
  });
  return router;
}
/** Persistent agent (MCP) grants: create, list and revoke. A store that does not outlive the process offers none. */
export function grantsRouter({ store, sessions, configSource }: AuthServices): Router {
  const router = Router(), homeSource = homeSourceOf(configSource);
  router.use(['/agent-token', '/agent-tokens'], (_req, res, next) => store.durable ? next() : res.status(404).json({ error: 'This deployment does not keep agent grants.' }));
  router.post('/agent-token', async (req, res) => {
    try {
      const provider = providerFor(await homeSource(req)), session = await getSession(req, sessions, provider);
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
      const provider = providerFor(await homeSource(req)), session = await getSession(req, sessions, provider);
      if (!session) return res.status(401).json({ error: 'Sign in to manage agent access.' });
      res.json({ grants: await store.listGrants(ownerOf(session, provider)) });
    } catch {
      res.status(503).json({ error: 'Agent grant storage unavailable.' });
    }
  });
  router.delete('/agent-tokens/:id', async (req, res) => {
    try {
      const provider = providerFor(await homeSource(req)), session = await getSession(req, sessions, provider);
      if (!session) return res.status(401).json({ error: 'Sign in to manage agent access.' });
      if (!await store.revokeGrant(String(req.params.id), ownerOf(session, provider))) return res.status(404).json({ error: 'Agent grant not found.' });
      res.json({ success: true });
    } catch {
      res.status(503).json({ error: 'Agent grant storage unavailable.' });
    }
  });
  return router;
}
