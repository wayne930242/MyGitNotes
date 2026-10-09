import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { r2SettingsFromEnv, SourceError, type WorkspaceRequest } from '@mygitnotes/core';
import { type AssetStorage } from '../src/asset-storage.js';
import { createApp } from '../src/app.js';
import { createRecordStore } from '../src/record-store/index.js';

const MANIFEST = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n';
const NOTE = '# Rules\n\n![Keep](r2:r/42/ex/keep.pdf)\n';
const SESSION = 'b'.repeat(43), TOKEN = 'g'.repeat(43);

/** Minimal S3-compatible stand-in for the requests the asset tools send. */
async function startBucket() {
  const objects = new Map<string, Buffer>();
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://bucket'), [, bucket, ...parts] = url.pathname.split('/');
    const key = parts.map(decodeURIComponent).join('/');
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk)).on('end', () => {
      if (bucket !== 'private-assets') return res.writeHead(404).end();
      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') || '';
        const contents = [...objects].filter(([name]) => name.startsWith(prefix)).map(([name, body]) => `<Contents><Key>${name}</Key><Size>${body.length}</Size><LastModified>2026-09-20T00:00:00.000Z</LastModified></Contents>`);
        return res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents.join('')}</ListBucketResult>`);
      }
      if (req.method === 'HEAD') return res.writeHead(objects.has(key) ? 200 : 404).end();
      if (req.method === 'DELETE') {
        objects.delete(key);
        return res.writeHead(204).end();
      }
      if (req.method !== 'PUT') return res.writeHead(405).end();
      if (objects.has(key)) return res.writeHead(412).end();
      objects.set(key, Buffer.concat(chunks));
      res.end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { objects, server, endpoint: `http://127.0.0.1:${(server.address() as { port: number; }).port}` };
}

/** A tenant that owns `r/42/`, meters uploads against a quota and records each size change. */
function tenantStorage(options: { quota?: number; } = {}) {
  const reserved: [string, number][] = [], recorded: [string, number][] = [];
  const storage: AssetStorage = {
    resolve: async () => ({ settings: r2SettingsFromEnv()!, prefix: 'r/42/', limits: { maxObjectBytes: 20 * 1024 * 1024 } }),
    reserve: async (_scope, key, bytes) => {
      reserved.push([key, bytes]);
      if (bytes > (options.quota ?? Infinity)) throw new SourceError('Storage quota exceeded.', 413);
    },
    record: async (_scope, key, delta) => {
      recorded.push([key, delta]);
    },
  };
  return { storage, reserved, recorded };
}

let root: string, server: Server, bucket: Awaited<ReturnType<typeof startBucket>>, base: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-mcp-assets-'));
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (bucket) await new Promise<void>(resolve => bucket.server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A hosted deployment of owner/private whose agent grant may write, over a stand-in GitHub and bucket. */
async function startHosted(assetStorage?: AssetStorage) {
  bucket = await startBucket();
  const files: Record<string, string> = { 'notes/.github-notes.yaml': MANIFEST, 'notes/ex/rules.md': NOTE };
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (!String(url).startsWith('https://api.github.com/repos/owner/private')) return nativeFetch(url, init);
    const endpoint = String(url).replace('https://api.github.com/repos/owner/private', '');
    const value = endpoint === '' ? { private: true, permissions: { push: true } } : endpoint.startsWith('/commits/') ? { sha: 'head', commit: { tree: { sha: 'tree' } } } : endpoint.startsWith('/git/trees/') ? { truncated: false, tree: Object.keys(files).map(file => ({ path: file, sha: file, type: 'blob', mode: '100644' })) } : endpoint.startsWith('/git/blobs/') ? { encoding: 'base64', content: Buffer.from(files[decodeURIComponent(endpoint.slice('/git/blobs/'.length))] || '').toString('base64') } : {};
    return new Response(JSON.stringify(value), { status: 200 });
  });
  const env = { SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', VERCEL: '', GITHUB_NOTES_SOURCE: 'github', GITHUB_NOTES_REPOSITORY: 'owner/private', GITHUB_NOTES_BRANCH: 'main', MYGITNOTES_R2_ACCOUNT_ID: 'acc', MYGITNOTES_R2_ACCESS_KEY_ID: 'AK', MYGITNOTES_R2_SECRET_ACCESS_KEY: 'r2-secret', MYGITNOTES_R2_BUCKET: 'private-assets', MYGITNOTES_R2_ENDPOINT: bucket.endpoint };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  server = createServer(createApp(root, assetStorage ? { assetStorage } : {}));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
  vi.stubEnv('APP_URL', base);
  const store = createRecordStore(root);
  await store.set(SESSION, { kind: 'session', realm: 'github:https://github.com:', login: 'octo', userId: 1, token: 'fixture' });
  await store.set(TOKEN, { kind: 'agent', session: SESSION, source: 'github:owner/private@main', audience: `${base}/mcp`, write: true }, 8 * 3600);
  for (const key of ['r/42/ex/keep.pdf', 'r/42/ex/docs/a.pdf', 'r/43/ex/theirs.pdf', 'ex/unscoped.pdf']) bucket.objects.set(key, Buffer.from(key));
}

