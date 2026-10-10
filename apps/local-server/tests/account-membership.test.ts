import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import type { NewMember, WorkspaceConfigSource } from '@mygitnotes/core';
import { type AppServices, createApp } from '../src/app.js';
import type { PiAgent } from '../src/pi-agent.js';
import { cookieSessions, storedSessions } from '../src/browser-sessions.js';
import { membershipStoreContract } from '../src/membership-store-contract.js';
import { memoryAccountSource } from '../src/memory-account-source.js';
import { createRecordStore, seal } from '../src/record-store/index.js';
import { chosenRepositorySource } from '../src/workspace-choice.js';

/** The person a test request belongs to: the grant's, else the `x-person` header's. */
const personOf = async (request: { headers: Record<string, string | string[] | undefined>; person?: { userId: number | string; }; }) => request.person ? String(request.person.userId) : request.headers['x-person'] as string | undefined;
let max: number | null = null;
membershipStoreContract('in-memory', () => {
  max = null;
  const configSource = memoryAccountSource({ personOf, limit: () => max === null ? null : { max, plan: 'Free' } });
  return {
    configSource,
    request: n => ({ headers: { 'x-person': String(n) } }),
    signedOut: () => ({ headers: {} }),
    person: n => ({ realm: 'github', userId: n }),
    setLimit: next => {
      max = next;
    },
    seed: (n, members) => configSource.seed(String(n), members),
  };
});

const manifest = (title: string, id: string) => `schema_version: 4\nworkspace:\n  title: ${title}\n  default_notebook: ${id}\nnotebooks:\n  - id: ${id}\n    title: ${title}\n    root: notes/${id}\n`;
const roots: string[] = [];
let server: Server | undefined, base = '';
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/**
 * GitHub's API for the repositories named here, recording every request; any other repository is not found. The GitHub
 * App is installed on all of them but `outer/public`, a public repository a user token still reads.
 */
