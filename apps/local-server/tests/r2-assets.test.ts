import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { type AppServices, createApp } from '../src/app.js';
import { r2SettingsFromEnv } from '@mygitnotes/core';
import { createRecordStore } from '../src/record-store/index.js';

const R2 = { MYGITNOTES_R2_ACCOUNT_ID: 'acc', MYGITNOTES_R2_ACCESS_KEY_ID: 'AK', MYGITNOTES_R2_SECRET_ACCESS_KEY: 'r2-secret', MYGITNOTES_R2_BUCKET: 'private-assets' };
const MANIFEST = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n';
const NOTE = '# Rules\n\n![Core](<r2:trpg/Tales from the old west/Core.pdf>)\n';
const KEY_URL = '/r2-assets/trpg/Tales%20from%20the%20old%20west/Core.pdf';
let root: string, server: Server, base: string;

async function start(env: Record<string, string>, services: Partial<AppServices> = {}) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-r2-'));
  if (env.GITHUB_NOTES_SOURCE === 'local') {
    env = { ...env, GITHUB_NOTES_LOCAL_PATH: root };
    fs.mkdirSync(path.join(root, 'notes/ex'), { recursive: true });
    fs.writeFileSync(path.join(root, 'notes/.github-notes.yaml'), MANIFEST);
    fs.writeFileSync(path.join(root, 'notes/ex/rules.md'), NOTE);
  }
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', APP_URL: '', VERCEL: '', ...env })) vi.stubEnv(key, value);
  server = createServer(createApp(root, services));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
}
const get = (url: string, headers: Record<string, string> = {}) => fetch(`${base}${url}`, { redirect: 'manual', headers });
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (root) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('R2 asset authorization', () => {
  it('redirects a local reference to a presigned object only for a note that references the key', async () => {
    await start({ ...R2, GITHUB_NOTES_SOURCE: 'local' });
    fs.writeFileSync(path.join(root, 'notes/ex/other.md'), '# Other');
    fs.writeFileSync(path.join(root, '.env'), '![x](<r2:trpg/Tales from the old west/Core.pdf>)');

    const allowed = await get(`${KEY_URL}?note=notes/ex/rules.md`);
    expect(allowed.status).toBe(302);
    expect(allowed.headers.get('cache-control')).toBe('private, no-store');
    const location = new URL(allowed.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://acc.r2.cloudflarestorage.com/private-assets/trpg/Tales%20from%20the%20old%20west/Core.pdf');
    expect(location.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(allowed.headers.get('location')).not.toContain('r2-secret');

    expect((await get(`${KEY_URL}?note=notes/ex/other.md`)).status).toBe(404);
    expect((await get(`/r2-assets/trpg/other.pdf?note=notes/ex/rules.md`)).status).toBe(404);
    expect((await get(`${KEY_URL}?note=.env`)).status).toBe(404);
    expect((await get(`${KEY_URL}?note=../outside.md`)).status).toBe(404);
    expect((await get(KEY_URL)).status).toBe(404);
  });

  it("answers 404 for a referenced key outside the requester's asset scope", async () => {
    const inScope = (prefix: string) => ({ resolve: async () => ({ settings: r2SettingsFromEnv()!, prefix, limits: { maxObjectBytes: 1 } }) });
    await start({ ...R2, GITHUB_NOTES_SOURCE: 'local' }, { assetStorage: inScope('trpg/') });
    expect((await get(`${KEY_URL}?note=notes/ex/rules.md`)).status).toBe(302);
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
    await start({ ...R2, GITHUB_NOTES_SOURCE: 'local' }, { assetStorage: inScope('r/42/') });
    // The note references the key, but the key belongs to another key space.
    expect((await get(`${KEY_URL}?note=notes/ex/rules.md`)).status).toBe(404);
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
    await start({ ...R2, GITHUB_NOTES_SOURCE: 'local' }, { assetStorage: { resolve: async () => null } });
    expect((await get(`${KEY_URL}?note=notes/ex/rules.md`)).status).toBe(404);
  });

  it('answers 502 when the storage fails with something other than a SourceError, and 500 for a prefix that could reach a sibling folder', async () => {
    await start({ ...R2, GITHUB_NOTES_SOURCE: 'local' }, { assetStorage: { resolve: async () => Promise.reject(new Error('database unreachable')) } });
    const failed = await get(`${KEY_URL}?note=notes/ex/rules.md`);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: 'database unreachable' });
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
    await start({ ...R2, GITHUB_NOTES_SOURCE: 'local' }, { assetStorage: { resolve: async () => ({ settings: r2SettingsFromEnv()!, prefix: 'trpg', limits: { maxObjectBytes: 1 } }) } });
    expect((await get(`${KEY_URL}?note=notes/ex/rules.md`)).status).toBe(500);
  });

  it('returns 404 when R2 is not configured', async () => {
    await start({ GITHUB_NOTES_SOURCE: 'local' });
    expect((await get(`${KEY_URL}?note=notes/ex/rules.md`)).status).toBe(404);
  });

  it('requires hosted workspace read permission before presigning a private reference', async () => {
    const session = 'b'.repeat(43);
    const files: Record<string, string> = { 'notes/.github-notes.yaml': MANIFEST, 'notes/ex/rules.md': NOTE };
    const nativeFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (!String(url).startsWith('https://api.github.com/repos/owner/private')) return nativeFetch(url, init);
      if (!(init?.headers as any)?.Authorization) return new Response('{}', { status: 404 });
      const endpoint = String(url).replace('https://api.github.com/repos/owner/private', '');
      const value = endpoint === '' ? { private: true, permissions: { push: false } } : endpoint.startsWith('/commits/') ? { sha: 'head', commit: { tree: { sha: 'tree' } } } : endpoint.startsWith('/git/trees/') ? { truncated: false, tree: Object.keys(files).map(file => ({ path: file, sha: file, type: 'blob', mode: '100644' })) } : endpoint.startsWith('/git/blobs/') ? { encoding: 'base64', content: Buffer.from(files[decodeURIComponent(endpoint.slice('/git/blobs/'.length))] || '').toString('base64') } : {};
      return new Response(JSON.stringify(value), { status: 200 });
    });
    await start({ ...R2, GITHUB_NOTES_SOURCE: 'github', GITHUB_NOTES_REPOSITORY: 'owner/private', GITHUB_NOTES_BRANCH: 'main' });
    await createRecordStore(root).set(session, { kind: 'session', token: 'reader-token', userId: 1 });

    expect((await get(`${KEY_URL}?note=notes/ex/rules.md`)).status).toBe(404);
    const reader = { Cookie: `gh_notes_session=${session}` };
    const allowed = await get(`${KEY_URL}?note=notes/ex/rules.md`, reader);
    expect(allowed.status).toBe(302);
    expect(allowed.headers.get('location')).toMatch(/^https:\/\/acc\.r2\.cloudflarestorage\.com\/private-assets\//);
    expect((await get(`/r2-assets/unreferenced.pdf?note=notes/ex/rules.md`, reader)).status).toBe(404);
  });
});