/** One MCP tool call, answered with the tool's structured result, or the HTTP response when the route refused it. */
async function callTool(name: string, args: Record<string, unknown>, bodyPadding = 0, { token = TOKEN, cookie }: { token?: string; cookie?: string; } = {}) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + ' '.repeat(bodyPadding);
  const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Connection: 'close', ...(cookie ? { Cookie: cookie } : {}) }, body });
  if (!response.ok) return { status: response.status, body: await response.json() as { error: string; } };
  const result = (await response.json()).result;
  return { status: response.status, isError: result.isError === true, result: JSON.parse(result.content[0].text) };
}
const file = (text: string) => Buffer.from(text).toString('base64');

describe('MCP asset tools through an asset storage', () => {
  it('uploads under the scope prefix, reserving the exact key and size and recording it', async () => {
    const tenant = tenantStorage();
    await startHosted(tenant.storage);
    const uploaded = await callTool('add_asset', { notebookId: 'ex', filename: 'new.pdf', directory: 'docs', base64Content: file('twelve bytes') });
    expect(uploaded).toMatchObject({ isError: false, result: { storage: 'r2', key: 'r/42/ex/docs/new.pdf', reference: 'r2:r/42/ex/docs/new.pdf' } });
    expect(bucket.objects.get('r/42/ex/docs/new.pdf')?.toString()).toBe('twelve bytes');
    expect(bucket.objects.has('ex/docs/new.pdf')).toBe(false);
    expect(tenant.reserved).toEqual([['r/42/ex/docs/new.pdf', 12]]);
    expect(tenant.recorded).toEqual([['r/42/ex/docs/new.pdf', 12]]);
  });

  it('refuses an upload over the quota before sending the body to the bucket', async () => {
    const tenant = tenantStorage({ quota: 5 });
    await startHosted(tenant.storage);
    const refused = await callTool('add_asset', { notebookId: 'ex', filename: 'big.pdf', base64Content: file('twelve bytes') });
    expect(refused).toMatchObject({ isError: true, result: { error: 'Storage quota exceeded.' } });
    expect(bucket.objects.has('r/42/ex/big.pdf')).toBe(false);
    expect(tenant.recorded).toEqual([]);
  });

  it('lists only the objects of the scope, and deletes only inside it, recording the size removed', async () => {
    const tenant = tenantStorage();
    await startHosted(tenant.storage);
    const listed = await callTool('list_assets', { notebookId: 'ex' });
    expect(listed.result.assets.filter((asset: { storage: string; }) => asset.storage === 'r2').map((asset: { key: string; }) => asset.key).sort()).toEqual(['r/42/ex/docs/a.pdf', 'r/42/ex/keep.pdf']);
    for (const key of ['r/43/ex/theirs.pdf', 'ex/unscoped.pdf']) {
      // Another tenant's key names no notebook of this workspace, and a key with a notebook named explicitly is not found in the scope.
      expect(await callTool('delete_asset', { path: `r2:${key}`, force: true })).toMatchObject({ isError: true, result: { error: expect.stringMatching(/not configured|not found/) } });
      expect(await callTool('delete_asset', { path: `r2:${key}`, notebookId: 'ex', force: true })).toMatchObject({ isError: true, result: { error: expect.stringMatching(/not found/) } });
      expect(bucket.objects.has(key)).toBe(true);
    }
    expect(await callTool('delete_asset', { path: 'r2:r/42/ex/docs/a.pdf' })).toMatchObject({ isError: false, result: { storage: 'r2', key: 'r/42/ex/docs/a.pdf' } });
    expect(bucket.objects.has('r/42/ex/docs/a.pdf')).toBe(false);
    expect(tenant.recorded).toEqual([['r/42/ex/docs/a.pdf', -'r/42/ex/docs/a.pdf'.length]]);
    // A note that still links the object keeps it unless forced.
    expect(await callTool('delete_asset', { path: 'r2:r/42/ex/keep.pdf' })).toMatchObject({ isError: true, result: { error: expect.stringContaining('still referenced') } });
  });

  it('keeps committing the asset to Git when the storage has no bucket for the call', async () => {
    await startHosted({ resolve: async () => null });
    const list = await callTool('list_assets', { notebookId: 'ex' });
    expect(list.result.assets.every((asset: { storage: string; }) => asset.storage === 'git')).toBe(true);
    expect(await callTool('delete_asset', { path: 'r2:ex/unscoped.pdf' })).toMatchObject({ isError: true, result: { error: 'R2 storage is not configured.' } });
    expect(bucket.objects.has('ex/unscoped.pdf')).toBe(true);
  });

  it('takes the bucket from the environment by default, as the community edition does', async () => {
    await startHosted();
    const uploaded = await callTool('add_asset', { notebookId: 'ex', filename: 'plain.pdf', base64Content: file('plain') });
    expect(uploaded).toMatchObject({ isError: false, result: { key: 'ex/plain.pdf' } });
    expect(bucket.objects.has('ex/plain.pdf')).toBe(true);
  });
});

