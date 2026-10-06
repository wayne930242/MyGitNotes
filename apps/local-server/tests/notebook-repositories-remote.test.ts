import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { createRecordStore } from '../src/record-store/index.js';

const manifest = `schema_version: 3
workspace:
  title: Hosted
  default_notebook: life
notebooks:
  - id: life
    title: Life
    root: notes/life
  - id: trpg
    title: TRPG
    root: notes/life
    source: { type: github, repository: owner/trpg }
  - id: secret
    title: Secret
    root: notes/secret
    source: { type: github, repository: owner/secret }
  - id: drafts
    title: Drafts
    root: notes/drafts
    source: { type: github, repository: owner/nobranch }
  - id: lab
    title: Lab
    root: notes/lab
    source: { type: gitlab, url: 'https://gitlab.com', repository: group/lab }
`;
/** Files and head commit of each repository the fake GitHub serves. */
const repositories: Record<string, { head: string; files: Record<string, string>; }> = { 'owner/home': { head: 'a'.repeat(40), files: { '.mygitnotes.yaml': manifest, 'notes/life/note.md': '# Home note\n' } }, 'owner/trpg': { head: 'b'.repeat(40), files: { 'notes/life/note.md': '# TRPG note\n' } }, 'owner/nobranch': { head: '', files: {} } };
let root: string, server: Server, base: string;
let writes: { repository: string; endpoint: string; }[];
const session = 'c'.repeat(43);

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-remote-repos-'));
  writes = [];
  for (const [key, value] of Object.entries({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'owner/home', MYGITNOTES_BRANCH: 'main', SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', APP_URL: '', VERCEL: '' })) vi.stubEnv(key, value);
  await createRecordStore(root).set(session, { kind: 'session', token: 'fixture-owner', userId: 1 });
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const match = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/?]+)(.*)$/.exec(String(url));
    if (!match) return nativeFetch(url, init);
    const [, name, endpoint] = match;
    const repository = repositories[name];
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (!repository) return json({ message: 'Not Found' }, 404);
    if (init?.method && init.method !== 'GET') writes.push({ repository: name, endpoint });
    if (endpoint === '') return json({ private: true, default_branch: 'main', permissions: { push: true } });
    if (endpoint.startsWith('/commits/')) return repository.head ? json({ sha: repository.head, commit: { tree: { sha: `${name}-tree` } } }) : json({ message: 'No commit found for SHA: main' }, 422);
    if (endpoint.startsWith('/git/trees/')) return json({ truncated: false, tree: Object.keys(repository.files).map(file => ({ path: file, sha: `${name}:${file}`, type: 'blob', mode: '100644', size: 10 })) });
    if (endpoint.startsWith('/git/blobs/')) return json({ encoding: 'base64', content: Buffer.from(repository.files[decodeURIComponent(endpoint.slice('/git/blobs/'.length)).slice(name.length + 1)] ?? '').toString('base64') });
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
const get = (url: string) => fetch(`${base}${url}`, { headers }).then(async response => ({ status: response.status, body: await response.json() }));

it('opens notebook repositories with the signed-in credential and names why others are unavailable', async () => {
  const { body } = await get('/api/workspace');
  const byNotebook = Object.fromEntries(body.repositories.map((repository: { notebooks: string[]; }) => [repository.notebooks[0], repository]));
  expect(byNotebook.life).toMatchObject({ id: 'github:owner/home@main', revision: 'a'.repeat(40), write: true });
  expect(byNotebook.trpg).toMatchObject({ id: 'github:owner/trpg@main', revision: 'b'.repeat(40), write: true });
  expect(byNotebook.secret).toMatchObject({ write: false, unavailable: { reason: 'no-access' } });
  expect(byNotebook.drafts).toMatchObject({ write: false, unavailable: { reason: 'missing-branch' } });
  expect(byNotebook.lab).toMatchObject({ write: false, unavailable: { reason: 'unsupported-platform' } });
  expect((await get('/api/notes/read?path=notes/life/note.md&notebookId=trpg')).body.note.content).toContain('TRPG note');
  expect((await get('/api/notes/read?path=notes/life/note.md&notebookId=life')).body.note.content).toContain('Home note');
  expect((await get('/api/notes/read?path=notes/secret/a.md&notebookId=secret')).status).toBe(503);
  const all = (await get('/api/notes/query?notebookId=all&limit=10')).body;
  expect(all.revisions).toEqual({ 'github:owner/home@main': 'a'.repeat(40), 'github:owner/trpg@main': 'b'.repeat(40) });
});

it('commits to the notebook repository a request names', async () => {
  const response = await fetch(`${base}/api/notes/commit`, { method: 'POST', headers, body: JSON.stringify({ repository: 'github:owner/trpg@main', revision: 'b'.repeat(40), message: 'docs: update', notes: [{ path: 'notes/life/note.md', notebookId: 'trpg', content: '# TRPG changed\n', metadata: {} }] }) });
  expect(response.status).toBe(200);
  expect(writes.length).toBeGreaterThan(0);
  expect(new Set(writes.map(write => write.repository))).toEqual(new Set(['owner/trpg']));
});
