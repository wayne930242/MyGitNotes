import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createApp } from './app.js';

const realFetch = globalThis.fetch;
let server: Server | undefined;
let temp: string | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function start(type: 'github' | 'gitlab') {
  vi.stubEnv('MYGITNOTES_SOURCE', type);
  vi.stubEnv('MYGITNOTES_REPOSITORY', 'example/notes');
  vi.stubEnv('MYGITNOTES_BRANCH', 'main');
  vi.stubEnv('MYGITNOTES_GITLAB_URL', 'https://gitlab.com');
  vi.stubEnv('VERCEL', '');
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'core-route-'));
  server = createServer(createApp(temp));
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server port');
  return `http://127.0.0.1:${address.port}`;
}
describe('remote Core HTTP routes', () => {
  it.each([['github', '', 'repo workflow'], ['github', 'github-app', null], ['gitlab', '', 'api']] as const)('requests the agreed OAuth scope for %s %s', async (provider, appType, scope) => {
    const base = await start(provider);
    vi.stubEnv('SESSION_SECRET', 'test-session-secret-with-at-least-32-characters');
    vi.stubEnv('GITHUB_CLIENT_ID', 'test-client');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'test-secret');
    vi.stubEnv('GITLAB_CLIENT_ID', 'test-client');
    vi.stubEnv('GITLAB_CLIENT_SECRET', 'test-secret');
    vi.stubEnv('GITHUB_APP_TYPE', appType);
    vi.stubEnv('APP_URL', base);
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('KV_REST_API_URL', '');
    const response = await realFetch(`${base}/api/auth/${provider}`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get('location')!).searchParams.get('scope')).toBe(scope);
  });
  it('mounts status and update for a GitHub session and returns named write-permission denial', async () => {
    const base = await start('github');
    const old = 'a'.repeat(40), head = 'b'.repeat(40);
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('https://api.github.com/')) return realFetch(input, init);
      expect(init?.method).toBeUndefined();
      let body: unknown;
      if (url.endsWith('/example/notes')) body = { fork: true, parent: { full_name: 'example/core' }, permissions: { push: false } };
      else if (url.includes('/compare/')) body = { ahead_by: 2, behind_by: 0 };
      else if (url.includes('/commits/')) body = { sha: old };
      else if (url.includes('/example/core/')) body = { object: { sha: head } };
      else body = { object: { sha: old } };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const status = await realFetch(base + '/api/core/status');
    expect(status.status).toBe(200);
    expect((await status.json()).status).toMatchObject({ state: 'permission_required', current: { behind: 2 } });
    const update = await realFetch(base + '/api/core/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(update.status).toBe(403);
    expect(await update.json()).toMatchObject({ code: 'PERMISSION_REQUIRED' });
  });
  it('explicitly reports unsupported GitLab without calling the provider', async () => {
    const base = await start('gitlab');
    vi.stubGlobal('fetch', () => {
      throw new Error('Unexpected provider call');
    });
    const status = await realFetch(base + '/api/core/status');
    expect((await status.json()).status).toMatchObject({ state: 'unsupported', canUpdate: false });
    const update = await realFetch(base + '/api/core/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(update.status).toBe(422);
    expect(await update.json()).toMatchObject({ code: 'UNSUPPORTED_PROVIDER' });
  });
});
