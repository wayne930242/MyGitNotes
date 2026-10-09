import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { storageMode } from '../src/record-store/index.js';

let root: string, server: Server, base: string, refreshes: number, tokenExpiresIn: number, usedRefreshTokens: Set<string>;
const nativeFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const cookieOf = (response: Response, name: string) => response.headers.getSetCookie().find(line => line.startsWith(`${name}=`));
const repository = (name: string, updated: string, push = true) => ({ full_name: name, default_branch: 'main', private: true, updated_at: updated, permissions: { push } });

/** Signs in through GitHub and returns the session cookie the browser would keep. */
async function signIn() {
  const start = await fetch(`${base}/api/auth/github`, { redirect: 'manual' });
  expect(start.status).toBe(302);
  const target = new URL(start.headers.get('location')!);
  expect(target.searchParams.has('scope')).toBe(false);
  const pending = cookieOf(start, 'gh_notes_oauth')!.split(';')[0];
  const callback = await fetch(`${base}/api/auth/github/callback?state=${target.searchParams.get('state')}&code=fixture`, { redirect: 'manual', headers: { Cookie: pending } });
  expect(callback.status).toBe(302);
  const session = cookieOf(callback, 'gh_notes_session')!;
  expect(session).toContain('HttpOnly');
  expect(session).not.toContain('user-token');
  return session.split(';')[0];
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-lightweight-'));
  refreshes = 0;
  usedRefreshTokens = new Set();
  tokenExpiresIn = 28800;
  for (const [key, value] of Object.entries({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: '', MYGITNOTES_BRANCH: '', GITHUB_CLIENT_ID: 'app-client', GITHUB_CLIENT_SECRET: 'app-secret', GITHUB_APP_TYPE: 'github-app', GITHUB_APP_SLUG: 'my-notes', SESSION_SECRET: 's'.repeat(64), VERCEL: '1', REDIS_URL: '', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', MYGITNOTES_STORAGE: '', APP_URL: '' })) vi.stubEnv(key, value);
  server = createServer(createApp(root, { remoteCache: undefined }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
  vi.stubEnv('APP_URL', base);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith(base)) return nativeFetch(input, init);
    if (url === 'https://github.com/login/oauth/access_token') {
      const body = JSON.parse(String(init?.body));
      if (body.grant_type === 'refresh_token') {
        refreshes++;
        // GitHub refresh tokens are single use.
        if (body.refresh_token !== 'refresh-1' || usedRefreshTokens.has(body.refresh_token)) return json({ error: 'bad_refresh_token' }, 400);
        usedRefreshTokens.add(body.refresh_token);
        return json({ access_token: 'user-token-2', refresh_token: 'refresh-2', expires_in: 28800, refresh_token_expires_in: 15811200 });
      }
      return json({ access_token: 'user-token', refresh_token: 'refresh-1', expires_in: tokenExpiresIn, refresh_token_expires_in: 15811200 });
    }
    const auth = new Headers(init?.headers).get('authorization');
    if (url === 'https://api.github.com/user') return json({ id: 7, login: 'visitor' });
    expect(auth).toMatch(/^Bearer user-token/);
    if (url.startsWith('https://api.github.com/user/installations?')) return json({ installations: [{ id: 1 }, { id: 2 }] });
    if (url.startsWith('https://api.github.com/user/installations/1/repositories?')) return json({ repositories: [repository('visitor/notes', '2026-10-01T00:00:00Z'), repository('visitor/read-only', '2026-10-05T00:00:00Z', false)] });
    if (url.startsWith('https://api.github.com/user/installations/2/repositories?')) return json({ repositories: [repository('team/handbook', '2026-10-03T00:00:00Z'), repository('visitor/notes', '2026-10-01T00:00:00Z')] });
    if (url === 'https://api.github.com/repos/visitor/notes') return json(repository('visitor/notes', '2026-10-01T00:00:00Z'));
    if (url === 'https://api.github.com/repos/visitor/notes/branches/drafts') return json({ name: 'drafts' });
    if (url.startsWith('https://api.github.com/repos/')) return json({ message: 'Not Found' }, 404);
    throw new Error(`Unexpected outbound request ${url}`);
  });
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the storage mode', () => {
  it('is the lightweight cookie mode on Vercel without Redis or when asked for, and otherwise as before', () => {
    expect(storageMode({ VERCEL: '1' })).toBe('cookie');
    expect(storageMode({ MYGITNOTES_STORAGE: 'cookie', REDIS_URL: 'redis://x' })).toBe('cookie');
    expect(storageMode({ VERCEL: '1', UPSTASH_REDIS_REST_URL: 'https://r' })).toBe('redis');
    expect(storageMode({ REDIS_URL: 'redis://x' })).toBe('redis');
    expect(storageMode({})).toBe('directory');
  });
});

describe('a lightweight deployment that lets each visitor choose a repository', () => {
  it('signs in with GitHub before any repository is chosen and keeps the session only in the cookie', async () => {
    expect(await fetch(`${base}/api/auth/session`).then(response => response.json())).toMatchObject({ authenticated: false, provider: 'github', storage: 'cookie', configured: true, repositoryChoice: true, workspace: null });
    const session = await signIn();
    expect(await fetch(`${base}/api/auth/session`, { headers: { Cookie: session } }).then(response => response.json())).toMatchObject({ authenticated: true, login: 'visitor' });
    expect(fs.existsSync(path.join(root, '.github-notes-sessions'))).toBe(false);
    const tampered = session.slice(0, -4) + 'AAAA';
    expect(await fetch(`${base}/api/auth/session`, { headers: { Cookie: tampered } }).then(response => response.json())).toMatchObject({ authenticated: false });
  });

  it('refuses a callback whose state does not match the sealed sign-in cookie', async () => {
    const start = await fetch(`${base}/api/auth/github`, { redirect: 'manual' });
    const pending = cookieOf(start, 'gh_notes_oauth')!.split(';')[0];
    expect((await fetch(`${base}/api/auth/github/callback?state=${'x'.repeat(43)}&code=fixture`, { redirect: 'manual', headers: { Cookie: pending } })).status).toBe(400);
    expect((await fetch(`${base}/api/auth/github/callback?state=${new URL(start.headers.get('location')!).searchParams.get('state')}&code=fixture`, { redirect: 'manual' })).status).toBe(400);
  });

  it('restarts sign-in, without redeeming the code, when GitHub returns from installing the app', async () => {
    const back = await fetch(`${base}/api/auth/github/callback?code=fixture&installation_id=5&setup_action=install`, { redirect: 'manual' });
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('/api/auth/github');
    expect(cookieOf(back, 'gh_notes_session')).toBeUndefined();
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url) === 'https://github.com/login/oauth/access_token')).toBe(false);
    expect((await fetch(`${base}/api/auth/github/callback?code=fixture`, { redirect: 'manual' })).status).toBe(400);
  });

  it('asks to choose a repository, lists the granted ones the visitor can write, and opens the chosen one', async () => {
    const session = await signIn();
    // Before a choice the workspace has no repository; the session tells the page to offer the choice.
    const setup = await fetch(`${base}/api/workspace`, { headers: { Cookie: session } });
    expect(setup.status).toBe(200);
    expect(await setup.json()).toMatchObject({ defaultRepository: null, repositories: [], repositoryChoice: true });
    expect((await fetch(`${base}/api/repositories/available`)).status).toBe(401);
    const listed = await fetch(`${base}/api/repositories/available`, { headers: { Cookie: session } }).then(response => response.json());
    expect(listed.repositories.map((entry: { fullName: string; }) => entry.fullName)).toEqual(['team/handbook', 'visitor/notes']);
    expect(listed.installUrl).toBe('https://github.com/apps/my-notes/installations/new');
    // A visitor without a notes repository creates one on GitHub from the starter template.
    const create = new URL(listed.newRepositoryUrl);
    expect(create.origin + create.pathname).toBe('https://github.com/new');
    expect(Object.fromEntries(create.searchParams)).toMatchObject({ template_owner: 'wayne930242', template_name: 'mygitnotes-starter', visibility: 'private' });
    expect(await fetch(`${base}/api/repositories/available?query=HAND`, { headers: { Cookie: session } }).then(response => response.json())).toMatchObject({ total: 1 });
    const choose = (body: unknown) => fetch(`${base}/api/workspace/choice`, { method: 'POST', headers: { Cookie: session, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await choose({ repository: 'visitor/missing' })).status).toBe(404);
    expect((await choose({ repository: 'visitor/notes', branch: 'nope' })).status).toBe(404);
    expect((await choose({ repository: '../etc' })).status).toBe(400);
    const chosen = await choose({ repository: 'visitor/notes', branch: 'drafts' });
    expect(await chosen.json()).toEqual({ choice: { repository: 'visitor/notes', branch: 'drafts' } });
    const choice = cookieOf(chosen, 'mygitnotes_workspace')!;
    expect(choice).toContain('HttpOnly');
    expect(choice).not.toContain('visitor');
    expect(await fetch(`${base}/api/auth/session`, { headers: { Cookie: `${session}; ${choice.split(';')[0]}` } }).then(response => response.json())).toMatchObject({ workspace: { repository: 'visitor/notes', branch: 'drafts' } });
    const defaulted = await choose({ repository: 'visitor/notes' });
    expect(await defaulted.json()).toEqual({ choice: { repository: 'visitor/notes', branch: 'main' } });
  });

  it('refreshes a token about to expire when the app asks for the session, writing the rotated token back', async () => {
    tokenExpiresIn = 60;
    const session = await signIn();
    const probe = await fetch(`${base}/api/auth/session`, { headers: { Cookie: session } });
    expect(await probe.json()).toMatchObject({ authenticated: true });
    expect(refreshes).toBe(1);
    const rotated = cookieOf(probe, 'gh_notes_session')!.split(';')[0];
    expect(rotated).not.toBe(session);
    await fetch(`${base}/api/auth/session`, { headers: { Cookie: rotated } });
    expect(refreshes).toBe(1);
    // The old cookie's refresh token was already used: GitHub refuses it and the visitor signs in again.
    const stale = await fetch(`${base}/api/auth/session`, { headers: { Cookie: session } });
    expect(await stale.json()).toMatchObject({ authenticated: false });
    expect(cookieOf(stale, 'gh_notes_session')).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('forgets the chosen repository on sign-out and offers no agent grants', async () => {
    const session = await signIn();
    const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: session } });
    expect(cookieOf(logout, 'gh_notes_session')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cookieOf(logout, 'mygitnotes_workspace')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await fetch(`${base}/api/auth/agent-tokens`, { headers: { Cookie: session } })).status).toBe(404);
  });
});

describe('a deployment with a configured repository', () => {
  it('does not offer repository choice', async () => {
    vi.stubEnv('MYGITNOTES_REPOSITORY', 'owner/fixed');
    vi.stubEnv('MYGITNOTES_BRANCH', 'main');
    expect((await fetch(`${base}/api/repositories/available`)).status).toBe(404);
    expect((await fetch(`${base}/api/workspace/choice`, { method: 'DELETE' })).status).toBe(404);
  });
});
