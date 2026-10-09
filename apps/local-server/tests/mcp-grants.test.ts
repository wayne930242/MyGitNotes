import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import type { SourceConfig, WorkspaceConfigSource, WorkspaceRequest } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { createRecordStore, type RecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

const manifest = (id: string) => `schema_version: 4\nworkspace:\n  title: ${id}\n  default_notebook: ${id}\nnotebooks:\n  - id: ${id}\n    title: ${id}\n    root: notes/${id}\n`;
/** The repositories the fake GitHub serves, each with its own manifest; a request without a token is refused, as for a private repository. */
const repositories: Record<string, Record<string, string>> = { 'owner/repo': { '.mygitnotes.yaml': manifest('ex'), 'notes/ex/a.md': '# A\n' }, 'owner/other': { '.mygitnotes.yaml': manifest('more'), 'notes/more/b.md': '# B\n' } };
const repo: SourceConfig = { type: 'github', repository: 'owner/repo', branch: 'main' };
const other: SourceConfig = { type: 'github', repository: 'owner/other', branch: 'main' };
const ownerCookie = 'gh_notes_session=' + 'o'.repeat(43);
const strangerCookie = 'gh_notes_session=' + 's'.repeat(43);

let root: string, server: Server, base: string, store: RecordStore;
/** What the person whose id is 1 has in their workspace now; the stranger (id 2) always has `owner/other` only. */
let ownerMembers: 'both' | 'repo-hidden' | 'repo-removed';
/** Every request the configuration source was asked about. */
let seen: WorkspaceRequest[];

/** Stands in for a database-backed source: the workspace is the person's a grant names, or the browser session's. */
const configSource: WorkspaceConfigSource = {
  mode: 'remote',
  async settings(request) {
    seen.push(request);
    const person = request.person?.userId ?? (request.headers.cookie === strangerCookie ? 2 : 1);
    if (person === 2) return workspaceSettings([other]);
    if (ownerMembers === 'repo-removed') return workspaceSettings([other]);
    return workspaceSettings([other, [repo, { hidden: ownerMembers === 'repo-hidden' }]]);
  },
};

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-mcp-grants-'));
  ownerMembers = 'both';
  seen = [];
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: '', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '' })) vi.stubEnv(key, value);
  store = createRecordStore(root);
  await store.set(ownerCookie.split('=')[1], { kind: 'session', token: 'owner-token', userId: 1, login: 'owner' });
  await store.set(strangerCookie.split('=')[1], { kind: 'session', token: 'stranger-token', userId: 2, login: 'stranger' });
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const match = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/?]+)(.*)$/.exec(String(url));
    if (!match) return nativeFetch(url, init);
    const [, name, endpoint] = match;
    const files = repositories[name];
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (!files || !new Headers(init?.headers).get('authorization')) return json({ message: 'Not Found' }, 404);
    if (endpoint === '') return json({ private: true, default_branch: 'main', permissions: { push: true } });
    if (endpoint.startsWith('/commits/')) return json({ sha: name === 'owner/repo' ? 'a'.repeat(40) : 'b'.repeat(40), commit: { tree: { sha: `${name}-tree` } } });
    if (endpoint.startsWith('/git/trees/')) return json({ truncated: false, tree: Object.keys(files).map(file => ({ path: file, sha: `${name}:${file}`, type: 'blob', mode: '100644', size: 10 })) });
    if (endpoint.startsWith('/git/blobs/')) return json({ encoding: 'base64', content: Buffer.from(files[decodeURIComponent(endpoint.slice('/git/blobs/'.length)).slice(name.length + 1)] ?? '').toString('base64') });
    return json({});
  });
  server = createServer(createApp(root, { configSource, recordStore: store, remoteCache: undefined }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
  vi.stubEnv('APP_URL', base);
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Makes a grant the way the browser does, signed in as the session's person. */
async function grantFor(cookie: string) {
  const response = await fetch(`${base}/api/auth/agent-token`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ write: false }) });
  expect(response.status).toBe(200);
  return (await response.json()).token as string;
}
/** The grant record a Core from before repository workspaces made: bound to one repository, not to a person and site. */
async function legacyGrant(token: string) {
  const current = await store.get(token);
  const legacy = 'l'.repeat(43);
  await store.set(legacy, { kind: 'agent', ownerId: current.ownerId, credential: current.credential, name: 'Before', createdAt: Date.now(), source: 'github:owner/repo@main', audience: `${base}/mcp`, write: false }, null);
  return legacy;
}
/** The notebook keys an MCP call with `token` lists, sent with `cookie` when given and without any otherwise. */
async function listed(token: string, cookie?: string) {
  const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { Connection: 'close', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_notebooks', arguments: {} } }) });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result.isError).toBeUndefined();
  return (body.result.structuredContent.notebooks as { key: string; }[]).map(notebook => notebook.key);
}

it("resolves a grant's workspace from the person it was made for, with no browser cookie, across every visible repository", async () => {
  const token = await grantFor(ownerCookie);
  expect(await store.get(token)).toMatchObject({ site: 'github', person: { realm: 'github:https://github.com:', userId: 1 } });
  seen = [];
  expect(await listed(token)).toEqual(['other~more', 'repo~ex']);
  expect(seen).toHaveLength(1);
  expect(seen[0].person).toEqual({ realm: 'github:https://github.com:', userId: 1 });
  expect(seen[0].headers).not.toHaveProperty('cookie');
  // Another person's browser cookie beside the grant does not choose the workspace.
  expect(await listed(token, strangerCookie)).toEqual(['other~more', 'repo~ex']);
  expect(seen.at(-1)!.headers).not.toHaveProperty('cookie');
  ownerMembers = 'repo-hidden';
  expect(await listed(token)).toEqual(['other~more']);
});

it('keeps a grant made before repository workspaces to its original repository while it is visible, and lists nothing otherwise', async () => {
  const legacy = await legacyGrant(await grantFor(ownerCookie));
  expect(await listed(legacy)).toEqual(['repo~ex']);
  ownerMembers = 'repo-hidden';
  expect(await listed(legacy)).toEqual([]);
  ownerMembers = 'repo-removed';
  expect(await listed(legacy)).toEqual([]);
  // Still accepted until its owner revokes it.
  ownerMembers = 'both';
  expect(await listed(legacy)).toEqual(['repo~ex']);
});

it('refuses a grant made for another site', async () => {
  const token = await grantFor(ownerCookie);
  await store.set(token, { ...await store.get(token), site: 'github:https://ghe.example.test' }, null);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  expect(response.status).toBe(401);
  expect(warn).toHaveBeenCalledWith('[mcp] unauthorized: grant-site');
  // The owner reads the reason on the grant list.
  const listed = await store.listGrants((await store.get(token)).ownerId);
  expect(listed).toEqual([expect.objectContaining({ site: 'github:https://ghe.example.test', lastRejection: expect.objectContaining({ reason: 'grant-site' }) })]);
});