describe('the person an MCP upload is charged to', () => {
  it("is the grant's person even when another person's browser cookie comes with the call", async () => {
    // Stands in for an edition that, like Pro before it read request.person first, takes a browser session over the grant's person.
    const seen: { cookie?: string; person?: unknown; }[] = [];
    const storage: AssetStorage = {
      resolve: async req => {
        const request = req as typeof req & WorkspaceRequest;
        seen.push({ cookie: req.headers.cookie, person: request.person });
        const who = req.headers.cookie ? 'stranger' : request.person?.userId;
        return { settings: r2SettingsFromEnv()!, prefix: `r/${who}/`, limits: { maxObjectBytes: 20 * 1024 * 1024 } };
      },
    };
    await startHosted(storage);
    const granted = 'p'.repeat(43);
    await createRecordStore(root).set(granted, { kind: 'agent', session: SESSION, site: 'github', person: { realm: 'github:https://github.com:', userId: 42 }, audience: `${base}/mcp`, write: true }, 8 * 3600);
    const uploaded = await callTool('add_asset', { notebookId: 'ex', filename: 'mine.pdf', base64Content: file('mine') }, 0, { token: granted, cookie: `gh_notes_session=${'s'.repeat(43)}` });
    expect(uploaded).toMatchObject({ isError: false, result: { storage: 'r2', key: 'r/42/ex/mine.pdf' } });
    expect(bucket.objects.has('r/stranger/ex/mine.pdf')).toBe(false);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(request => request.cookie === undefined)).toBe(true);
    expect(seen[0].person).toEqual({ realm: 'github:https://github.com:', userId: 42 });
  });
});

describe('the MCP body limit follows the asset storage', () => {
  const nineMiB = 9 * 1024 * 1024;

  it('accepts an upload past the ordinary limit when the storage has a bucket for the caller', async () => {
    await startHosted(tenantStorage().storage);
    const big = await callTool('add_asset', { notebookId: 'ex', filename: 'scan.pdf', base64Content: file('scan') }, nineMiB);
    expect(big).toMatchObject({ isError: false, result: { key: 'r/42/ex/scan.pdf' } });
  });

  it('keeps the ordinary limit when the storage has no bucket, even if the environment names one', async () => {
    await startHosted({ resolve: async () => null });
    const big = await callTool('list_assets', { notebookId: 'ex' }, nineMiB);
    expect(big).toMatchObject({ status: 413, body: { error: expect.stringContaining('too large') } });
  });

  it('refuses a body past the upload ceiling and answers a small call without asking the storage', async () => {
    const tenant = tenantStorage();
    const resolve = vi.spyOn(tenant.storage, 'resolve');
    await startHosted(tenant.storage);
    expect((await callTool('list_assets', { notebookId: 'ex' }, 65 * 1024 * 1024)).status).toBe(413);
    resolve.mockClear();
    // An ordinary call that declares its size resolves the scope once, for the tool itself, not for the body limit.
    await callTool('list_assets', { notebookId: 'ex' });
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
