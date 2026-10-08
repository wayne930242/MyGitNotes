import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import type { PublishingRequest, PublishingService, PublishSync } from '../src/publishing.js';
import { createRecordStore } from '../src/record-store/index.js';

const manifest = 'schema_version: 1\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n';
const files: Record<string, string> = { '.mygitnotes.yaml': manifest, 'notes/life/shared.md': '---\ntitle: Shared\n---\n\nOld body\n', 'notes/life/private.md': '# Private\n' };
let root: string, server: Server, base: string;
/** What the edition's publishing service was given. */
let calls: PublishingRequest[];
let service: PublishingService | undefined;
const session = 'c'.repeat(43);

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-publishing-'));
  calls = [];
  service = { sync: async request => (calls.push(request), request.notes.filter(note => note.metadata.publish).map((note): PublishSync => ({ path: note.path, url: `https://pages.example/${String(note.metadata.publish)}` }))) };
  for (const [key, value] of Object.entries({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'owner/home', MYGITNOTES_BRANCH: 'main', SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', APP_URL: '', VERCEL: '' })) vi.stubEnv(key, value);
  await createRecordStore(root).set(session, { kind: 'session', token: 'fixture-owner', userId: 1 });
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    const match = /^https:\/\/api\.github\.com\/repos\/owner\/home(.*)$/.exec(String(url));
    if (!match) return nativeFetch(url, init);
    const endpoint = match[1];
    if (endpoint === '') return json({ id: 7, private: true, default_branch: 'main', permissions: { push: true } });
    if (endpoint.startsWith('/commits/')) return json({ sha: 'a'.repeat(40), commit: { tree: { sha: 'tree' } } });
    if (endpoint.startsWith('/git/trees/')) return json({ truncated: false, tree: Object.keys(files).map(file => ({ path: file, sha: `blob:${file}`, type: 'blob', mode: '100644', size: 10 })) });
    if (endpoint.startsWith('/git/blobs/')) return json({ encoding: 'base64', content: Buffer.from(files[decodeURIComponent(endpoint.slice('/git/blobs/blob:'.length))] ?? '').toString('base64') });
    if (endpoint === '/git/trees') return json({ sha: 'new-tree' });
    if (endpoint === '/git/commits') return json({ sha: 'd'.repeat(40) });
    if (endpoint.startsWith('/git/refs/')) return json({ object: { sha: 'd'.repeat(40) } });
    return json({});
  });
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function start() {
  server = createServer(createApp(root, service ? { publishing: service } : {}));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
}
const headers = { Cookie: `gh_notes_session=${session}`, 'Content-Type': 'application/json' };
const call = (method: string, url: string, body?: object) => fetch(`${base}${url}`, { method, headers, body: body && JSON.stringify(body) }).then(async response => ({ status: response.status, body: await response.json() }));
const commit = (notes: object[]) => call('POST', '/api/notes/commit', { repository: 'github:owner/home@main', revision: 'a'.repeat(40), message: 'docs: update', notes });

it('hands the committed notes and their repository to the publishing service after the commit, and merges its answer', async () => {
  await start();
  const { status, body } = await commit([{ path: 'notes/life/shared.md', content: 'New body\n', metadata: { title: 'Shared', publish: 'shared' } }, { path: 'notes/life/private.md', content: '# Private changed\n', metadata: {} }]);
  expect(status).toBe(200);
  expect(body.commit.commitHash).toBe('d'.repeat(40));
  expect(body.published).toEqual([{ path: 'notes/life/shared.md', url: 'https://pages.example/shared' }]);
  expect(calls).toHaveLength(1);
  expect(calls[0].notes.map(note => note.path)).toEqual(['notes/life/shared.md', 'notes/life/private.md']);
  expect(calls[0].notes[0].metadata.publish).toBe('shared');
  expect(calls[0].repository.kind).toBe('remote');
  expect(calls[0].repository.authenticated).toBe(true);
});

it('hands a saved note to the publishing service too', async () => {
  await start();
  const { status, body } = await call('POST', '/api/notes', { path: 'notes/life/shared.md', content: 'Saved body\n', metadata: { publish: 'shared' }, revision: 'a'.repeat(40) });
  expect(status).toBe(200);
  expect(body.published).toEqual([{ path: 'notes/life/shared.md', url: 'https://pages.example/shared' }]);
  expect(calls[0].notes[0]).toMatchObject({ path: 'notes/life/shared.md', content: expect.stringContaining('Saved body') });
});

it('changes nothing without a publishing service', async () => {
  service = undefined;
  await start();
  const { status, body } = await commit([{ path: 'notes/life/shared.md', content: 'New body\n', metadata: { publish: 'shared' } }]);
  expect(status).toBe(200);
  expect(body.published).toBeUndefined();
});

it('is not asked about a deleted note', async () => {
  await start();
  const { status, body } = await commit([{ path: 'notes/life/shared.md', delete: true }]);
  expect(status).toBe(200);
  expect(body.published).toBeUndefined();
  expect(calls).toEqual([]);
});

it('keeps the commit and reports every note when the service throws', async () => {
  service = {
    sync: async () => {
      throw new Error('database password is hunter2');
    },
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await start();
  const { status, body } = await commit([{ path: 'notes/life/shared.md', content: 'New body\n', metadata: { publish: 'shared' } }]);
  expect(status).toBe(200);
  expect(body.commit.commitHash).toBe('d'.repeat(40));
  expect(body.published).toEqual([{ path: 'notes/life/shared.md', error: 'Publishing failed. Commit the note again to retry.' }]);
  expect(JSON.stringify(body)).not.toContain('hunter2');
});
