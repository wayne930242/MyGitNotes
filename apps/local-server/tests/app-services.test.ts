import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { repositoryRef, type WorkspaceConfigSource, WorkspaceSetupError } from '@mygitnotes/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { DirectoryRecordBackend, type RecordStore, SealedRecordStore } from '../src/record-store/index.js';

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
  const base = await listen(createApp(dir, {
    configSource: noWorkspaceYet,
    remoteCache: undefined,
    routes: app => app.get('/api/edition/ping', (_req, res) => res.json({ edition: 'pro' })),
  }));
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

it('serves the web build from the injected directory', async () => {
  const web = path.join(dir, 'pro-web');
  fs.mkdirSync(web);
  fs.writeFileSync(path.join(web, 'index.html'), '<title>Pro</title>');
  const base = await listen(createApp(dir, { configSource: noWorkspaceYet, remoteCache: undefined, webDist: web }));
  expect(await fetch(`${base}/settings`).then(response => response.text())).toContain('<title>Pro</title>');
});
