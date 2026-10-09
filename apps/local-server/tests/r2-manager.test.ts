import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { assetHash, deriveAlias, GitHubSource, notebookKey, r2SettingsFromEnv, type RemoteChange, SourceError } from '@mygitnotes/core';
import { type AppServices, createApp } from '../src/app.js';
import type { AssetScope, AssetStorage } from '../src/asset-storage.js';

let remoteToken: string | undefined;
vi.mock('../src/auth.js', async original => ({ ...await original<typeof import('../src/auth.js')>(), authToken: async () => remoteToken }));

const MANIFEST = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n  - id: other\n    title: Other\n    root: notes/other\n';
const NOTE = '# Rules\n\n![Core](<r2:ex/old/Core Rules.pdf>)\n[map](r2:ex/old/map.webp) [keep](r2:ex/keep.pdf)\n';

/** Minimal S3-compatible stand-in recording every request. */
async function startBucket() {
  const objects = new Map<string, Buffer>(), requests: string[] = [], hooks: { onCopy?: () => void; } = {};
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://bucket'), [, bucket, ...parts] = url.pathname.split('/');
    const key = parts.map(decodeURIComponent).join('/');
    requests.push(`${req.method} ${key}${req.headers['x-amz-copy-source'] ? ' <- ' + decodeURIComponent(String(req.headers['x-amz-copy-source'])) : ''}`);
    if (bucket !== 'private-assets') {
      res.statusCode = 404;
      return res.end();
    }
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk)).on('end', () => {
      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') || '';
        const contents = [...objects].filter(([name]) => name.startsWith(prefix)).map(([name, body]) => `<Contents><Key>${name.replace(/&/g, '&amp;')}</Key><Size>${body.length}</Size><LastModified>2026-09-16T00:00:00.000Z</LastModified></Contents>`);
        return res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents.join('')}</ListBucketResult>`);
      }
      if (req.method === 'HEAD') {
        res.statusCode = objects.has(key) ? 200 : 404;
        return res.end();
      }
      if (req.method === 'PUT') {
        if (req.headers['if-none-match'] === '*' && objects.has(key)) {
          res.statusCode = 412;
          return res.end();
        }
        const copy = req.headers['x-amz-copy-source'];
        if (copy) {
          const from = decodeURIComponent(String(copy)).split('/').slice(2).join('/');
          if (!objects.has(from)) {
            res.statusCode = 404;
            return res.end();
          }
          objects.set(key, objects.get(from)!);
          hooks.onCopy?.();
        } else objects.set(key, Buffer.concat(chunks));
        return res.end('<CopyObjectResult/>');
      }
      if (req.method === 'DELETE') {
        objects.delete(key);
        res.statusCode = 204;
        return res.end();
      }
      res.statusCode = objects.has(key) ? 200 : 404;
      res.end(objects.get(key));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { objects, requests, hooks, server, endpoint: `http://127.0.0.1:${(server.address() as any).port}` };
}