const fakeGitHub = () => {
  const repositories: Record<string, { files: Record<string, string>; folders: string[]; }> = { 'outer/public': { files: { '.mygitnotes.yaml': manifest('Public', 'public') }, folders: [] }, 'octo/kb': { files: { '.mygitnotes.yaml': manifest('KB', 'life'), 'notes/life/note.md': '# KB note\n' }, folders: ['notes', 'notes/life'] }, 'octo/scraps': { files: { 'journal/day.md': '# Day\n', '.github/workflow.yml': 'on: push\n' }, folders: ['journal', 'inbox', '.github'] }, 'octo/old': { files: { '.mygitnotes.yaml': `${manifest('Old', 'old')}    source: { type: github, repository: octo/elsewhere, branch: main }\n` }, folders: [] }, 'octo/wiki': { files: { '.mygitnotes.yaml': manifest('Wiki', 'wiki') }, folders: [] }, 'octo/garden': { files: { '.mygitnotes.yaml': manifest('Garden', 'garden') }, folders: [] } };
  const requests: { method: string; url: string; }[] = [];
  const refreshes: string[] = [];
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url) === 'https://github.com/login/oauth/access_token') {
      // GitHub refresh tokens are single use: a second refresh with the same one is refused.
      const { refresh_token } = JSON.parse(String(init?.body));
      const fresh = !refreshes.includes(refresh_token);
      refreshes.push(refresh_token);
      return new Response(JSON.stringify(fresh ? { access_token: `fixture-owner-${refresh_token}`, refresh_token: `${refresh_token}-next`, expires_in: 28800, refresh_token_expires_in: 15811200 } : { error: 'bad_refresh_token' }), { status: fresh ? 200 : 400 });
    }
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    // As GitHub lists a user access token's installations, one page each.
    if (String(url).startsWith('https://api.github.com/user/installations')) {
      requests.push({ method: init?.method ?? 'GET', url: String(url) });
      if (String(url).startsWith('https://api.github.com/user/installations/7/repositories')) return json({ total_count: 0, repositories: Object.keys(repositories).filter(name => name !== 'outer/public').map(name => ({ full_name: name, default_branch: 'main', private: true, updated_at: '2026-10-10T00:00:00Z', permissions: { push: true } })) });
      return json({ total_count: 1, installations: [{ id: 7 }] });
    }
    const match = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/?]+)(.*)$/.exec(String(url));
    if (!match) return nativeFetch(url, init);
    requests.push({ method: init?.method ?? 'GET', url: String(url) });
    const [, name, endpoint] = match;
    const repository = repositories[name];
    if (!repository) return json({ message: 'Not Found' }, 404);
    if (endpoint === '') return json({ full_name: name, private: name !== 'outer/public', default_branch: 'main', permissions: { push: name !== 'outer/public' } });
    if (endpoint.startsWith('/commits/')) return endpoint === '/commits/main' ? json({ sha: 'c'.repeat(40), commit: { tree: { sha: `${name}-tree` } } }) : json({ message: 'No commit found' }, 422);
    if (endpoint.startsWith('/git/trees/')) return json({ truncated: false, tree: [...repository.folders.map(folder => ({ path: folder, sha: `${name}:${folder}`, type: 'tree', mode: '040000' })), ...Object.entries(repository.files).map(([file, text]) => ({ path: file, sha: `${name}:${file}`, type: 'blob', mode: '100644', size: Buffer.byteLength(text) }))] });
    if (endpoint.startsWith('/git/blobs/')) return json({ encoding: 'base64', content: Buffer.from(repository.files[decodeURIComponent(endpoint.slice('/git/blobs/'.length)).slice(name.length + 1)] ?? '').toString('base64') });
    return json({});
  });
  return Object.assign(requests, { refreshes });
};
/** The visitor-choice deployment's environment: GitHub, with no repository named, and sessions in a local directory. */
const visitorChoice = () => {
  for (const [key, value] of Object.entries({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: '', SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', MYGITNOTES_STORAGE: '', APP_URL: '', VERCEL: '', GITHUB_APP_TYPE: 'github-app', GITHUB_CLIENT_ID: 'app-client', GITHUB_CLIENT_SECRET: 'app-secret' })) vi.stubEnv(key, value);
};

describe("an edition that keeps each person's repositories", () => {
  const sessions = { owner: 'o'.repeat(43), other: 'p'.repeat(43) };
  /** A deployment where visitors bring repositories, composed with an in-memory account store and no repository choices. */
  const start = async ({ limit = 2, piAgent, cookies = false, defer }: { limit?: number; piAgent?: PiAgent; cookies?: boolean; defer?: AppServices['defer']; } = {}) => {
    const product = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-accounts-')));
    roots.push(product);
    visitorChoice();
    const recordStore = createRecordStore(product);
    await recordStore.set(sessions.owner, { kind: 'session', token: 'fixture-owner', login: 'octo', userId: 1 });
    await recordStore.set(sessions.other, { kind: 'session', token: 'fixture-other', login: 'hubot', userId: 2 });
    // The lightweight mode keeps the session, provider token included, sealed in the browser's cookie.
    const browser = cookies ? cookieSessions() : storedSessions(recordStore);
    const accounts = memoryAccountSource({ personOf: async request => (await browser.read(request))?.login as string | undefined, limit: () => ({ max: limit, plan: 'Free', upgradeUrl: 'https://example.com/upgrade' }) });
    const added: NewMember[] = [];
    // The store sees exactly what the members route hands it.
    const configSource: WorkspaceConfigSource = {
      ...accounts,
      membership(request) {
        const store = accounts.membership!(request)!;
        return {
          ...store,
          add: (member, revision) => {
            added.push(member);
            return store.add(member, revision);
          },
        };
      },
    };
    const requests = fakeGitHub();
    server = createServer(createApp(product, { configSource, recordStore, workspaceChoices: null, ...(cookies ? { sessions: browser } : {}), ...(piAgent ? { piAgent } : {}), ...(defer ? { defer } : {}) }));
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
    return { requests, added, refreshes: requests.refreshes };
  };
  const call = async (method: string, url: string, body?: unknown, session: string | null = sessions.owner) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: `gh_notes_session=${session}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})), cookies: response.headers.getSetCookie() };
  };
  const members = async (session = sessions.owner) => (await call('GET', '/api/workspace/members', undefined, session)).body;
  const add = async (repository: string, extra: Record<string, unknown> = {}) => call('POST', '/api/workspace/members', { repository, revision: (await members()).revision, ...extra });

  it('adds a platform repository the person can reach, asking for a folder exactly when its branch keeps no manifest', async () => {
    const { requests, added } = await start({ limit: 5 });
    expect(await members()).toMatchObject({ members: [], changeable: true, adds: 'repository', limit: { visible: 0, max: 5, plan: 'Free', upgradeUrl: 'https://example.com/upgrade' } });
    expect((await add('octo/kb')).status).toBe(200);
    expect(added.at(-1)).toMatchObject({ ref: { id: 'github:octo/kb@main' }, token: 'fixture-owner' });
    expect(added.at(-1)?.folder).toBeUndefined();
    // Without a manifest the person picks one of the branch's top-level folders, or types a new one.
    expect(await add('octo/scraps')).toMatchObject({ status: 422, body: { code: 'folder-required' } });
    expect((await call('GET', '/api/workspace/members/folders?repository=octo/scraps')).body).toEqual({ repository: 'octo/scraps', branch: 'main', manifest: false, folders: ['inbox', 'journal'] });
    // The route keeps the folder inside the repository before any store sees it, and hands it on normalized.
    for (const folder of ['../x', '.git', '/etc']) expect([folder, await add('octo/scraps', { folder })]).toEqual([folder, expect.objectContaining({ status: 400, body: expect.objectContaining({ code: 'invalid' }) })]);
    expect(added.map(member => member.ref?.id)).toEqual(['github:octo/kb@main']);
    expect((await add('octo/scraps', { folder: ' journal/ ' })).status).toBe(200);
    expect(added.at(-1)?.folder).toBe('journal');
    expect(await add('octo/wiki', { folder: 'anything' })).toMatchObject({ status: 422, body: { code: 'folder-unused' } });
    // A manifest that does not load is shown with its error, never taken for none.
    expect(await add('octo/old')).toMatchObject({ status: 422, body: { code: 'invalid-manifest', error: expect.stringContaining('pnpm convert-sources') } });
    expect(await add('octo/unreachable')).toMatchObject({ status: 404, body: { error: expect.stringContaining('cannot reach it') } });
    expect(await add('octo/wiki', { branch: 'nope' })).toMatchObject({ status: 404, body: { error: 'Branch nope does not exist in octo/wiki.' } });
    expect(await add('not a name')).toMatchObject({ status: 400, body: { code: 'invalid' } });
    const list = await members();
    expect(list.members.map((member: { alias: string; repository: string; branch: string; default: boolean; folder?: string; editable: string; }) => [member.alias, member.repository, member.branch, member.default, member.folder, member.editable])).toEqual([['kb', 'octo/kb', 'main', true, undefined, 'account'], ['scraps', 'octo/scraps', 'main', false, 'journal', 'account']]);
    const workspace = (await call('GET', '/api/workspace')).body;
    expect(workspace.repositories.map((repository: { alias: string; notebooks: string[]; }) => [repository.alias, repository.notebooks])).toEqual([['kb', ['kb~life']], ['scraps', ['scraps~journal']]]);
    // Adding wrote nothing to any repository.
    expect(requests.filter(request => request.method !== 'GET')).toEqual([]);
  });

  it('refuses a public repository the GitHub App is not installed on as one it cannot reach, and adds it where people sign in with an OAuth App', async () => {
    const { requests, added } = await start({ limit: 5 });
    const missing = await add('outer/missing');
    expect(missing).toMatchObject({ status: 404, body: { error: expect.stringContaining('grant the GitHub App access') } });
    // The person's token reads the public repository, yet the answer is the one a missing repository gets.
    expect(await add('outer/public')).toEqual(missing);
    expect(await call('GET', '/api/workspace/members/folders?repository=outer/public')).toMatchObject({ status: 404, body: missing.body });
    expect(JSON.stringify(missing.body)).not.toContain('outer/');
    expect(added).toEqual([]);
    expect(requests.filter(request => request.url.includes('/repos/outer/public/'))).toEqual([]);
    // The same repository is installed-or-not only for a GitHub App; an OAuth App token keeps reaching it as before.
    vi.stubEnv('GITHUB_APP_TYPE', 'oauth-app');
    expect((await add('outer/public')).status).toBe(200);
    expect(added.map(member => member.ref?.id)).toEqual(['github:outer/public@main']);
    expect(await add('outer/missing')).toMatchObject({ status: 404, body: { error: 'That repository does not exist or this sign-in cannot reach it.' } });
  });

  it('refuses adding and showing past the visible limit, never hiding anything, and reports the limit with the list', async () => {
    await start({ limit: 2 });
    await add('octo/kb');
    await add('octo/wiki');
    expect(await add('octo/garden')).toMatchObject({ status: 403, body: { code: 'visible-limit' } });
    const wiki = (await members()).members.find((member: { alias: string; }) => member.alias === 'wiki').id;
    expect((await call('PATCH', '/api/workspace/members', { repository: wiki, hidden: true, revision: (await members()).revision })).status).toBe(200);
    expect((await members()).limit).toMatchObject({ visible: 1, max: 2 });
    expect((await add('octo/garden')).status).toBe(200);
    expect(await call('PATCH', '/api/workspace/members', { repository: wiki, hidden: false, revision: (await members()).revision })).toMatchObject({ status: 403, body: { code: 'visible-limit' } });
    expect(await call('PATCH', '/api/workspace/members', { repository: wiki, default: true, revision: (await members()).revision })).toMatchObject({ status: 403, body: { code: 'visible-limit' } });
    expect((await members()).members.map((member: { alias: string; hidden: boolean; }) => [member.alias, member.hidden])).toEqual([['kb', false], ['wiki', true], ['garden', false]]);
  });

  it("names a person's own hidden repositories to them and keeps each person's list apart", async () => {
    await start();
    await add('octo/kb');
    await add('octo/wiki');
    const wiki = (await members()).members.find((member: { alias: string; }) => member.alias === 'wiki').id;
    await call('PATCH', '/api/workspace/members', { repository: wiki, hidden: true, revision: (await members()).revision });
    const list = await members();
    expect(list.hiddenUnnamed).toBeUndefined();
    expect(list.members.find((member: { alias: string; }) => member.alias === 'wiki')).toMatchObject({ hidden: true, repository: 'octo/wiki' });
    expect((await members(sessions.other)).members).toEqual([]);
  });

  it('opens the add flow instead of repository choices, and refuses changes and folder lists to a request nobody signed in to', async () => {
    await start();
    expect((await call('GET', '/api/auth/session')).body).toMatchObject({ authenticated: true, repositoryChoice: true, accountMembers: true, workspace: null });
    expect((await call('GET', '/api/auth/session', undefined, null)).body).toMatchObject({ authenticated: false, accountMembers: true, workspace: null });
    expect(await call('POST', '/api/workspace/choice', { repository: 'octo/kb' })).toMatchObject({ status: 404, body: { error: expect.stringContaining('Settings') } });
    await add('octo/kb');
    expect((await call('GET', '/api/auth/session')).body).toMatchObject({ accountMembers: true, workspace: { repository: 'octo/kb', branch: 'main' } });
    expect((await call('GET', '/api/workspace')).body.repositoryChoice).toBeUndefined();
    expect((await call('GET', '/api/workspace/members')).body.repositoryChoice).toBeUndefined();
    const { revision } = await members();
    expect(await call('POST', '/api/workspace/members', { repository: 'octo/wiki', revision }, null)).toMatchObject({ status: 401, body: { code: 'sign-in' } });
    expect(await call('PATCH', '/api/workspace/members', { repository: 'github:octo/kb@main', hidden: true, revision }, null)).toMatchObject({ status: 401, body: { code: 'sign-in' } });
    expect((await call('GET', '/api/workspace/members/folders?repository=octo/scraps', undefined, null)).status).toBe(401);
  });

  it('adds a repository with a cookie session whose token needs refreshing, refreshing it exactly once per request', async () => {
    const { refreshes, added } = await start({ cookies: true });
    /** A sealed cookie session whose upstream token has expired, with a refresh token of its own that was never used. */
    const expired = (refreshToken: string) => seal({ value: { kind: 'session', token: 'fixture-owner', refreshToken, upstreamExpiresAt: Date.now() - 1000, login: 'octo', userId: 1 }, expires: Date.now() + 3600_000 });
    const { revision } = await members(expired('refresh-list'));
    const answer = await call('POST', '/api/workspace/members', { repository: 'octo/kb', revision }, expired('refresh-add'));
    expect(answer.status).toBe(200);
    // The single-use refresh token was spent once, and the browser keeps the rotated session rather than losing it.
    expect(refreshes.filter(token => token === 'refresh-add')).toEqual(['refresh-add']);
    expect(answer.cookies.find(cookie => cookie.startsWith('gh_notes_session='))).not.toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(added.at(-1)).toMatchObject({ ref: { id: 'github:octo/kb@main' }, token: 'fixture-owner-refresh-add' });
    const folders = await call('GET', '/api/workspace/members/folders?repository=octo/scraps', undefined, expired('refresh-folders'));
    expect(folders).toMatchObject({ status: 200, body: { folders: ['inbox', 'journal'] } });
    expect(refreshes.filter(token => token === 'refresh-folders')).toEqual(['refresh-folders']);
  });

  it('tells the agent which repositories stay visible and whose request changed them', async () => {
    const membershipChanged = vi.fn(async (_visible: string[], _request: { headers: Record<string, unknown>; }) => {});
    await start({ piAgent: { router: Router(), membershipChanged } });
    await add('octo/kb');
    await add('octo/wiki');
    await call('PATCH', '/api/workspace/members', { repository: 'github:octo/wiki@main', hidden: true, revision: (await members()).revision });
    await vi.waitFor(() => expect(membershipChanged).toHaveBeenLastCalledWith(['github:octo/kb@main'], expect.objectContaining({ headers: expect.objectContaining({ cookie: `gh_notes_session=${sessions.owner}` }) })));
  });

  it("hands the agent's work after a change to the edition's defer, which holds it past the answer as waitUntil does", async () => {
    let release = () => {};
    const membershipChanged = vi.fn(() => new Promise<void>(resolve => (release = resolve)));
    const deferred: Promise<unknown>[] = [];
    await start({ piAgent: { router: Router(), membershipChanged }, defer: work => deferred.push(work) });
    expect((await add('octo/kb')).status).toBe(200);
    // The answer went out while the agent is still busy; what the edition holds is that very work.
    expect(deferred).toHaveLength(1);
    await vi.waitFor(() => expect(membershipChanged).toHaveBeenCalledTimes(1));
    let settled = false;
    void deferred[0].then(() => (settled = true));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    release();
    await deferred[0];
    // A failing agent is logged inside the held work rather than rejecting it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    membershipChanged.mockRejectedValueOnce(new Error('sandbox gone'));
    await add('octo/wiki');
    await expect(deferred[1]).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[members] after a membership change: sandbox gone');
  });
});

describe('repository choices beside a configuration source', () => {
  const session = 'o'.repeat(43);
  /** Serves a fresh product directory with the services `services` names for it; GitHub is faked once per test. */
  const serve = async (services: (product: string) => Partial<AppServices>) => {
    const product = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-choices-')));
    roots.push(product);
    const recordStore = createRecordStore(product);
    await recordStore.set(session, { kind: 'session', token: 'fixture-owner', login: 'octo', userId: 1 });
    server = createServer(createApp(product, { recordStore, ...services(product) }));
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
  };
  const call = async (method: string, url: string, body?: unknown, cookie = `gh_notes_session=${session}`) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})), cookies: response.headers.getSetCookie() };
  };

  it('keeps cookie choices for a visitor-choice deployment started from the Node entry, which passes its configuration source', async () => {
    visitorChoice();
    fakeGitHub();
    // As apps/local-server/src/index.ts starts the server under Docker and `pnpm start`.
    await serve(product => ({ configSource: chosenRepositorySource(product) }));
    const before = (await call('GET', '/api/auth/session')).body;
    expect(before).toMatchObject({ authenticated: true, repositoryChoice: true, workspace: null });
    expect(before.accountMembers).toBeUndefined();
    const chosen = await call('POST', '/api/workspace/choice', { repository: 'octo/kb' });
    expect(chosen).toMatchObject({ status: 200, body: { choice: { repository: 'octo/kb', branch: 'main' } } });
    const choice = chosen.cookies.find(cookie => cookie.startsWith('mygitnotes_workspace='))!.split(';')[0];
    const cookie = `gh_notes_session=${session}; ${choice}`;
    expect((await call('GET', '/api/auth/session', undefined, cookie)).body).toMatchObject({ repositoryChoice: true, workspace: { repository: 'octo/kb', branch: 'main' } });
    expect((await call('GET', '/api/workspace/members', undefined, cookie)).body).toMatchObject({ changeable: false, repositoryChoice: true, members: [{ id: 'github:octo/kb@main' }] });
    const forgotten = await call('DELETE', '/api/workspace/choice', undefined, cookie);
    expect(forgotten.status).toBe(200);
    expect(forgotten.cookies.find(line => line.startsWith('mygitnotes_workspace='))).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("keeps each person's repositories in the membership store only when told there are no choices", async () => {
    visitorChoice();
    fakeGitHub();
    const accounts = memoryAccountSource({ personOf: async () => 'octo' });
    await serve(() => ({ configSource: accounts }));
    expect((await call('GET', '/api/auth/session')).body.accountMembers).toBeUndefined();
    expect((await call('DELETE', '/api/workspace/choice')).status).toBe(200);
    await new Promise<void>(resolve => server!.close(() => resolve()));
    await serve(() => ({ configSource: accounts, workspaceChoices: null }));
    expect((await call('GET', '/api/auth/session')).body).toMatchObject({ repositoryChoice: true, accountMembers: true, workspace: null });
    expect(await call('DELETE', '/api/workspace/choice')).toMatchObject({ status: 404, body: { error: expect.stringContaining('Settings') } });
    expect((await call('GET', '/api/workspace/members')).body).toMatchObject({ changeable: true, adds: 'repository' });
  });
});
