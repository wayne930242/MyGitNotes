import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { unseal } from '../src/auth.js';
import { createRecordStore, digest } from '../src/record-store/index.js';
import { createHash } from 'node:crypto';
import { githubFixture } from '../../../packages/core/tests/fixtures/github.js';

/** A GitHub Enterprise Server behind `fetch`: sign-in, the account lookup, Gists and one repository, all under `site`. */
const site = 'https://ghe.example.test/ghe';
const nativeFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const cookieOf = (response: Response, name: string) => response.headers.getSetCookie().find(line => line.startsWith(`${name}=`));
const repository = (name: string, updated: string, push = true) => ({ full_name: name, default_branch: 'main', private: true, updated_at: updated, permissions: { push } });

let root: string, server: Server | undefined, base: string, fixture: ReturnType<typeof githubFixture>, outbound: { url: string; method: string; authorization: string | null; body?: unknown; }[];

/** Starts the app against `webRoot`, whose API lives at `apiRoot` (a site fixture for github.com when it is omitted). */
async function start(env: Record<string, string>, webRoot = site, apiRoot = `${site}/api/v3`) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-ghe-'));
  outbound = [];
  fixture = githubFixture();
  for (const [key, value] of Object.entries({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: '', MYGITNOTES_BRANCH: '', MYGITNOTES_GITHUB_URL: '', GITHUB_CLIENT_ID: 'ghe-client', GITHUB_CLIENT_SECRET: 'ghe-secret', GITHUB_APP_TYPE: '', GITHUB_APP_SLUG: '', MYGITNOTES_STARTER_TEMPLATE: '', SESSION_SECRET: 's'.repeat(64), VERCEL: '', REDIS_URL: '', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', MYGITNOTES_STORAGE: '', APP_URL: '', ...env })) vi.stubEnv(key, value);
  server = createServer(createApp(root, { remoteCache: undefined }));
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
  vi.stubEnv('APP_URL', base);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith(base)) return nativeFetch(input, init);
    const authorization = new Headers(init?.headers).get('authorization');
    outbound.push({ url, method: init?.method ?? 'GET', authorization, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === `${webRoot}/login/oauth/access_token`) {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ client_id: 'ghe-client', client_secret: 'ghe-secret', redirect_uri: `${base}/api/auth/github/callback` });
      expect(body.code_verifier).toHaveLength(43);
      return json({ access_token: 'ghe-user-token' });
    }
    if (url === `${apiRoot}/user`) return json({ id: 42, login: 'octo' });
    if (url === `${apiRoot}/gists` && init?.method === 'POST') return json({ id: 'abc123', html_url: `${webRoot}/gist/octo/abc123` });
    if (url.startsWith(`${apiRoot}/gists/abc123`)) return json({ files: { 'a.md': {} } });
    expect(authorization).toBe('Bearer ghe-user-token');
    if (url === `${apiRoot}/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=1`) return json([repository('team/handbook', '2026-10-03T00:00:00Z'), repository('team/read-only', '2026-10-05T00:00:00Z', false)]);
    if (url === `${apiRoot}/repos/team/handbook`) return json(repository('team/handbook', '2026-10-03T00:00:00Z'));
    if (url.startsWith(`${apiRoot}/repos/team/handbook/`)) return fixture.request(url.replace(`${apiRoot}/repos/team/handbook`, 'https://api.github.com/repos/owner/repo'), init);
    if (url.startsWith(`${apiRoot}/repos/team/`)) return json({ message: 'Not Found' }, 404);
    if (url === `${apiRoot}/graphql`) return fixture.request('https://api.github.com/graphql', init);
    if (url.startsWith(`${apiRoot}/repos/owner/repo`)) return fixture.request(url.replace(apiRoot, 'https://api.github.com'), init);
    throw new Error(`Unexpected outbound request ${url}`);
  });
}
/** Signs in and returns the session cookie the browser would keep. */
async function signIn(webRoot = site) {
  const start = await fetch(`${base}/api/auth/github`, { redirect: 'manual' });
  expect(start.status).toBe(302);
  const target = new URL(start.headers.get('location')!);
  expect(target.origin + target.pathname).toBe(`${webRoot}/login/oauth/authorize`);
  expect(target.searchParams.get('client_id')).toBe('ghe-client');
  const pending = cookieOf(start, 'gh_notes_oauth')!.split(';')[0];
  const callback = await fetch(`${base}/api/auth/github/callback?state=${target.searchParams.get('state')}&code=fixture`, { redirect: 'manual', headers: { Cookie: pending } });
  expect(callback.status).toBe(302);
  const session = cookieOf(callback, 'gh_notes_session')!;
  expect(session).toContain('HttpOnly');
  expect(session).not.toContain('ghe-user-token');
  return session.split(';')[0];
}
/** The realm a lightweight session cookie records, which names the provider site and OAuth app. */
const sessionRealm = (cookie: string) => unseal(decodeURIComponent(cookie.split('=')[1])).value.realm as string;
const post = (cookie: string, body: unknown, method = 'POST') => ({ method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  if (root) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a deployment whose repository is on GitHub Enterprise Server', () => {
  const configured = { MYGITNOTES_REPOSITORY: 'owner/repo', MYGITNOTES_BRANCH: 'main', MYGITNOTES_GITHUB_URL: site };

  it('signs in on the site, scopes the sign-in to it, and refuses it when the deployment moves to another site', async () => {
    await start(configured);
    expect(await fetch(`${base}/api/auth/session`).then(r => r.json())).toMatchObject({ provider: 'github', loginUrl: '/api/auth/github', authenticated: false, configured: true });
    const cookie = await signIn();
    expect(await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } }).then(r => r.json())).toMatchObject({ authenticated: true, login: 'octo' });
    expect(outbound.map(call => call.url)).toEqual([`${site}/login/oauth/access_token`, `${site}/api/v3/user`]);
    vi.stubEnv('MYGITNOTES_GITHUB_URL', 'https://other.example.test');
    expect(await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } }).then(r => r.json())).toMatchObject({ authenticated: false });
    vi.stubEnv('MYGITNOTES_GITHUB_URL', '');
    expect(await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } }).then(r => r.json())).toMatchObject({ authenticated: false });
  });

  it('reads the workspace and commits a note through the site API only', async () => {
    await start(configured);
    const cookie = await signIn();
    const workspace = await fetch(`${base}/api/workspace`, { headers: { Cookie: cookie } }).then(r => r.json());
    expect(workspace).toMatchObject({ local: false, home: `github:${site}/owner/repo@main`, repositories: [{ id: `github:${site}/owner/repo@main`, type: 'github', branch: 'main', write: true, notebooks: ['ex'] }] });
    const notes = await fetch(`${base}/api/notes`, { headers: { Cookie: cookie } }).then(r => r.json());
    const note = notes.notes.find((entry: { title: string; }) => entry.title === 'Alpha');
    const before = fixture.head();
    const edit = post(cookie, { repository: workspace.home, notes: [{ ...note, content: '# Updated' }], revision: before, message: 'docs: edit note' });
    const saved = await fetch(`${base}/api/notes/commit`, edit);
    expect(saved.status).toBe(200);
    expect(fixture.head()).not.toBe(before);
    expect(fixture.text('notes/ex/a.md')).toContain('# Updated');
    const sent = outbound.filter(call => call.url.includes('/repos/') || call.url.endsWith('/graphql'));
    expect(sent.length).toBeGreaterThan(0);
    expect(outbound.every(call => call.url.startsWith(`${site}/`))).toBe(true);
    expect(sent.every(call => call.authorization === 'Bearer ghe-user-token')).toBe(true);
    expect(sent.some(call => call.method === 'PATCH' || call.method === 'POST')).toBe(true);
  });

  it('publishes and updates a Gist on the site and returns the address it gave', async () => {
    await start(configured);
    const cookie = await signIn();
    const publish = post(cookie, { path: 'notes/ex/a.md', content: '# Alpha', metadata: { title: 'Alpha' } });
    const created = await fetch(`${base}/api/gists`, publish);
    expect(await created.json()).toEqual({ id: 'abc123', url: `${site}/gist/octo/abc123` });
    expect(outbound.find(call => call.method === 'POST' && call.url.endsWith('/gists'))).toMatchObject({ url: `${site}/api/v3/gists`, authorization: 'Bearer ghe-user-token' });
    const workspace = await fetch(`${base}/api/workspace`, { headers: { Cookie: cookie } }).then(r => r.json());
    const note = (await fetch(`${base}/api/notes`, { headers: { Cookie: cookie } }).then(r => r.json())).notes.find((entry: { title: string; }) => entry.title === 'Alpha');
    const edit = post(cookie, { repository: workspace.home, notes: [{ ...note, content: '# Alpha again', metadata: { ...note.metadata, gist: 'abc123' } }], revision: fixture.head(), message: 'docs: edit note' });
    const saved = await fetch(`${base}/api/notes/commit`, edit).then(r => r.json());
    expect(saved.gists).toEqual([{ path: note.path, gist: 'abc123' }]);
    expect(outbound.filter(call => call.url.includes('/gists/abc123')).map(call => [call.method, call.url])).toEqual([['GET', `${site}/api/v3/gists/abc123`], ['PATCH', `${site}/api/v3/gists/abc123`]]);
    expect((await fetch(`${base}/api/gists/abc123`, post(cookie, {}, 'DELETE'))).status).toBe(200);
    expect(outbound.at(-1)).toMatchObject({ method: 'DELETE', url: `${site}/api/v3/gists/abc123` });
    expect(outbound.every(call => call.url.startsWith(`${site}/`))).toBe(true);
  });

  it('keeps Core updates off the site: the token never goes to github.com', async () => {
    await start(configured);
    const cookie = await signIn();
    const before = outbound.length;
    expect(await fetch(`${base}/api/core/status`, { headers: { Cookie: cookie } }).then(r => r.json())).toMatchObject({ status: { state: 'unsupported', canUpdate: false } });
    const update = await fetch(`${base}/api/core/update`, post(cookie, {}));
    expect(update.status).toBe(422);
    expect(await update.json()).toMatchObject({ code: 'UNSUPPORTED_PROVIDER' });
    expect((await fetch(`${base}/api/core/install`, post(cookie, {}))).status).toBe(422);
    expect(outbound.length).toBe(before);
  });
});

