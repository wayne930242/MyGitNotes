import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { RemoteSource, WORKSPACE_CONFIG_FILENAME } from '@mygitnotes/core';
import { runGit, stageAndCommit } from '@mygitnotes/git';
import { handleAddAsset } from '../src/tools/index.js';
import { callRemoteTool } from '../src/remote-tools.js';

const MANIFEST = `schema_version: 1
workspace:
  title: "Test Workspace"
  default_notebook: example
notebooks:
  - id: example
    title: "Example Notebook"
    root: notes/example
    assets: assets
`;

/** Minimal S3-compatible stand-in that only has to answer the create-only PUT an upload sends. */
async function startBucket() {
  const objects = new Map<string, Buffer>();
  const server = createServer((req, res) => {
    const [, bucket, ...parts] = new URL(req.url!, 'http://bucket').pathname.split('/');
    const key = parts.map(decodeURIComponent).join('/');
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk)).on('end', () => {
      if (bucket !== 'private-assets' || req.method !== 'PUT') {
        res.statusCode = 404;
        return res.end();
      }
      if (objects.has(key)) {
        res.statusCode = 412;
        return res.end();
      }
      objects.set(key, Buffer.concat(chunks));
      res.end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { objects, server, endpoint: `http://127.0.0.1:${(server.address() as { port: number; }).port}` };
}

let repo: string, bucket: Awaited<ReturnType<typeof startBucket>>;
const head = async () => (await runGit(['rev-parse', 'HEAD'], repo)).stdout.trim();
const upload = { notebookId: 'example', filename: 'photo.png', directory: 'images', base64Content: Buffer.from('sample png image data').toString('base64') };

beforeEach(async () => {
  bucket = await startBucket();
  Object.assign(process.env, { MYGITNOTES_R2_ACCOUNT_ID: 'account', MYGITNOTES_R2_ACCESS_KEY_ID: 'key', MYGITNOTES_R2_SECRET_ACCESS_KEY: 'secret', MYGITNOTES_R2_BUCKET: 'private-assets', MYGITNOTES_R2_ENDPOINT: bucket.endpoint });
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-notes-mcp-r2-'));
  await runGit(['init', '-b', 'main'], repo);
  await runGit(['config', 'user.name', 'Test User'], repo);
  await runGit(['config', 'user.email', 'test@example.com'], repo);
  fs.writeFileSync(path.join(repo, WORKSPACE_CONFIG_FILENAME), MANIFEST);
  await stageAndCommit(repo, [WORKSPACE_CONFIG_FILENAME], 'add workspace config');
});

afterEach(async () => {
  for (const name of ['ACCOUNT_ID', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'BUCKET', 'ENDPOINT']) delete process.env[`MYGITNOTES_R2_${name}`];
  await new Promise(resolve => bucket.server.close(resolve));
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('add_asset with R2 storage configured', () => {
  it('uploads a local asset to the bucket and returns its r2 reference without committing', async () => {
    const before = await head();
    const result = await handleAddAsset({ repoRoot: repo }, upload);

    expect(result).toMatchObject({ success: true, storage: 'r2', filename: 'photo.png', key: 'example/images/photo.png', reference: 'r2:example/images/photo.png', markdownRef: '![photo.png](<r2:example/images/photo.png>)' });
    expect(bucket.objects.get('example/images/photo.png')?.toString()).toBe('sample png image data');
    expect(fs.existsSync(path.join(repo, 'notes/example/assets/images/photo.png'))).toBe(false);
    expect(await head()).toBe(before);
  });

  it('reports a taken key instead of replacing an object other notes already link', async () => {
    await handleAddAsset({ repoRoot: repo }, upload);
    await expect(handleAddAsset({ repoRoot: repo }, upload)).rejects.toThrow(/already exists: r2:example\/images\/photo\.png/);
  });

  it('falls back to the notebook assets directory when R2 is unconfigured', async () => {
    delete process.env.MYGITNOTES_R2_BUCKET;
    const result = await handleAddAsset({ repoRoot: repo }, upload);

    expect(result).toMatchObject({ success: true, storage: 'git', path: 'notes/example/assets/images/photo.png', reference: 'assets/images/photo.png' });
    expect(bucket.objects.size).toBe(0);
  });

  it('uploads a hosted asset to the bucket without touching the remote repository', async () => {
    const reader = { config: async () => ({ notebooks: [{ id: 'example', root: 'notes/example' }] }), mutateAsset: () => expect.unreachable('a configured bucket must not commit the binary') } as unknown as RemoteSource;
    const result = await callRemoteTool(reader, 'add_asset', { ...upload, filename: 'scan.pdf' }, true);

    expect(result).toMatchObject({ storage: 'r2', key: 'example/images/scan.pdf', reference: 'r2:example/images/scan.pdf', markdownRef: '![scan.pdf](<r2:example/images/scan.pdf>)' });
    expect(bucket.objects.has('example/images/scan.pdf')).toBe(true);
  });
});
