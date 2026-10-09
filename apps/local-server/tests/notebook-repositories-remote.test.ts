import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { createRecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

const manifest = (title: string, id: string) => `schema_version: 4\nworkspace:\n  title: ${title}\n  default_notebook: ${id}\nnotebooks:\n  - id: ${id}\n    title: ${title}\n    root: notes/life\n`;
/** Files and head commit of each repository the fake GitHub serves. */
const repositories: Record<string, { head: string; files: Record<string, string>; }> = { 'owner/home': { head: 'a'.repeat(40), files: { '.mygitnotes.yaml': manifest('Hosted', 'life'), 'notes/life/note.md': '# Home note\n' } }, 'owner/trpg': { head: 'b'.repeat(40), files: { '.mygitnotes.yaml': manifest('TRPG', 'trpg'), 'notes/life/note.md': '# TRPG note\n' } }, 'owner/nobranch': { head: '', files: {} } };
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
  // Five members on github.com: two readable, one refused, one without its branch and one on GitLab.
  const members = workspaceSettings([{ type: 'github', repository: 'owner/home', branch: 'main' }, { type: 'github', repository: 'owner/trpg', branch: 'main' }, { type: 'github', repository: 'owner/secret', branch: 'main' }, { type: 'github', repository: 'owner/nobranch', branch: 'main' }, { type: 'gitlab', url: 'https://gitlab.com', repository: 'group/lab', branch: 'main' }]);
  server = createServer(createApp(root, { configSource: { mode: 'remote', settings: async () => members } }));
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
  // Each repository's alias derives from its name; its notebooks, named by key, come from its own manifest, which an unavailable one cannot supply.
  const byAlias = Object.fromEntries(body.repositories.map((repository: { alias: string; }) => [repository.alias, repository]));
  expect(body.repositories.map((repository: { alias: string; notebooks: string[]; }) => [repository.alias, repository.notebooks])).toEqual([['home', ['home~life']], ['trpg', ['trpg~trpg']], ['secret', []], ['nobranch', []], ['lab', []]]);
  expect(byAlias.home).toMatchObject({ id: 'github:owner/home@main', revision: 'a'.repeat(40), write: true });
  expect(byAlias.trpg).toMatchObject({ id: 'github:owner/trpg@main', revision: 'b'.repeat(40), write: true });
  expect(byAlias.secret).toMatchObject({ write: false, unavailable: { reason: 'no-access' } });
  expect(byAlias.nobranch).toMatchObject({ write: false, unavailable: { reason: 'missing-branch' } });
  expect(byAlias.lab).toMatchObject({ write: false, unavailable: { reason: 'unsupported-platform' } });
  expect((await get('/api/notes/read?path=notes/life/note.md&notebookId=trpg~trpg')).body.note.content).toContain('TRPG note');
  expect((await get('/api/notes/read?path=notes/life/note.md&notebookId=home~life')).body.note.content).toContain('Home note');
  expect((await get('/api/notes/read?path=notes/secret/a.md&notebookId=secret~secret')).status).toBe(503);
  const all = (await get('/api/notes/query?notebookId=all&limit=10')).body;
  expect(all.revisions).toEqual({ 'github:owner/home@main': 'a'.repeat(40), 'github:owner/trpg@main': 'b'.repeat(40) });
});

it('commits to the notebook repository a request names', async () => {
  const response = await fetch(`${base}/api/notes/commit`, { method: 'POST', headers, body: JSON.stringify({ repository: 'github:owner/trpg@main', revision: 'b'.repeat(40), message: 'docs: update', notes: [{ path: 'notes/life/note.md', notebookId: 'trpg', content: '# TRPG changed\n', metadata: {} }] }) });
  expect(response.status).toBe(200);
  expect(writes.length).toBeGreaterThan(0);
  expect(new Set(writes.map(write => write.repository))).toEqual(new Set(['owner/trpg']));
});

it("reports each repository's own manifest and commits a manifest to the repository it names", async () => {
  const { body } = await get('/api/workspace');
  const [home, trpg] = body.repositories;
  expect(home).toMatchObject({ title: 'Hosted', defaultNotebook: 'home~life', configRevision: 'a'.repeat(40) });
  expect(trpg).toMatchObject({ title: 'TRPG', defaultNotebook: 'trpg~trpg', configRevision: 'b'.repeat(40), config: { notebooks: [{ id: 'trpg', root: 'notes/life' }] } });
  const put = (configRevision: string) => fetch(`${base}/api/workspace/config`, { method: 'PUT', headers, body: JSON.stringify({ repository: 'github:owner/trpg@main', configRevision, configYaml: 'schema_version: 4\nworkspace:\n  title: Campaign\n  default_notebook: trpg\nnotebooks:\n  - id: trpg\n    title: TRPG\n    root: notes/life\n' }) });
  // A revision the repository no longer holds is refused before anything is written.
  expect((await put('e'.repeat(40))).status).toBe(409);
  expect(writes).toEqual([]);
  const saved = await put('b'.repeat(40));
  expect(saved.status).toBe(200);
  expect(writes.length).toBeGreaterThan(0);
  expect(new Set(writes.map(write => write.repository))).toEqual(new Set(['owner/trpg']));
});