describe('the sign-in realm', () => {
  it("stays github.com's own for a deployment that names no site, and names the site otherwise", async () => {
    await start({ MYGITNOTES_REPOSITORY: 'owner/repo', MYGITNOTES_BRANCH: 'main', MYGITNOTES_STORAGE: 'cookie' }, 'https://github.com', 'https://api.github.com');
    const github = await signIn('https://github.com');
    expect(sessionRealm(github)).toBe('github:https://github.com:ghe-client');
    expect(outbound.map(call => call.url)).toEqual(['https://github.com/login/oauth/access_token', 'https://api.github.com/user']);
    await new Promise<void>(resolve => server!.close(() => resolve()));
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await start({ MYGITNOTES_REPOSITORY: 'owner/repo', MYGITNOTES_BRANCH: 'main', MYGITNOTES_GITHUB_URL: site, MYGITNOTES_STORAGE: 'cookie' });
    const enterprise = await signIn();
    expect(sessionRealm(enterprise)).toBe(`github:${site}:ghe-client`);
  });
});

describe('credentials and agent grants', () => {
  /** Signs in, creates an agent grant, and reads back the credential and owner the server recorded for them. */
  async function recorded(webRoot?: string, apiRoot?: string, env: Record<string, string> = {}) {
    await start({ MYGITNOTES_REPOSITORY: 'owner/repo', MYGITNOTES_BRANCH: 'main', ...env }, webRoot, apiRoot);
    const cookie = await signIn(webRoot);
    const store = createRecordStore(root);
    const granted = await fetch(`${base}/api/auth/agent-token`, post(cookie, { name: 'reader', write: false })).then(r => r.json());
    const grant = await store.get(granted.url.split('/').pop());
    expect(await fetch(`${base}/api/auth/agent-tokens`, { headers: { Cookie: cookie } }).then(r => r.json())).toMatchObject({ grants: [{ id: granted.id }] });
    return { credential: grant.credential as string, credentialRecord: await store.get(grant.credential), grant };
  }

  it('keeps the credential id, realm and grant owner of github.com as they were', async () => {
    const { credential, credentialRecord, grant } = await recorded('https://github.com', 'https://api.github.com');
    expect(credential).toBe(createHash('sha256').update('github-credential:ghe-client:42').digest('base64url'));
    expect(credentialRecord.realm).toBe('github:https://github.com:ghe-client');
    expect(grant).toMatchObject({ kind: 'agent', ownerId: 42, source: 'github:owner/repo@main' });
  });

  it('scopes them to an Enterprise site, so a session or grant from one site never authorizes another', async () => {
    const { credential, credentialRecord, grant } = await recorded(site, `${site}/api/v3`, { MYGITNOTES_GITHUB_URL: site });
    const realm = `github:${site}:ghe-client`;
    expect(credentialRecord.realm).toBe(realm);
    expect(credential).toBe(createHash('sha256').update(`${realm}:credential:42`).digest('base64url'));
    expect(credential).not.toBe(createHash('sha256').update('github-credential:ghe-client:42').digest('base64url'));
    expect(grant).toMatchObject({ kind: 'agent', ownerId: `${digest(realm)}:42`, source: `github:${site}/owner/repo@main` });
  });
});

