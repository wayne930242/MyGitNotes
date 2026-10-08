import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { repositoryRef, type WorkspaceConfigSource, WorkspaceSetupError } from '@mygitnotes/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createRecordStore, DirectoryRecordBackend, type RecordStore, SealedRecordStore } from '../src/record-store/index.js';
import { storedSessions } from '../src/browser-sessions.js';
import type { WorkspaceChoices } from '../src/repository-choice.js';

let server: Server | undefined;
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-services-'));
  vi.stubEnv('APP_URL', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('SESSION_SECRET', 'app-services'.repeat(4));
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function listen(app: ReturnType<typeof createApp>) {
  server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
}

/** A hosted deployment whose requester has not chosen a workspace yet. */
const noWorkspaceYet: WorkspaceConfigSource = {
  mode: 'remote',
  async settings() {
    throw new WorkspaceSetupError('Import a repository to start.');
  },
};

it('mounts edition routes ahead of the workspace routes, so they answer before a workspace exists', async () => {
  const base = await listen(createApp(dir, { configSource: noWorkspaceYet, remoteCache: undefined, routes: app => app.get('/api/edition/ping', (_req, res) => res.json({ edition: 'pro' })) }));
  expect(await fetch(`${base}/api/edition/ping`).then(response => response.json())).toEqual({ edition: 'pro' });
  const workspace = await fetch(`${base}/api/workspace`);
  expect(workspace.status).toBe(503);
  expect(await workspace.json()).toMatchObject({ setupRequired: true });
});

it('keeps sessions in the injected record store', async () => {
  const store = new SealedRecordStore(new DirectoryRecordBackend(path.join(dir, 'injected')));
  const session = 's'.repeat(43);
  await store.set(session, { kind: 'session', realm: 'github:https://github.com:', login: 'octo', userId: 1, token: 'fixture' });
  const home = repositoryRef({ type: 'github', repository: 'o/r', branch: 'main' });
  const configSource: WorkspaceConfigSource = { mode: 'remote', settings: async () => ({ home, localPath: () => undefined, manifest: inHomeRepository => inHomeRepository() }) };
  const base = await listen(createApp(dir, { configSource, recordStore: store, remoteCache: undefined }));
  const probe = await fetch(`${base}/api/auth/session`, { headers: { cookie: `gh_notes_session=${session}` } }).then(response => response.json());
  expect(probe).toMatchObject({ authenticated: true, login: 'octo' });
  expect(fs.existsSync(path.join(dir, '.github-notes-sessions'))).toBe(false);
});

it('offers no agent grants from a store that does not outlive the process', async () => {
  const durable = new SealedRecordStore(new DirectoryRecordBackend(dir));
  const transient: RecordStore = Object.assign(Object.create(durable), { durable: false });
  const base = await listen(createApp(dir, { configSource: noWorkspaceYet, recordStore: transient, remoteCache: undefined }));
  expect((await fetch(`${base}/api/auth/agent-tokens`)).status).toBe(404);
  expect((await fetch(`${base}/api/auth/agent-token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
});

/** A hosted deployment whose home repository is never read: the requests below never get past routing. */
const hostedHome: WorkspaceConfigSource = { mode: 'remote', settings: async () => ({ home: repositoryRef({ type: 'github', repository: 'o/r', branch: 'main' }), localPath: () => undefined, manifest: inHomeRepository => inHomeRepository() }) };

it('mounts an injected agent on a hosted deployment, and answers 403 where an edition supplies none', async () => {
  const router = Router();
  router.get('/session', (_req, res) => res.json({ session: null, piAvailable: true }));
  const hosted = await listen(createApp(dir, { configSource: hostedHome, remoteCache: undefined, piAgent: { router } }));
  expect(await fetch(`${hosted}/api/pi/session`).then(response => response.json())).toEqual({ session: null, piAvailable: true });
  await new Promise<void>(resolve => server!.close(() => resolve()));
  const community = await listen(createApp(dir, { configSource: hostedHome, remoteCache: undefined }));
  expect((await fetch(`${community}/api/pi/session`)).status).toBe(403);
});

it("answers an agent's own tool calls ahead of the workspace, which a call without a sign-in cannot open", async () => {
  const router = Router(), tools = Router();
  tools.post('/web-tools', (_req, res) => res.json({ result: 'answered' }));
  const base = await listen(createApp(dir, { configSource: noWorkspaceYet, remoteCache: undefined, piAgent: { router, tools } }));
  expect(await fetch(`${base}/api/pi/web-tools`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(response => response.json())).toEqual({ result: 'answered' });
  expect((await fetch(`${base}/api/pi/session`)).status).toBe(503);
});

it('serves the web build from the injected directory', async () => {
  const web = path.join(dir, 'pro-web');
  fs.mkdirSync(web);
  fs.writeFileSync(path.join(web, 'index.html'), '<title>Pro</title>');
  const base = await listen(createApp(dir, { configSource: noWorkspaceYet, remoteCache: undefined, webDist: web }));
  expect(await fetch(`${base}/settings`).then(response => response.text())).toContain('<title>Pro</title>');
});

it("keeps visitors' repository choices in the injected service", async () => {
  vi.stubEnv('MYGITNOTES_SOURCE', 'github');
  vi.stubEnv('MYGITNOTES_REPOSITORY', '');
  vi.stubEnv('MYGITNOTES_STORAGE', 'directory');
  const signedOut = vi.fn(async () => {});
  const workspaceChoices: WorkspaceChoices = { read: async () => ({ repository: 'octo/notes', branch: 'main' }), write: async () => {}, clear: async () => {}, signedOut };
  const base = await listen(createApp(dir, { workspaceChoices, remoteCache: undefined }));
  expect(await fetch(`${base}/api/auth/session`).then(response => response.json())).toMatchObject({ repositoryChoice: true, workspace: { repository: 'octo/notes', branch: 'main' } });
  await fetch(`${base}/api/auth/logout`, { method: 'POST' });
  expect(signedOut).toHaveBeenCalledOnce();
});

it('reports sign-in configured on Vercel when an edition injects a store that keeps records', async () => {
  for (const [key, value] of Object.entries({ VERCEL: '1', REDIS_URL: '', UPSTASH_REDIS_REST_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', GITHUB_CLIENT_ID: 'client', GITHUB_CLIENT_SECRET: 'secret' })) vi.stubEnv(key, value);
  const store = new SealedRecordStore(new DirectoryRecordBackend(path.join(dir, 'postgres-stand-in')));
  const home = repositoryRef({ type: 'github', repository: 'o/r', branch: 'main' });
  const configSource: WorkspaceConfigSource = { mode: 'remote', settings: async () => ({ home, localPath: () => undefined, manifest: inHomeRepository => inHomeRepository() }) };
  const base = await listen(createApp(dir, { configSource, recordStore: store, sessions: storedSessions(store), remoteCache: undefined }));
  expect(await fetch(`${base}/api/auth/session`).then(response => response.json())).toMatchObject({ storage: 'stored', configured: true });
});

it('reports the community store unready on Vercel until Redis is configured', () => {
  for (const [key, value] of Object.entries({ VERCEL: '1', REDIS_URL: '', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', KV_REST_API_URL: '', KV_REST_API_TOKEN: '' })) vi.stubEnv(key, value);
  const store = createRecordStore(dir);
  expect(store.ready).toBe(false);
  vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
  expect(store.ready).toBe(true);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('REDIS_URL', '');
  expect(store.ready).toBe(true);
});

it('answers a malformed JSON body with a fixed 400 that neither quotes nor logs the body, and keeps 413 for a too-large one', async () => {
  const secret = 'sk-live-SECRET-0123456789';
  const spies = (['error', 'warn', 'log', 'info'] as const).map(name => vi.spyOn(console, name).mockImplementation(() => undefined));
  const base = await listen(createApp(dir, { configSource: noWorkspaceYet, remoteCache: undefined, routes: app => app.put('/api/edition/key', (_req, res) => res.json({ ok: true })) }));
  const send = (body: string) => fetch(`${base}/api/edition/key`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body });
  const bad = await send(`{"key": "${secret}`);
  expect(bad.status).toBe(400);
  const text = await bad.text();
  expect(JSON.parse(text)).toEqual({ error: 'Request body is not valid JSON.', code: 'bad-json' });
  expect(text).not.toContain(secret);
  expect((await send(JSON.stringify({ key: 'x'.repeat(9 * 1024 * 1024) }))).status).toBe(413);
  for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
  spies.forEach(spy => spy.mockRestore());
});
