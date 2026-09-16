import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { GitHubSource, SourceError, assetHash, type RemoteChange } from '@mygitnotes/core';
import { createApp } from '../src/app.js';

let remoteToken: string | undefined;
vi.mock('../src/auth.js', async original => ({ ...await original<typeof import('../src/auth.js')>(), authToken: async () => remoteToken }));

const MANIFEST = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n  - id: other\n    title: Other\n    root: notes/other\n';
const NOTE = '# Rules\n\n![Core](<r2:ex/old/Core Rules.pdf>)\n[map](r2:ex/old/map.webp) [keep](r2:ex/keep.pdf)\n';

/** Minimal S3-compatible stand-in recording every request. */
async function startBucket() {
  const objects = new Map<string, Buffer>(), requests: string[] = [], hooks: { onCopy?: () => void } = {};
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://bucket'), [, bucket, ...parts] = url.pathname.split('/');
    const key = parts.map(decodeURIComponent).join('/');
    requests.push(`${req.method} ${key}${req.headers['x-amz-copy-source'] ? ' <- ' + decodeURIComponent(String(req.headers['x-amz-copy-source'])) : ''}`);
    if (bucket !== 'private-assets') { res.statusCode = 404; return res.end(); }
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk)).on('end', () => {
      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') || '';
        const contents = [...objects].filter(([name]) => name.startsWith(prefix)).map(([name, body]) => `<Contents><Key>${name.replace(/&/g, '&amp;')}</Key><Size>${body.length}</Size><LastModified>2026-09-16T00:00:00.000Z</LastModified></Contents>`);
        return res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents.join('')}</ListBucketResult>`);
      }
      if (req.method === 'HEAD') { res.statusCode = objects.has(key) ? 200 : 404; return res.end(); }
      if (req.method === 'PUT') {
        if (req.headers['if-none-match'] === '*' && objects.has(key)) { res.statusCode = 412; return res.end(); }
        const copy = req.headers['x-amz-copy-source'];
        if (copy) {
          const from = decodeURIComponent(String(copy)).split('/').slice(2).join('/');
          if (!objects.has(from)) { res.statusCode = 404; return res.end(); }
          objects.set(key, objects.get(from)!); hooks.onCopy?.();
        } else objects.set(key, Buffer.concat(chunks));
        return res.end('<CopyObjectResult/>');
      }
      if (req.method === 'DELETE') { objects.delete(key); res.statusCode = 204; return res.end(); }
      res.statusCode = objects.has(key) ? 200 : 404; res.end(objects.get(key));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { objects, requests, hooks, server, endpoint: `http://127.0.0.1:${(server.address() as any).port}` };
}

