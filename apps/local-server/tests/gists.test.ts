import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { createRecordStore } from '../src/record-store/index.js';
import { gistPageAllowed } from '../src/gists.js';

const manifest = 'schema_version: 1\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n';
const files: Record<string, string> = { '.mygitnotes.yaml': manifest, 'notes/life/shared.md': '---\ntitle: Shared\ngist: abc123\n---\n\nOld body\n', 'notes/life/private.md': '# Private\n' };
let root: string, server: Server, base: string;
/** Gists the fake GitHub holds, by id, and the Gist requests it received. */
let gists: Map<string, { description: string; public: boolean; files: Record<string, { content: string; }>; }>;
let gistCalls: { method: string; endpoint: string; body?: any; }[];
/** Scopes the fake GitHub reports for the signed-in token. */
let scopes: string;
const session = 'c'.repeat(43);

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-gists-'));
  gists = new Map([['abc123', { description: 'Shared', public: false, files: { 'old-name.md': { content: 'Old body' } } }]]);
  gistCalls = [];
  scopes = 'repo, workflow, gist';
  for (const [key, value] of Object.entries({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'owner/home', MYGITNOTES_BRANCH: 'main', SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', APP_URL: '', VERCEL: '' })) vi.stubEnv(key, value);
  await createRecordStore(root).set(session, { kind: 'session', token: 'fixture-owner', userId: 1 });
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'x-oauth-scopes': scopes } });
    const gist = /^https:\/\/api\.github\.com\/gists(\/[^/?]+)?$/.exec(String(url));
    if (gist) {
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      gistCalls.push({ method, endpoint: gist[1] || '', body });
      // GitHub hides Gist endpoints from a token without the gist scope.
      if (!scopes.includes('gist')) return json({ message: 'Not Found' }, 404);
      const id = gist[1]?.slice(1);
      if (method === 'POST' && !id) {
        gists.set('new456', body);
        return json({ id: 'new456', html_url: 'https://gist.github.com/new456' }, 201);
      }
      const found = id && gists.get(id);
      if (!found) return json({ message: 'Not Found' }, 404);
      if (method === 'DELETE') {
        gists.delete(id);
        return new Response(null, { status: 204 });
      }
      if (method === 'PATCH') {
        for (const [name, file] of Object.entries(body.files as Record<string, { filename: string; content: string; }>)) {
          delete found.files[name];
          found.files[file.filename] = { content: file.content };
        }
        found.description = body.description;
      }
      return json(found);
    }
    const match = /^https:\/\/api\.github\.com\/repos\/owner\/home(.*)$/.exec(String(url));
    if (!match) return nativeFetch(url, init);
    const endpoint = match[1];
    if (endpoint === '') return json({ private: true, default_branch: 'main', permissions: { push: true } });
    if (endpoint.startsWith('/commits/')) return json({ sha: 'a'.repeat(40), commit: { tree: { sha: 'tree' } } });
    if (endpoint.startsWith('/git/trees/')) return json({ truncated: false, tree: Object.keys(files).map(file => ({ path: file, sha: `blob:${file}`, type: 'blob', mode: '100644', size: 10 })) });
    if (endpoint.startsWith('/git/blobs/')) return json({ encoding: 'base64', content: Buffer.from(files[decodeURIComponent(endpoint.slice('/git/blobs/blob:'.length))] ?? '').toString('base64') });
    if (endpoint === '/git/trees') return json({ sha: 'new-tree' });
    if (endpoint === '/git/commits') return json({ sha: 'd'.repeat(40) });
    if (endpoint.startsWith('/git/refs/')) return json({ object: { sha: 'd'.repeat(40) } });
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

const headers = { Cookie: `gh_notes_session=${session}`, 'Content-Type': 'application/json' };
const call = (method: string, url: string, body?: object, requestHeaders: Record<string, string> = headers) => fetch(`${base}${url}`, { method, headers: requestHeaders, body: body && JSON.stringify(body) }).then(async response => ({ status: response.status, body: await response.json() }));
const commit = (notes: object[]) => call('POST', '/api/notes/commit', { repository: 'github:owner/home@main', revision: 'a'.repeat(40), message: 'docs: update', notes });

it('publishes a note body as a secret Gist of the signed-in account', async () => {
  const { status, body } = await call('POST', '/api/gists', { path: 'notes/life/private.md', content: '# Private\n', metadata: { title: 'Private' } });
  expect(status).toBe(200);
  expect(body).toEqual({ id: 'new456', url: 'https://gist.github.com/new456' });
  expect(gists.get('new456')).toEqual({ description: 'Private', public: false, files: { 'private.md': { content: '# Private\n' } } });
});

