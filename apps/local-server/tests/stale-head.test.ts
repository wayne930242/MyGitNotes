import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { SessionStore } from '../src/auth.js';

const manifest = 'schema_version: 1\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n';
const R1 = 'a'.repeat(40), R2 = 'b'.repeat(40);
let head = R1, root: string, server: Server, base: string;
const session = 'c'.repeat(43);
const home = 'github:owner/home@main';

beforeEach(async () => {
  head = R1;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-stale-head-'));
  for (const [key, value] of Object.entries({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'owner/home', MYGITNOTES_BRANCH: 'main', SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', APP_URL: '', VERCEL: '' })) vi.stubEnv(key, value);
  await new SessionStore(root).set(session, { kind: 'session', token: 'fixture-owner', userId: 1 });
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const match = /^https:\/\/api\.github\.com\/repos\/owner\/home(.*)$/.exec(String(url));
    if (!match) return nativeFetch(url, init);
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    const endpoint = match[1];
    if (endpoint === '') return json({ private: true, default_branch: 'main', permissions: { push: true } });
    if (endpoint.startsWith('/commits/')) return json({ sha: head, commit: { tree: { sha: `tree-${head}` } } });
    if (endpoint.startsWith('/git/trees/')) return json({ truncated: false, tree: [{ path: '.mygitnotes.yaml', sha: 'manifest', type: 'blob', mode: '100644', size: 10 }, { path: 'notes/life/a.md', sha: 'note', type: 'blob', mode: '100644', size: 10 }] });
    if (endpoint.startsWith('/git/blobs/')) return json({ encoding: 'base64', content: Buffer.from(endpoint.endsWith('manifest') ? manifest : '# A\n').toString('base64') });
    return json({});
  });
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const get = (url: string) => fetch(`${base}${url}`, { headers: { Cookie: `gh_notes_session=${session}` } }).then(async response => ({ status: response.status, body: await response.json() }));
const revisionOf = (body: { repositories: { id: string; revision: string; }[]; }) => body.repositories.find(repository => repository.id === home)!.revision;

it('answers a request naming a head this instance has not seen yet, as after another instance committed', async () => {
  expect(revisionOf((await get('/api/workspace')).body)).toBe(R1);
  head = R2;
  const query = await get(`/api/notes/query?notebookId=life&revisions=${encodeURIComponent(JSON.stringify({ [home]: R2 }))}`);
  expect(query.status).toBe(200);
  expect(query.body.revisions).toEqual({ [home]: R2 });
});

it('still refuses a request naming a head the branch has moved past', async () => {
  expect(revisionOf((await get('/api/workspace')).body)).toBe(R1);
  head = R2;
  expect(revisionOf((await get('/api/workspace?fresh=1')).body)).toBe(R2);
  const query = await get(`/api/notes/query?notebookId=life&revisions=${encodeURIComponent(JSON.stringify({ [home]: R1 }))}`);
  expect(query.status).toBe(409);
  expect(query.body.staleRepositories).toEqual([home]);
});