describe('a lightweight deployment on GitHub Enterprise that lets each visitor choose a repository', () => {
  const choosing = { MYGITNOTES_GITHUB_URL: site, VERCEL: '1', GITHUB_APP_SLUG: 'my-notes' };
  const choose = (cookie: string, body: unknown) => fetch(`${base}/api/workspace/choice`, post(cookie, body));

  it('signs in on the site before a repository is chosen, lists its repositories and opens the chosen one from it', async () => {
    await start(choosing);
    expect(await fetch(`${base}/api/auth/session`).then(r => r.json())).toMatchObject({ authenticated: false, provider: 'github', storage: 'cookie', repositoryChoice: true, workspace: null });
    const cookie = await signIn();
    expect(await fetch(`${base}/api/workspace`, { headers: { Cookie: cookie } }).then(r => r.json())).toMatchObject({ setupRequired: true, reason: 'choose-repository' });
    const listed = await fetch(`${base}/api/repositories/available`, { headers: { Cookie: cookie } }).then(r => r.json());
    expect(listed.repositories.map((entry: { fullName: string; }) => entry.fullName)).toEqual(['team/handbook']);
    expect(listed.installUrl).toBe(`${site}/github-apps/my-notes/installations/new`);
    // The default starter template lives on github.com, so the site offers no create link.
    expect(listed.newRepositoryUrl).toBeNull();
    expect((await choose(cookie, { repository: 'team/missing' })).status).toBe(404);
    const chosen = await choose(cookie, { repository: 'team/handbook' });
    expect(await chosen.json()).toEqual({ choice: { repository: 'team/handbook', branch: 'main' } });
    const withChoice = `${cookie}; ${cookieOf(chosen, 'mygitnotes_workspace')!.split(';')[0]}`;
    const workspace = await fetch(`${base}/api/workspace`, { headers: { Cookie: withChoice } }).then(r => r.json());
    expect(workspace).toMatchObject({ home: `github:${site}/team/handbook@main`, repositories: [{ type: 'github', branch: 'main', write: true }] });
    expect(outbound.every(call => call.url.startsWith(`${site}/`))).toBe(true);
    expect(outbound.some(call => call.url.startsWith(`${site}/api/v3/repos/team/handbook/commits/`))).toBe(true);
  });

  it('offers the create link when the deployment names a template on the site', async () => {
    await start({ ...choosing, MYGITNOTES_STARTER_TEMPLATE: 'team/starter' });
    const listed = await fetch(`${base}/api/repositories/available`, { headers: { Cookie: await signIn() } }).then(r => r.json());
    const create = new URL(listed.newRepositoryUrl);
    expect(create.origin + create.pathname).toBe('https://ghe.example.test/ghe/new');
    expect(Object.fromEntries(create.searchParams)).toMatchObject({ template_owner: 'team', template_name: 'starter', visibility: 'private' });
  });
});