let root: string, app: Server, base: string, bucket: Awaited<ReturnType<typeof startBucket>>;
/** The home repository's alias: a local worktree's directory name, a hosted repository's name. */
let alias = '';
const nb = (id: string) => notebookKey(alias, id);
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
async function start(env: Record<string, string>, services: Partial<AppServices> = {}) {
  bucket = await startBucket();
  const settings = { MYGITNOTES_R2_ACCOUNT_ID: 'acc', MYGITNOTES_R2_ACCESS_KEY_ID: 'AK', MYGITNOTES_R2_SECRET_ACCESS_KEY: 'r2-secret', MYGITNOTES_R2_BUCKET: 'private-assets', MYGITNOTES_R2_ENDPOINT: bucket.endpoint };
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', APP_URL: '', VERCEL: '', ...settings, ...env })) vi.stubEnv(key, value);
  app = createServer(createApp(root, services));
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(app.address() as any).port}`;
}
async function startLocal(branch = 'main', services: Partial<AppServices> = {}) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-r2-manager-'));
  alias = deriveAlias(root, new Set());
  fs.mkdirSync(path.join(root, 'notes/ex'), { recursive: true });
  fs.mkdirSync(path.join(root, 'notes/other'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github-notes.yaml'), MANIFEST);
  fs.writeFileSync(path.join(root, 'notes/ex/rules.md'), NOTE);
  fs.writeFileSync(path.join(root, 'notes/other/cross.md'), '![x](r2:ex/old/map.webp)\n');
  fs.writeFileSync(path.join(root, 'notes/ex/plain.md'), '# Plain\n');
  git('init', '-b', branch);
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('add', '.');
  git('commit', '-m', 'fixture');
  await start({ MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: root }, services);
  for (const key of ['ex/old/Core Rules.pdf', 'ex/old/map.webp', 'ex/keep.pdf', 'other/secret.pdf']) bucket.objects.set(key, Buffer.from(key));
}
const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => fetch(base + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const operations = (notebookId = nb('ex')) => [() => call('GET', `/api/r2?notebookId=${notebookId}`), () => call('GET', `/api/r2/raw?notebookId=${notebookId}&key=ex/keep.pdf`), () => call('GET', `/api/r2/references?notebookId=${notebookId}&key=ex/keep.pdf`), () => call('POST', '/api/r2/upload', { notebookId, key: 'ex/new.pdf', size: 10 }), () => call('POST', '/api/r2/mkdir', { notebookId, key: 'ex/folder' }), () => call('POST', '/api/r2/move', { notebookId, key: 'ex/keep.pdf', destination: 'ex/moved.pdf' }), () => call('POST', '/api/r2/delete', { notebookId, key: 'ex/keep.pdf' })];

afterEach(async () => {
  if (app) await new Promise<void>(resolve => app.close(() => resolve()));
  if (bucket) await new Promise<void>(resolve => bucket.server.close(() => resolve()));
  if (root) fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('R2 management on a local workspace', () => {
  it('signs the declared Content-Length into a direct upload and refuses an upload without one', async () => {
    await startLocal();
    const upload = await call('POST', '/api/r2/upload', { notebookId: nb('ex'), key: 'ex/docs/sized.pdf', size: 1234 }).then(r => r.json());
    const url = new URL(upload.url);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;host;if-none-match');
    for (const size of [undefined, -1, 1.5, '12', null]) expect((await call('POST', '/api/r2/upload', { notebookId: nb('ex'), key: 'ex/docs/bad.pdf', size })).status).toBe(400);
    expect((await call('POST', '/api/r2/upload', { notebookId: nb('ex'), key: 'ex/docs/huge.pdf', size: 6 * 1024 ** 3 })).status).toBe(413);
  });

  it('lists the whole bucket and previews through a presigned redirect', async () => {
    await startLocal();
    bucket.objects.set('top.pdf', Buffer.from('top'));
    const listing = await call('GET', `/api/r2?notebookId=${nb('ex')}`).then(r => r.json());
    expect(listing.prefix).toBe('');
    expect(listing.objects.map((object: any) => object.key).sort()).toEqual(['ex/keep.pdf', 'ex/old/Core Rules.pdf', 'ex/old/map.webp', 'other/secret.pdf', 'top.pdf']);
    const raw = await call('GET', `/api/r2/raw?notebookId=${nb('ex')}&key=ex/keep.pdf&download=1`);
    expect(raw.status).toBe(302);
    const location = new URL(raw.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(`${bucket.endpoint}/private-assets/ex/keep.pdf`);
    expect(location.searchParams.get('response-content-disposition')).toMatch(/^attachment;/);
    expect(raw.headers.get('location')).not.toContain('r2-secret');
  });

  it('presigns a direct upload, rejects existing keys and creates folders', async () => {
    await startLocal();
    const upload = await call('POST', '/api/r2/upload', { notebookId: nb('ex'), key: 'ex/docs/big file.pdf', size: 1234 }).then(r => r.json());
    expect(new URL(upload.url).pathname).toBe('/private-assets/ex/docs/big%20file.pdf');
    expect(new URL(upload.url).searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(new URL(upload.url).searchParams.get('X-Amz-SignedHeaders')).toContain('if-none-match');
    expect(bucket.objects.has('ex/docs/big file.pdf')).toBe(false);
    expect((await call('POST', '/api/r2/upload', { notebookId: nb('ex'), key: 'ex/keep.pdf', size: 1 })).status).toBe(409);
    expect((await call('POST', '/api/r2/mkdir', { notebookId: nb('ex'), key: 'ex/new folder' })).status).toBe(200);
    expect(bucket.objects.get('ex/new folder/.keep')).toEqual(Buffer.alloc(0));
    expect((await call('POST', '/api/r2/mkdir', { notebookId: nb('ex'), key: 'ex/old' })).status).toBe(409);
  });

  it('moves a folder, rewrites every referencing note and removes the originals', async () => {
    await startLocal();
    const references = await call('GET', `/api/r2/references?notebookId=${nb('ex')}&key=ex/old&directory=1`).then(r => r.json());
    expect(references.objects.sort()).toEqual(['ex/old/Core Rules.pdf', 'ex/old/map.webp']);
    expect(references.notes).toEqual([{ notebookId: nb('ex'), path: 'notes/ex/rules.md' }, { notebookId: nb('other'), path: 'notes/other/cross.md' }]);
    const moved = await call('POST', '/api/r2/move', { notebookId: nb('ex'), key: 'ex/old', destination: 'ex/archive/2026', directory: true });
    expect(moved.status).toBe(200);
    expect((await moved.json()).notes).toEqual([{ notebookId: nb('ex'), path: 'notes/ex/rules.md' }, { notebookId: nb('other'), path: 'notes/other/cross.md' }]);
    expect([...bucket.objects.keys()].sort()).toEqual(['ex/archive/2026/Core Rules.pdf', 'ex/archive/2026/map.webp', 'ex/keep.pdf', 'other/secret.pdf']);
    expect(fs.readFileSync(path.join(root, 'notes/ex/rules.md'), 'utf8')).toBe('# Rules\n\n![Core](<r2:ex/archive/2026/Core Rules.pdf>)\n[map](r2:ex/archive/2026/map.webp) [keep](r2:ex/keep.pdf)\n');
    expect(fs.readFileSync(path.join(root, 'notes/other/cross.md'), 'utf8')).toBe('![x](r2:ex/archive/2026/map.webp)\n');
    expect(fs.readFileSync(path.join(root, 'notes/ex/plain.md'), 'utf8')).toBe('# Plain\n');
  });

  it('refuses a move onto an existing key without touching objects or notes', async () => {
    await startLocal();
    bucket.objects.set('ex/new/map.webp', Buffer.from('taken'));
    expect((await call('POST', '/api/r2/move', { notebookId: nb('ex'), key: 'ex/old', destination: 'ex/new', directory: true })).status).toBe(409);
    expect(bucket.objects.has('ex/old/map.webp')).toBe(true);
    expect(bucket.objects.has('ex/new/Core Rules.pdf')).toBe(false);
    expect(fs.readFileSync(path.join(root, 'notes/ex/rules.md'), 'utf8')).toBe(NOTE);
    expect((await call('POST', '/api/r2/move', { notebookId: nb('ex'), key: 'ex/old', destination: 'ex/old/inner', directory: true })).status).toBe(400);
  });

  it('refuses a move whose referencing note changed during the copies and rolls the copies back', async () => {
    await startLocal();
    const edited = NOTE + '\nSaved while copying.\n';
    bucket.hooks.onCopy = () => fs.writeFileSync(path.join(root, 'notes/ex/rules.md'), edited);
    expect((await call('POST', '/api/r2/move', { notebookId: nb('ex'), key: 'ex/old', destination: 'ex/archive', directory: true })).status).toBe(409);
    expect(fs.readFileSync(path.join(root, 'notes/ex/rules.md'), 'utf8')).toBe(edited);
    expect(fs.readFileSync(path.join(root, 'notes/other/cross.md'), 'utf8')).toBe('![x](r2:ex/old/map.webp)\n');
    expect([...bucket.objects.keys()].sort()).toEqual(['ex/keep.pdf', 'ex/old/Core Rules.pdf', 'ex/old/map.webp', 'other/secret.pdf']);
  });

  it('deletes a file or folder and leaves notes unchanged', async () => {
    await startLocal();
    expect((await call('POST', '/api/r2/delete', { notebookId: nb('ex'), key: 'ex/keep.pdf' })).status).toBe(200);
    expect((await call('POST', '/api/r2/delete', { notebookId: nb('ex'), key: 'ex/old', directory: true }).then(r => r.json())).deleted.sort()).toEqual(['ex/old/Core Rules.pdf', 'ex/old/map.webp']);
    expect([...bucket.objects.keys()]).toEqual(['other/secret.pdf']);
    expect(fs.readFileSync(path.join(root, 'notes/ex/rules.md'), 'utf8')).toBe(NOTE);
    expect((await call('POST', '/api/r2/delete', { notebookId: nb('ex'), key: 'ex/keep.pdf' })).status).toBe(404);
  });

  it('manages keys outside notebook prefixes, including the bucket root', async () => {
    await startLocal();
    expect((await call('GET', `/api/r2/raw?notebookId=${nb('ex')}&key=other/secret.pdf`)).status).toBe(302);
    expect((await call('POST', '/api/r2/upload', { notebookId: nb('ex'), key: 'top.pdf', size: 3 })).status).toBe(200);
    expect((await call('POST', '/api/r2/mkdir', { notebookId: nb('ex'), key: 'trpg' })).status).toBe(200);
    expect(bucket.objects.has('trpg/.keep')).toBe(true);
    const moved = await call('POST', '/api/r2/move', { notebookId: nb('ex'), key: 'ex/old/map.webp', destination: 'trpg/map.webp' });
    expect(moved.status).toBe(200);
    expect(fs.readFileSync(path.join(root, 'notes/other/cross.md'), 'utf8')).toBe('![x](r2:trpg/map.webp)\n');
    expect((await call('POST', '/api/r2/delete', { notebookId: nb('ex'), key: 'other/secret.pdf' })).status).toBe(200);
    expect(bucket.objects.has('other/secret.pdf')).toBe(false);
  });

  it('rejects keys escaping the bucket', async () => {
    await startLocal();
    expect((await call('GET', `/api/r2/raw?notebookId=${nb('ex')}&key=/other/secret.pdf`)).status).toBe(403);
    expect((await call('POST', '/api/r2/delete', { notebookId: nb('ex'), key: 'ex/../other/secret.pdf' })).status).toBe(403);
    expect((await call('POST', '/api/r2/move', { notebookId: nb('ex'), key: 'ex/keep.pdf', destination: '../stolen.pdf' })).status).toBe(403);
    expect((await call('POST', '/api/r2/upload', { notebookId: nb('ex'), key: 'ex//new.pdf', size: 3 })).status).toBe(403);
    expect((await call('POST', '/api/r2/mkdir', { notebookId: nb('ex'), key: '../escape' })).status).toBe(403);
    expect(bucket.objects.has('other/secret.pdf')).toBe(true);
    expect(bucket.objects.has('ex/keep.pdf')).toBe(true);
  });

  it('denies every operation off the main branch without contacting the bucket', async () => {
    await startLocal('core');
    for (const operation of operations()) expect((await operation()).status).toBe(403);
    expect(bucket.requests).toEqual([]);
    expect(bucket.objects.has('ex/keep.pdf')).toBe(true);
  });
});

/** A tenant that owns the key space under `prefix`, meters its uploads (confirmed or pending) and keeps one size row per key. */
function tenantStorage(prefix: string, options: { quota?: number; rekey?: boolean; } = {}) {
  const reserved: [string, number][] = [], recorded: [string, number][] = [], movedKeys: [string, string, number][] = [];
  const pending = new Map<string, number>(), rows = new Map<string, number>();
  const used = (except?: string) => [...rows, ...pending].filter(([key]) => key !== except).reduce((sum, [, bytes]) => sum + bytes, 0);
  const storage: AssetStorage = {
    resolve: async () => ({ settings: r2SettingsFromEnv()!, prefix, limits: { maxObjectBytes: 1000 } }),
    reserve: async (_scope, key, bytes) => {
      reserved.push([key, bytes]);
      if (used(key) + bytes > (options.quota ?? Infinity)) throw new SourceError('Storage quota exceeded.', 413);
      pending.set(key, bytes);
    },
    record: async (_scope, key, delta) => {
      recorded.push([key, delta]);
      pending.delete(key);
      if (delta > 0) rows.set(key, delta);
      else rows.delete(key);
    },
    ...options.rekey && {
      moved: async (_scope: AssetScope, from: string, to: string, bytes: number) => {
        movedKeys.push([from, to, bytes]);
        rows.delete(from);
        rows.set(to, bytes);
      },
    },
  };
  return { storage, reserved, recorded, movedKeys, rows, used };
}

describe('R2 management through an asset storage', () => {
  /** Serves the tenant's prefix from the stand-in bucket, resolving settings from the deployment environment. */
  async function startTenant(prefix: string, options: { quota?: number; rekey?: boolean; } = {}) {
    const tenant = tenantStorage(prefix, options);
    await startLocal('main', { assetStorage: tenant.storage });
    for (const key of ['r/42/ex/keep.pdf', 'r/42/ex/old/map.webp', 'r/43/ex/theirs.pdf']) bucket.objects.set(key, Buffer.from(key));
    bucket.requests.length = 0;
    return tenant;
  }

  it('lists only the tenant prefix and reports it as the listing root', async () => {
    await startTenant('r/42/');
    const listing = await call('GET', `/api/r2?notebookId=${nb('ex')}`).then(r => r.json());
    expect(listing.prefix).toBe('r/42/');
    expect(listing.objects.map((object: any) => object.key).sort()).toEqual(['r/42/ex/keep.pdf', 'r/42/ex/old/map.webp']);
  });

  it('answers 404 for a key outside the prefix in every route, without contacting the bucket', async () => {
    await startTenant('r/42/');
    const theirs = 'r/43/ex/theirs.pdf', outside = 'ex/keep.pdf';
    for (const key of [theirs, outside, 'r/42', 'r/4']) {
      const calls = [call('GET', `/api/r2/raw?notebookId=${nb('ex')}&key=${encodeURIComponent(key)}`), call('GET', `/api/r2/references?notebookId=${nb('ex')}&key=${encodeURIComponent(key)}`), call('POST', '/api/r2/upload', { notebookId: nb('ex'), key, size: 1 }), call('POST', '/api/r2/uploaded', { notebookId: nb('ex'), key }), call('POST', '/api/r2/mkdir', { notebookId: nb('ex'), key }), call('POST', '/api/r2/move', { notebookId: nb('ex'), key, destination: 'r/42/ex/moved.pdf' }), call('POST', '/api/r2/move', { notebookId: nb('ex'), key: 'r/42/ex/keep.pdf', destination: key }), call('POST', '/api/r2/delete', { notebookId: nb('ex'), key })];
      expect((await Promise.all(calls)).map(response => response.status)).toEqual(calls.map(() => 404));
    }
    expect(bucket.requests).toEqual([]);
    expect([...bucket.objects.keys()].filter(key => key.startsWith('r/')).sort()).toEqual(['r/42/ex/keep.pdf', 'r/42/ex/old/map.webp', 'r/43/ex/theirs.pdf']);
    expect(bucket.objects.has('ex/keep.pdf')).toBe(true);
  });

  it('serves a key inside the prefix', async () => {
    await startTenant('r/42/');
    expect((await call('GET', `/api/r2/raw?notebookId=${nb('ex')}&key=r/42/ex/keep.pdf`)).status).toBe(302);
    expect((await call('POST', '/api/r2/mkdir', { notebookId: nb('ex'), key: 'r/42/ex/new' })).status).toBe(200);
  });

  it('reserves the key and declared size before signing and refuses an upload over the quota or the object limit', async () => {
    const tenant = await startTenant('r/42/', { quota: 500 });
    expect((await call('POST', '/api/r2/upload', { notebookId: nb('ex'), key: 'r/42/ex/a.pdf', size: 400 })).status).toBe(200);
    expect(tenant.reserved).toEqual([['r/42/ex/a.pdf', 400]]);
    // The browser sends the body straight to the bucket; the stand-in bucket gets it here.
    bucket.objects.set('r/42/ex/a.pdf', Buffer.alloc(400));
    expect((await call('POST', '/api/r2/uploaded', { notebookId: nb('ex'), key: 'r/42/ex/a.pdf' })).status).toBe(200);
    expect(tenant.recorded).toContainEqual(['r/42/ex/a.pdf', 400]);
    const over = await call('POST', '/api/r2/upload', { notebookId: nb('ex'), key: 'r/42/ex/b.pdf', size: 200 });
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: 'Storage quota exceeded.' });
    expect((await call('POST', '/api/r2/upload', { notebookId: nb('ex'), key: 'r/42/ex/c.pdf', size: 1001 })).status).toBe(413);
    expect(tenant.reserved).toEqual([['r/42/ex/a.pdf', 400], ['r/42/ex/b.pdf', 200]]);
  });

  it('counts a signed upload the browser never confirms, so skipping /uploaded saves no quota', async () => {
    const tenant = await startTenant('r/42/', { quota: 500 });
    expect((await call('POST', '/api/r2/upload', { notebookId: nb('ex'), key: 'r/42/ex/a.pdf', size: 400 })).status).toBe(200);
    expect(tenant.recorded).toEqual([]);
    expect((await call('POST', '/api/r2/upload', { notebookId: nb('ex'), key: 'r/42/ex/b.pdf', size: 200 })).status).toBe(413);
    expect(tenant.used()).toBe(400);
  });

  it('confirms an upload by key and changes nothing when the browser confirms it again', async () => {
    const tenant = await startTenant('r/42/');
    expect((await call('POST', '/api/r2/upload', { notebookId: nb('ex'), key: 'r/42/ex/a.pdf', size: 400 })).status).toBe(200);
    bucket.objects.set('r/42/ex/a.pdf', Buffer.alloc(400));
    for (let confirmation = 0; confirmation < 3; confirmation++) expect((await call('POST', '/api/r2/uploaded', { notebookId: nb('ex'), key: 'r/42/ex/a.pdf' })).status).toBe(200);
    // Every confirmation carries the same key and the size the bucket reports, which a per-key storage keeps once.
    expect(tenant.recorded).toEqual(Array(3).fill(['r/42/ex/a.pdf', 400]));
    expect(tenant.used()).toBe(400);
    expect((await call('POST', '/api/r2/uploaded', { notebookId: nb('ex'), key: 'r/42/ex/never-uploaded.pdf' })).status).toBe(404);
  });

  it('records the size of every object a move or delete creates and removes', async () => {
    const tenant = await startTenant('r/42/');
    expect((await call('POST', '/api/r2/move', { notebookId: nb('ex'), key: 'r/42/ex/old', destination: 'r/42/ex/archive', directory: true })).status).toBe(200);
    const size = Buffer.from('r/42/ex/old/map.webp').length;
    expect(tenant.recorded).toEqual([['r/42/ex/archive/map.webp', size], ['r/42/ex/old/map.webp', -size]]);
    tenant.recorded.length = 0;
    expect((await call('POST', '/api/r2/delete', { notebookId: nb('ex'), key: 'r/42/ex/keep.pdf' })).status).toBe(200);
    expect(tenant.recorded).toEqual([['r/42/ex/keep.pdf', -Buffer.from('r/42/ex/keep.pdf').length]]);
    expect((await call('POST', '/api/r2/mkdir', { notebookId: nb('ex'), key: 'r/42/ex/empty' })).status).toBe(200);
    expect(tenant.recorded.at(-1)).toEqual(['r/42/ex/empty/.keep', 0]);
  });

  it('tells a storage that re-keys which key each moved object went to, and records no size change for the move', async () => {
    const tenant = await startTenant('r/42/', { rekey: true });
    tenant.rows.set('r/42/ex/old/map.webp', 7);
    expect((await call('POST', '/api/r2/move', { notebookId: nb('ex'), key: 'r/42/ex/old', destination: 'r/42/ex/archive', directory: true })).status).toBe(200);
    expect(tenant.movedKeys).toEqual([['r/42/ex/old/map.webp', 'r/42/ex/archive/map.webp', Buffer.from('r/42/ex/old/map.webp').length]]);
    expect(tenant.recorded).toEqual([]);
    expect(bucket.objects.has('r/42/ex/archive/map.webp')).toBe(true);
    expect(bucket.objects.has('r/42/ex/old/map.webp')).toBe(false);
    expect(tenant.rows.has('r/42/ex/old/map.webp')).toBe(false);
  });

  it('tells a storage that re-keys nothing when a move is undone', async () => {
    const tenant = await startTenant('r/42/', { rekey: true });
    const note = '![map](r2:r/42/ex/old/map.webp)\n';
    fs.writeFileSync(path.join(root, 'notes/ex/rules.md'), note);
    bucket.hooks.onCopy = () => fs.writeFileSync(path.join(root, 'notes/ex/rules.md'), `${note}Saved while copying.\n`);
    expect((await call('POST', '/api/r2/move', { notebookId: nb('ex'), key: 'r/42/ex/old', destination: 'r/42/ex/archive', directory: true })).status).toBe(409);
    expect(tenant.movedKeys).toEqual([]);
    expect(tenant.recorded).toEqual([]);
    expect(bucket.objects.has('r/42/ex/archive/map.webp')).toBe(false);
  });

  it('answers 404 when the storage has no bucket for the request', async () => {
    await startLocal('main', { assetStorage: { resolve: async () => null } });
    for (const operation of operations()) expect((await operation()).status).toBe(404);
    expect(bucket.requests).toEqual([]);
  });
});

describe('R2 asset scope prefixes', () => {
  it('refuses a scope whose prefix could reach a sibling folder, without contacting the bucket', async () => {
    await startLocal('main', { assetStorage: { resolve: async () => ({ settings: r2SettingsFromEnv()!, prefix: 'r/42', limits: { maxObjectBytes: 1000 } }) } });
    bucket.requests.length = 0;
    for (const operation of operations()) {
      const response = await operation();
      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/must be empty or end in "\/"/);
    }
    expect(bucket.requests).toEqual([]);
  });
});

describe('R2 management on a hosted workspace', () => {
  const files = new Map<string, Buffer>();
  let revision = 'one', canPush = true;
  const published: RemoteChange[][] = [];
  async function startRemote(token: string | undefined) {
    root = '';
    files.clear();
    published.length = 0;
    revision = 'one';
    files.set('.github-notes.yaml', Buffer.from(MANIFEST));
    files.set('notes/ex/rules.md', Buffer.from(NOTE));
    remoteToken = token;
    const prototype = GitHubSource.prototype as any;
    vi.spyOn(prototype, 'loadSnapshot').mockImplementation(async () => ({ sha: revision, treeSha: revision, info: { private: true, permissions: { push: canPush }, default_branch: 'main' }, entries: [...files].map(([file, bytes]) => ({ path: file, type: 'blob', mode: '100644', sha: assetHash(bytes), size: bytes.length })) }));
    vi.spyOn(prototype, 'readBlob').mockImplementation(async (...args: unknown[]) => [...files.values()].find(bytes => assetHash(bytes) === args[0])!);
    vi.spyOn(prototype, 'publishChanges').mockImplementation(async (...args: unknown[]) => {
      const changes = args[0] as RemoteChange[];
      published.push(changes);
      for (const change of changes) files.set(change.path, Buffer.from(change.content!));
      return revision += '-next';
    });
    alias = 'notes';
    await start({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'example/notes', MYGITNOTES_BRANCH: 'main' });
    for (const key of ['ex/old/Core Rules.pdf', 'ex/old/map.webp', 'ex/keep.pdf']) bucket.objects.set(key, Buffer.from(key));
  }

  it('commits note rewrites for a writer', async () => {
    canPush = true;
    await startRemote('writer-token');
    expect((await call('GET', `/api/r2?notebookId=${nb('ex')}`)).status).toBe(200);
    expect((await call('POST', '/api/r2/move', { notebookId: nb('ex'), key: 'ex/old/map.webp', destination: 'ex/maps/region.webp' })).status).toBe(200);
    expect(published).toHaveLength(1);
    expect(published[0].map(change => change.path)).toEqual(['notes/ex/rules.md']);
    expect(files.get('notes/ex/rules.md')!.toString()).toContain('[map](r2:ex/maps/region.webp)');
    expect(bucket.objects.has('ex/maps/region.webp')).toBe(true);
    expect(bucket.objects.has('ex/old/map.webp')).toBe(false);
  });

  it('answers a confirmed upload without a bucket or a fresh snapshot when no quota needs settling', async () => {
    canPush = true;
    await startRemote('writer-token');
    const snapshots = (GitHubSource.prototype as any).loadSnapshot as ReturnType<typeof vi.fn>;
    await call('GET', '/api/workspace');
    snapshots.mockClear();
    const response = await call('POST', '/api/r2/uploaded', { notebookId: nb('ex'), key: 'ex/docs/new.pdf' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ key: 'ex/docs/new.pdf' });
    expect(bucket.requests).toEqual([]);
    const confirmed = snapshots.mock.calls.length;
    snapshots.mockClear();
    // A route that checks write access loads one more, fresh, snapshot than the request itself needs.
    await call('GET', `/api/r2/raw?notebookId=${nb('ex')}&key=ex/keep.pdf`);
    expect(confirmed).toBeLessThan(snapshots.mock.calls.length);
    expect((await call('POST', '/api/r2/uploaded', { notebookId: nb('ex'), key: '../escape' })).status).toBe(403);
  });

  it('rolls copied objects back when the rewrite commit hits a revision conflict', async () => {
    canPush = true;
    await startRemote('writer-token');
    bucket.hooks.onCopy = () => {
      revision = 'moved-on';
    };
    expect((await call('POST', '/api/r2/move', { notebookId: nb('ex'), key: 'ex/old/map.webp', destination: 'ex/maps/region.webp' })).status).toBe(409);
    expect(published).toEqual([]);
    expect(files.get('notes/ex/rules.md')!.toString()).toBe(NOTE);
    expect([...bucket.objects.keys()].sort()).toEqual(['ex/keep.pdf', 'ex/old/Core Rules.pdf', 'ex/old/map.webp']);
  });

  it('scans a large notebook for references without fanning out concurrent GitHub reads', async () => {
    canPush = true;
    await startRemote('writer-token');
    for (let index = 0; index < 200; index++) files.set(`notes/ex/note-${index}.md`, Buffer.from(`# Note ${index}\n\n[map](r2:ex/old/map.webp) ${index}\n`));
    const prototype = GitHubSource.prototype as any, read = prototype.readBlob;
    let active = 0, peak = 0;
    read.mockImplementation(async (sha: unknown) => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return [...files.values()].find(bytes => assetHash(bytes) === sha)!;
    });
    const prefetch = vi.spyOn(prototype, 'prefetchFiles').mockResolvedValue(undefined);
    const response = await call('GET', `/api/r2/references?notebookId=${nb('ex')}&key=ex/old&directory=1`);
    expect(response.status).toBe(200);
    expect((await response.json()).notes).toHaveLength(201);
    expect(prefetch).toHaveBeenCalledWith(expect.arrayContaining(['notes/ex/rules.md', 'notes/ex/note-199.md']));
    expect(peak).toBe(1);
    read.mockRejectedValue(new SourceError('GitHub API is temporarily rate limited. Retry in 7 seconds.', 429, 7));
    // Blobs read above are now in the shared cache; a new note forces an uncached platform read.
    files.set('notes/ex/note-new.md', Buffer.from('# New\n\n[map](r2:ex/old/map.webp)\n'));
    const limited = await call('GET', `/api/r2/references?notebookId=${nb('ex')}&key=ex/old&directory=1`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('7');
    expect((await limited.json()).retryAfter).toBe(7);
  });

  it('rejects note reference scanning when notebook text exceeds 32 MiB', async () => {
    canPush = true;
    await startRemote('writer-token');
    const prototype = GitHubSource.prototype as any;
    const hugeEntries = Array.from({ length: 8 }, (_, i) => ({ path: `notes/ex/chunk-${i}.md`, type: 'blob', mode: '100644', sha: `chunk-${i}-sha`, size: 4.5 * 1024 * 1024 }));
    vi.spyOn(prototype, 'loadSnapshot').mockImplementation(async () => ({ sha: revision, treeSha: revision, info: { private: true, permissions: { push: canPush }, default_branch: 'main' }, entries: [...[...files].map(([file, bytes]) => ({ path: file, type: 'blob', mode: '100644', sha: assetHash(bytes), size: bytes.length })), ...hugeEntries] }));
    const response = await call('GET', `/api/r2/references?notebookId=${nb('ex')}&key=ex/old&directory=1`);
    const body = await response.json();
    expect(response.status).toBe(413);
    expect(body.error).toMatch(/32 MiB/);
  });

  it('denies anonymous and read-only requesters', async () => {
    canPush = false;
    await startRemote('reader-token');
    for (const operation of operations()) expect((await operation()).status).toBe(403);
    await new Promise<void>(resolve => app.close(() => resolve()));
    await new Promise<void>(resolve => bucket.server.close(() => resolve()));
    vi.restoreAllMocks();
    canPush = true;
    await startRemote(undefined);
    for (const operation of operations()) expect((await operation()).status).toBe(403);
    expect(bucket.requests).toEqual([]);
    expect(published).toEqual([]);
  });
});