it('refuses to publish without a signed-in session or with an empty body', async () => {
  expect((await call('POST', '/api/gists', { path: 'notes/life/private.md', content: '# Private\n' }, { 'Content-Type': 'application/json' })).status).toBe(401);
  expect((await call('POST', '/api/gists', { path: 'notes/life/private.md', content: '  \n' })).status).toBe(400);
  expect(gistCalls).toEqual([]);
});

it('asks to sign in again when the grant lacks the gist scope', async () => {
  scopes = 'repo, workflow';
  const { status, body } = await call('POST', '/api/gists', { path: 'notes/life/private.md', content: '# Private\n' });
  expect(status).toBe(403);
  expect(body).toMatchObject({ reauthorize: true });
});

it('unpublishes by deleting the Gist, and treats a Gist already gone as deleted', async () => {
  expect(await call('DELETE', '/api/gists/abc123')).toEqual({ status: 200, body: { success: true } });
  expect(gists.has('abc123')).toBe(false);
  expect(await call('DELETE', '/api/gists/abc123')).toEqual({ status: 200, body: { success: true } });
  expect((await call('DELETE', '/api/gists/not-an-id')).status).toBe(400);
});

it('updates the Gist a committed note names with its latest body, renaming its file', async () => {
  const { status, body } = await commit([{ path: 'notes/life/shared.md', content: 'New body\n', metadata: { title: 'Shared again', gist: 'abc123' } }, { path: 'notes/life/private.md', content: '# Private changed\n', metadata: {} }]);
  expect(status).toBe(200);
  expect(body.gists).toEqual([{ path: 'notes/life/shared.md', gist: 'abc123' }]);
  expect(gists.get('abc123')).toEqual({ description: 'Shared again', public: false, files: { 'shared.md': { content: 'New body\n' } } });
});

it('does not call Gists when no committed note names one', async () => {
  const { status, body } = await commit([{ path: 'notes/life/private.md', content: '# Private changed\n', metadata: {} }]);
  expect(status).toBe(200);
  expect(body.gists).toBeUndefined();
  expect(gistCalls).toEqual([]);
});

it('keeps the commit and reports the note when its Gist cannot be updated', async () => {
  gists.clear();
  const { status, body } = await commit([{ path: 'notes/life/shared.md', content: 'New body\n', metadata: { gist: 'abc123' } }]);
  expect(status).toBe(200);
  expect(body.commit.commitHash).toBe('d'.repeat(40));
  expect(body.gists).toEqual([{ path: 'notes/life/shared.md', gist: 'abc123', error: expect.stringContaining('404') }]);
});

it('reports a Gist update the grant is not allowed to make as needing a new sign-in', async () => {
  scopes = 'repo, workflow';
  const { status, body } = await commit([{ path: 'notes/life/shared.md', content: 'New body\n', metadata: { gist: 'abc123' } }]);
  expect(status).toBe(200);
  expect(body.gists).toEqual([{ path: 'notes/life/shared.md', gist: 'abc123', error: expect.any(String), reauthorize: true }]);
});

it('opens only a Gist page of the workspace site', () => {
  const allowed = (location: string, site?: string) => gistPageAllowed(new URL(location), site);
  expect(allowed('https://gist.github.com/octo/abc123')).toBe(true);
  for (const location of ['http://gist.github.com/octo/abc123', 'https://gist.github.com:8443/abc123', 'https://u:p@gist.github.com/abc123', 'https://evil.example/gist/abc123', 'https://github.com/gist/abc123']) expect(allowed(location)).toBe(false);
  expect(allowed('https://ghe.example.com/gist/octo/abc123', 'https://ghe.example.com')).toBe(true);
  expect(allowed('https://gist.ghe.example.com/octo/abc123', 'https://ghe.example.com')).toBe(true);
  expect(allowed('https://ghe.example.com:8443/gist/abc123', 'https://ghe.example.com:8443')).toBe(true);
  expect(allowed('https://example.com/ghe/gist/abc123', 'https://example.com/ghe')).toBe(true);
  for (const location of ['https://gist.github.com/abc123', 'https://ghe.example.com/other/abc123', 'https://ghe.example.com:8443/gist/abc123', 'https://evilghe.example.com/gist/abc123', 'https://gist.ghe.example.com.evil.test/abc123', 'https://example.com/gist/abc123']) expect(allowed(location, location.includes('example.com/') && !location.includes('ghe.') ? 'https://example.com/ghe' : 'https://ghe.example.com')).toBe(false);
});