let root: string, app: Server, base: string, bucket: Awaited<ReturnType<typeof startBucket>>;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
async function start(env: Record<string, string>) {
  bucket = await startBucket();
  const settings = { MYGITNOTES_R2_ACCOUNT_ID: 'acc', MYGITNOTES_R2_ACCESS_KEY_ID: 'AK', MYGITNOTES_R2_SECRET_ACCESS_KEY: 'r2-secret', MYGITNOTES_R2_BUCKET: 'private-assets', MYGITNOTES_R2_ENDPOINT: bucket.endpoint };
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', APP_URL: '', VERCEL: '', ...settings, ...env })) vi.stubEnv(key, value);
  app = createServer(createApp(root)); await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(app.address() as any).port}`;
}
async function startLocal(branch = 'main') {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-r2-manager-'));
  fs.mkdirSync(path.join(root, 'notes/ex'), { recursive: true }); fs.mkdirSync(path.join(root, 'notes/other'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github-notes.yaml'), MANIFEST);
  fs.writeFileSync(path.join(root, 'notes/ex/rules.md'), NOTE);
  fs.writeFileSync(path.join(root, 'notes/other/cross.md'), '![x](r2:ex/old/map.webp)\n');
  fs.writeFileSync(path.join(root, 'notes/ex/plain.md'), '# Plain\n');
  git('init', '-b', branch); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com'); git('add', '.'); git('commit', '-m', 'fixture');
  await start({ MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: root });
  for (const key of ['ex/old/Core Rules.pdf', 'ex/old/map.webp', 'ex/keep.pdf', 'other/secret.pdf']) bucket.objects.set(key, Buffer.from(key));
}
const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(base + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const operations = (notebookId = 'ex') => [
  () => call('GET', `/api/r2?notebookId=${notebookId}`),
  () => call('GET', `/api/r2/raw?notebookId=${notebookId}&key=ex/keep.pdf`),
  () => call('GET', `/api/r2/references?notebookId=${notebookId}&key=ex/keep.pdf`),
  () => call('POST', '/api/r2/upload', { notebookId, key: 'ex/new.pdf' }),
  () => call('POST', '/api/r2/mkdir', { notebookId, key: 'ex/folder' }),
  () => call('POST', '/api/r2/move', { notebookId, key: 'ex/keep.pdf', destination: 'ex/moved.pdf' }),
  () => call('POST', '/api/r2/delete', { notebookId, key: 'ex/keep.pdf' }),
];

afterEach(async () => {
  await new Promise<void>(resolve => app.close(() => resolve())); await new Promise<void>(resolve => bucket.server.close(() => resolve()));
  if (root) fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks(); vi.unstubAllEnvs();
});

describe('R2 management on a local workspace', () => {
  it('lists only the notebook prefix and previews through a presigned redirect', async () => {
    await startLocal();
    const listing = await call('GET', '/api/r2?notebookId=ex').then(r => r.json());
    expect(listing.prefix).toBe('ex/');
    expect(listing.objects.map((object: any) => object.key).sort()).toEqual(['ex/keep.pdf', 'ex/old/Core Rules.pdf', 'ex/old/map.webp']);
    const raw = await call('GET', '/api/r2/raw?notebookId=ex&key=ex/keep.pdf&download=1');
    expect(raw.status).toBe(302);
    const location = new URL(raw.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(`${bucket.endpoint}/private-assets/ex/keep.pdf`);
    expect(location.searchParams.get('response-content-disposition')).toMatch(/^attachment;/);
    expect(raw.headers.get('location')).not.toContain('r2-secret');
  });

  it('presigns a direct upload, rejects existing keys and creates folders', async () => {
    await startLocal();
    const upload = await call('POST', '/api/r2/upload', { notebookId: 'ex', key: 'ex/docs/big file.pdf' }).then(r => r.json());
    expect(new URL(upload.url).pathname).toBe('/private-assets/ex/docs/big%20file.pdf');
    expect(new URL(upload.url).searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(new URL(upload.url).searchParams.get('X-Amz-SignedHeaders')).toContain('if-none-match');
    expect(bucket.objects.has('ex/docs/big file.pdf')).toBe(false);
    expect((await call('POST', '/api/r2/upload', { notebookId: 'ex', key: 'ex/keep.pdf' })).status).toBe(409);
    expect((await call('POST', '/api/r2/mkdir', { notebookId: 'ex', key: 'ex/new folder' })).status).toBe(200);
    expect(bucket.objects.get('ex/new folder/.keep')).toEqual(Buffer.alloc(0));
    expect((await call('POST', '/api/r2/mkdir', { notebookId: 'ex', key: 'ex/old' })).status).toBe(409);
  });

  it('moves a folder, rewrites every referencing note and removes the originals', async () => {
    await startLocal();
    const references = await call('GET', '/api/r2/references?notebookId=ex&key=ex/old&directory=1').then(r => r.json());
    expect(references.objects.sort()).toEqual(['ex/old/Core Rules.pdf', 'ex/old/map.webp']);
    expect(references.notes).toEqual(['notes/ex/rules.md', 'notes/other/cross.md']);
    const moved = await call('POST', '/api/r2/move', { notebookId: 'ex', key: 'ex/old', destination: 'ex/archive/2026', directory: true });
    expect(moved.status).toBe(200);
    expect((await moved.json()).notes).toEqual(['notes/ex/rules.md', 'notes/other/cross.md']);
    expect([...bucket.objects.keys()].sort()).toEqual(['ex/archive/2026/Core Rules.pdf', 'ex/archive/2026/map.webp', 'ex/keep.pdf', 'other/secret.pdf']);
    expect(fs.readFileSync(path.join(root, 'notes/ex/rules.md'), 'utf8')).toBe('# Rules\n\n![Core](<r2:ex/archive/2026/Core Rules.pdf>)\n[map](r2:ex/archive/2026/map.webp) [keep](r2:ex/keep.pdf)\n');
    expect(fs.readFileSync(path.join(root, 'notes/other/cross.md'), 'utf8')).toBe('![x](r2:ex/archive/2026/map.webp)\n');
    expect(fs.readFileSync(path.join(root, 'notes/ex/plain.md'), 'utf8')).toBe('# Plain\n');
  });

  it('refuses a move onto an existing key without touching objects or notes', async () => {
    await startLocal();
    bucket.objects.set('ex/new/map.webp', Buffer.from('taken'));
    expect((await call('POST', '/api/r2/move', { notebookId: 'ex', key: 'ex/old', destination: 'ex/new', directory: true })).status).toBe(409);
    expect(bucket.objects.has('ex/old/map.webp')).toBe(true);
    expect(bucket.objects.has('ex/new/Core Rules.pdf')).toBe(false);
    expect(fs.readFileSync(path.join(root, 'notes/ex/rules.md'), 'utf8')).toBe(NOTE);
    expect((await call('POST', '/api/r2/move', { notebookId: 'ex', key: 'ex/old', destination: 'ex/old/inner', directory: true })).status).toBe(400);
  });

  it('refuses a move whose referencing note changed during the copies and rolls the copies back', async () => {
    await startLocal();
    const edited = NOTE + '\nSaved while copying.\n';
    bucket.hooks.onCopy = () => fs.writeFileSync(path.join(root, 'notes/ex/rules.md'), edited);
    expect((await call('POST', '/api/r2/move', { notebookId: 'ex', key: 'ex/old', destination: 'ex/archive', directory: true })).status).toBe(409);
    expect(fs.readFileSync(path.join(root, 'notes/ex/rules.md'), 'utf8')).toBe(edited);
    expect(fs.readFileSync(path.join(root, 'notes/other/cross.md'), 'utf8')).toBe('![x](r2:ex/old/map.webp)\n');
    expect([...bucket.objects.keys()].sort()).toEqual(['ex/keep.pdf', 'ex/old/Core Rules.pdf', 'ex/old/map.webp', 'other/secret.pdf']);
  });

  it('deletes a file or folder and leaves notes unchanged', async () => {
    await startLocal();
    expect((await call('POST', '/api/r2/delete', { notebookId: 'ex', key: 'ex/keep.pdf' })).status).toBe(200);
    expect((await call('POST', '/api/r2/delete', { notebookId: 'ex', key: 'ex/old', directory: true }).then(r => r.json())).deleted.sort()).toEqual(['ex/old/Core Rules.pdf', 'ex/old/map.webp']);
    expect([...bucket.objects.keys()]).toEqual(['other/secret.pdf']);
    expect(fs.readFileSync(path.join(root, 'notes/ex/rules.md'), 'utf8')).toBe(NOTE);
    expect((await call('POST', '/api/r2/delete', { notebookId: 'ex', key: 'ex/keep.pdf' })).status).toBe(404);
  });

  it('rejects keys outside the notebook prefix or escaping the bucket', async () => {
    await startLocal();
    expect((await call('GET', '/api/r2/raw?notebookId=ex&key=other/secret.pdf')).status).toBe(403);
    expect((await call('POST', '/api/r2/delete', { notebookId: 'ex', key: 'ex/../other/secret.pdf' })).status).toBe(403);
    expect((await call('POST', '/api/r2/move', { notebookId: 'ex', key: 'ex/keep.pdf', destination: 'other/stolen.pdf' })).status).toBe(403);
    expect((await call('POST', '/api/r2/upload', { notebookId: 'ex', key: 'other/new.pdf' })).status).toBe(403);
    expect(bucket.objects.has('other/secret.pdf')).toBe(true);
  });

  it('denies every operation off the main branch without contacting the bucket', async () => {
    await startLocal('core');
    for (const operation of operations()) expect((await operation()).status).toBe(403);
    expect(bucket.requests).toEqual([]);
    expect(bucket.objects.has('ex/keep.pdf')).toBe(true);
  });
});

describe('R2 management on a hosted workspace', () => {
  const files = new Map<string, Buffer>();
  let revision = 'one', canPush = true;
  const published: RemoteChange[][] = [];
  async function startRemote(token: string | undefined) {
    root = '';
    files.clear(); published.length = 0; revision = 'one';
    files.set('.github-notes.yaml', Buffer.from(MANIFEST)); files.set('notes/ex/rules.md', Buffer.from(NOTE));
    remoteToken = token;
    const prototype = GitHubSource.prototype as any;
    vi.spyOn(prototype, 'loadSnapshot').mockImplementation(async () => ({ sha: revision, treeSha: revision, info: { private: true, permissions: { push: canPush }, default_branch: 'main' },
      entries: [...files].map(([file, bytes]) => ({ path: file, type: 'blob', mode: '100644', sha: assetHash(bytes), size: bytes.length })) }));
    vi.spyOn(prototype, 'readBlob').mockImplementation(async (...args: unknown[]) => [...files.values()].find(bytes => assetHash(bytes) === args[0])!);
    vi.spyOn(prototype, 'publishChanges').mockImplementation(async (...args: unknown[]) => {
      if ((args[1] as { sha: string }).sha !== revision) throw new SourceError('The repository changed. Reload before saving.', 409);
      const changes = args[0] as RemoteChange[]; published.push(changes);
      for (const change of changes) files.set(change.path, Buffer.from(change.content!));
      return revision += '-next';
    });
    await start({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'example/notes', MYGITNOTES_BRANCH: 'main' });
    for (const key of ['ex/old/Core Rules.pdf', 'ex/old/map.webp', 'ex/keep.pdf']) bucket.objects.set(key, Buffer.from(key));
  }

  it('commits note rewrites for a writer', async () => {
    canPush = true;
    await startRemote('writer-token');
    expect((await call('GET', '/api/r2?notebookId=ex')).status).toBe(200);
    expect((await call('POST', '/api/r2/move', { notebookId: 'ex', key: 'ex/old/map.webp', destination: 'ex/maps/region.webp' })).status).toBe(200);
    expect(published).toHaveLength(1);
    expect(published[0].map(change => change.path)).toEqual(['notes/ex/rules.md']);
    expect(files.get('notes/ex/rules.md')!.toString()).toContain('[map](r2:ex/maps/region.webp)');
    expect(bucket.objects.has('ex/maps/region.webp')).toBe(true);
    expect(bucket.objects.has('ex/old/map.webp')).toBe(false);
  });

  it('rolls copied objects back when the rewrite commit hits a revision conflict', async () => {
    canPush = true;
    await startRemote('writer-token');
    bucket.hooks.onCopy = () => { revision = 'moved-on'; };
    expect((await call('POST', '/api/r2/move', { notebookId: 'ex', key: 'ex/old/map.webp', destination: 'ex/maps/region.webp' })).status).toBe(409);
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
      peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return [...files.values()].find(bytes => assetHash(bytes) === sha)!;
    });
    const prefetch = vi.spyOn(prototype, 'prefetchFiles').mockResolvedValue(undefined);
    const response = await call('GET', '/api/r2/references?notebookId=ex&key=ex/old&directory=1');
    expect(response.status).toBe(200);
    expect((await response.json()).notes).toHaveLength(201);
    expect(prefetch).toHaveBeenCalledWith(expect.arrayContaining(['notes/ex/rules.md', 'notes/ex/note-199.md']));
    expect(peak).toBe(1);
    read.mockRejectedValue(new SourceError('GitHub API is temporarily rate limited. Retry in 7 seconds.', 429, 7));
    const limited = await call('GET', '/api/r2/references?notebookId=ex&key=ex/old&directory=1');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('7');
    expect((await limited.json()).retryAfter).toBe(7);
  });

  it('denies anonymous and read-only requesters', async () => {
    canPush = false;
    await startRemote('reader-token');
    for (const operation of operations()) expect((await operation()).status).toBe(403);
    await new Promise<void>(resolve => app.close(() => resolve())); await new Promise<void>(resolve => bucket.server.close(() => resolve()));
    vi.restoreAllMocks(); canPush = true;
    await startRemote(undefined);
    for (const operation of operations()) expect((await operation()).status).toBe(403);
    expect(bucket.requests).toEqual([]);
    expect(published).toEqual([]);
  });
});