describe('R2 references across notebook repositories', () => {
  let second: string;
  async function startTwoRepositories(secondBranch = 'main') {
    await startLocal();
    second = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-r2-second-'));
    const run = (...args: string[]) => execFileSync('git', args, { cwd: second, stdio: 'pipe' });
    fs.mkdirSync(path.join(second, 'notes/ex'), { recursive: true });
    fs.writeFileSync(path.join(second, 'notes/ex/rules.md'), '![same path](r2:ex/old/map.webp)\n');
    run('init', '-b', secondBranch);
    run('config', 'user.name', 'Test');
    run('config', 'user.email', 'test@example.com');
    run('add', '.');
    run('commit', '-m', 'fixture');
    fs.writeFileSync(path.join(root, '.github-notes.yaml'), MANIFEST.replace('schema_version: 1', 'schema_version: 3') + '  - id: trpg\n    title: TRPG\n    root: notes/ex\n    source: { type: github, repository: owner/trpg }\n');
    fs.writeFileSync(path.join(root, 'mygitnotes.server.yaml'), `repositories:\n  - type: github\n    repository: owner/trpg\n    path: ${second}\n`);
  }
  afterEach(() => {
    if (second) fs.rmSync(second, { recursive: true, force: true });
  });

  it('lists references of every repository and rewrites each on a move', async () => {
    await startTwoRepositories();
    const references = await call('GET', `/api/r2/references?notebookId=${nb('ex')}&key=ex/old/map.webp`).then(r => r.json());
    expect(references.notes).toEqual([{ notebookId: nb('ex'), path: 'notes/ex/rules.md' }, { notebookId: 'trpg~trpg', path: 'notes/ex/rules.md' }, { notebookId: nb('other'), path: 'notes/other/cross.md' }]);
    const moved = await call('POST', '/api/r2/move', { notebookId: nb('ex'), key: 'ex/old/map.webp', destination: 'ex/new.webp' });
    expect(moved.status).toBe(200);
    expect(fs.readFileSync(path.join(second, 'notes/ex/rules.md'), 'utf8')).toBe('![same path](r2:ex/new.webp)\n');
    expect(fs.readFileSync(path.join(root, 'notes/other/cross.md'), 'utf8')).toBe('![x](r2:ex/new.webp)\n');
    expect(bucket.objects.has('ex/old/map.webp')).toBe(false);
  });

  it('refuses a move before copying when a repository whose notes it rewrites is read-only', async () => {
    await startTwoRepositories('draft');
    const moved = await call('POST', '/api/r2/move', { notebookId: nb('ex'), key: 'ex/old/map.webp', destination: 'ex/new.webp' });
    expect(moved.status).toBe(403);
    expect((await moved.json()).error).toMatch(/owner\/trpg/);
    expect(bucket.objects.has('ex/new.webp')).toBe(false);
    expect(fs.readFileSync(path.join(root, 'notes/other/cross.md'), 'utf8')).toBe('![x](r2:ex/old/map.webp)\n');
  });
});
