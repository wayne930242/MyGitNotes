import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { openRemoteHome, r2SettingsFromEnv, RemoteSource, scanNotebookNotes, WORKSPACE_CONFIG_FILENAME } from '@mygitnotes/core';
import { gitlabFixture } from '../../core/tests/fixtures/gitlab.js';
import { runGit, stageAndCommit } from '@mygitnotes/git';
import { handleAddAsset, handleDeleteAsset, handleListAssets, type ToolAssets } from '../src/tools/index.js';
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

/** Minimal S3-compatible stand-in covering the requests the asset tools send. */
async function startBucket() {
  const objects = new Map<string, Buffer>();
  const deletions: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://bucket'), [, bucket, ...parts] = url.pathname.split('/');
    const key = parts.map(decodeURIComponent).join('/');
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk)).on('end', () => {
      if (bucket !== 'private-assets') {
        res.statusCode = 404;
        return res.end();
      }
      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') || '';
        const contents = [...objects].filter(([name]) => name.startsWith(prefix)).map(([name, body]) => `<Contents><Key>${name}</Key><Size>${body.length}</Size><LastModified>2026-09-20T00:00:00.000Z</LastModified></Contents>`);
        return res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents.join('')}</ListBucketResult>`);
      }
      if (req.method === 'HEAD') {
        res.statusCode = objects.has(key) ? 200 : 404;
        return res.end();
      }
      if (req.method === 'DELETE') {
        deletions.push(key);
        objects.delete(key);
        res.statusCode = 204;
        return res.end();
      }
      if (req.method !== 'PUT') {
        res.statusCode = 405;
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
  return { objects, deletions, server, endpoint: `http://127.0.0.1:${(server.address() as { port: number; }).port}` };
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

  it('accepts a file past the repository size limit, which only guards Git history', async () => {
    const big = { ...upload, filename: 'scan.pdf', base64Content: Buffer.alloc(4 * 1024 * 1024, 7).toString('base64') };
    expect(await handleAddAsset({ repoRoot: repo }, big)).toMatchObject({ storage: 'r2', key: 'example/images/scan.pdf' });
    expect(bucket.objects.get('example/images/scan.pdf')?.length).toBe(4 * 1024 * 1024);

    delete process.env.MYGITNOTES_R2_BUCKET;
    await expect(handleAddAsset({ repoRoot: repo }, big)).rejects.toThrow(/up to 3 MiB/);
  });

  it('uploads a hosted asset to the bucket without touching the remote repository', async () => {
    const reader = { config: async () => ({ notebooks: [{ id: 'example', root: 'notes/example' }] }), mutateAsset: () => expect.unreachable('a configured bucket must not commit the binary') } as unknown as RemoteSource;
    const result = await callRemoteTool(reader, 'add_asset', { ...upload, filename: 'scan.pdf' }, true);

    expect(result).toMatchObject({ storage: 'r2', key: 'example/images/scan.pdf', reference: 'r2:example/images/scan.pdf', markdownRef: '![scan.pdf](<r2:example/images/scan.pdf>)' });
    expect(bucket.objects.has('example/images/scan.pdf')).toBe(true);
  });
});

describe('managing R2 assets over MCP', () => {
  const note = (body: string) => {
    fs.mkdirSync(path.join(repo, 'notes/example'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'notes/example/welcome.md'), `---\ntitle: Welcome\n---\n\n${body}\n`);
  };

  it('lists repository assets and bucket objects together, each naming its own reference', async () => {
    await handleAddAsset({ repoRoot: repo }, upload);
    delete process.env.MYGITNOTES_R2_BUCKET;
    await handleAddAsset({ repoRoot: repo }, { ...upload, filename: 'legacy.png', directory: '' });
    process.env.MYGITNOTES_R2_BUCKET = 'private-assets';

    const { assets } = await handleListAssets({ repoRoot: repo }, { notebookId: 'example' }) as { assets: Record<string, unknown>[]; };
    expect(assets).toEqual([{ storage: 'git', name: 'legacy.png', path: 'notes/example/assets/legacy.png', markdownRef: '![legacy.png](assets/legacy.png)' }, { storage: 'r2', notebookId: 'example', name: 'photo.png', key: 'example/images/photo.png', size: 21, lastModified: '2026-09-20T00:00:00.000Z', reference: 'r2:example/images/photo.png', markdownRef: '![photo.png](<r2:example/images/photo.png>)' }]);
  });

  it('refuses to delete an object a note still links, and deletes it once nothing does', async () => {
    await handleAddAsset({ repoRoot: repo }, upload);
    note('![photo.png](<r2:example/images/photo.png>)');
    await expect(handleDeleteAsset({ repoRoot: repo }, { path: 'r2:example/images/photo.png' })).rejects.toThrow(/still referenced by notes\/example\/welcome\.md/);
    expect(bucket.objects.has('example/images/photo.png')).toBe(true);

    note('no picture here');
    expect(await handleDeleteAsset({ repoRoot: repo }, { path: 'r2:example/images/photo.png' })).toMatchObject({ success: true, storage: 'r2', key: 'example/images/photo.png' });
    expect(bucket.objects.has('example/images/photo.png')).toBe(false);
  });

  it('blocks local deletion for an outline-only reference without broadening ordinary note browsing', async () => {
    await handleAddAsset({ repoRoot: repo }, upload);
    note('Ordinary note without an asset.');
    fs.writeFileSync(path.join(repo, 'notes/example/plan.outline.md'), '- Inspect ![photo](<r2:example/images/photo.png>)\n');
    expect(scanNotebookNotes(repo, { id: 'example', title: 'Example', root: 'notes/example' }).map(note => note.path)).toEqual(['notes/example/welcome.md']);
    await expect(handleDeleteAsset({ repoRoot: repo }, { path: 'r2:example/images/photo.png' })).rejects.toThrow(/still referenced by notes\/example\/plan\.outline\.md/);
    expect(bucket.objects.has('example/images/photo.png')).toBe(true);
    expect(bucket.deletions).toEqual([]);
  });

  it('blocks hosted deletion for an outline-only reference through the actual remote scanner', async () => {
    await handleAddAsset({ repoRoot: repo }, upload);
    const fixture = gitlabFixture(undefined, { 'notes/.github-notes.yaml': MANIFEST, 'notes/example/plain.md': '# No asset\n', 'notes/example/plan.outline.md': '- Inspect ![photo](<r2:example/images/photo.png>)\n' });
    const reader = openRemoteHome({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'test-token', fixture.request).reader;
    expect((await reader.notes()).map(note => note.path)).toEqual(['notes/example/plain.md']);
    await expect(callRemoteTool(reader, 'delete_asset', { path: 'r2:example/images/photo.png' }, true)).rejects.toThrow(/still referenced by notes\/example\/plan\.outline\.md/);
    expect(bucket.objects.has('example/images/photo.png')).toBe(true);
    expect(bucket.deletions).toEqual([]);
    expect(fixture.writes).toBe(0);
  });

  it('deletes a referenced object when the caller forces it', async () => {
    await handleAddAsset({ repoRoot: repo }, upload);
    note('![photo.png](<r2:example/images/photo.png>)');
    expect(await handleDeleteAsset({ repoRoot: repo }, { path: 'r2:example/images/photo.png', force: true })).toMatchObject({ success: true });
    expect(bucket.objects.has('example/images/photo.png')).toBe(false);
  });

  it('refuses a key outside the configured notebooks and a key with no object', async () => {
    await expect(handleDeleteAsset({ repoRoot: repo }, { path: 'r2:other/secret.pdf' })).rejects.toThrow(/outside this workspace/);
    await expect(handleDeleteAsset({ repoRoot: repo }, { path: 'r2:example/missing.pdf' })).rejects.toThrow(/not found/);
  });

  it('lists and deletes bucket objects for a hosted workspace', async () => {
    await handleAddAsset({ repoRoot: repo }, upload);
    const notes = [{ path: 'notes/example/welcome.md', content: 'nothing linked' }];
    const reader = { config: async () => ({ notebooks: [{ id: 'example', root: 'notes/example' }] }), assets: async () => [], markdownNotes: async () => notes, mutateAsset: () => expect.unreachable('a bucket object must not be deleted through a commit') } as unknown as RemoteSource;

    expect(await callRemoteTool(reader, 'list_assets', { notebookId: 'example' }, false)).toMatchObject({ assets: [{ storage: 'r2', key: 'example/images/photo.png' }] });
    expect(await callRemoteTool(reader, 'delete_asset', { path: 'r2:example/images/photo.png' }, true)).toMatchObject({ success: true, storage: 'r2' });
    expect(bucket.objects.has('example/images/photo.png')).toBe(false);
  });
});

describe('R2 asset tools in a storage scope', () => {
  const reserved: [string, number][] = [], recorded: [string, number][] = [];
  /** Keys live under `r/42/`, an object may be at most 1 MiB, and every upload and removal is metered. */
  const scoped: ToolAssets = {
    scope: async () => ({ settings: r2SettingsFromEnv()!, prefix: 'r/42/', limits: { maxObjectBytes: 1024 * 1024 } }),
    reserve: async (_scope, key, bytes) => {
      reserved.push([key, bytes]);
    },
    record: async (_scope, key, delta) => {
      recorded.push([key, delta]);
    },
  };
  const reader = (notes: { path: string; content: string; }[] = []) => ({ config: async () => ({ notebooks: [{ id: 'example', root: 'notes/example' }] }), assets: async () => [], markdownNotes: async () => notes, mutateAsset: () => expect.unreachable('a bucket object must not be committed or deleted through Git') }) as unknown as RemoteSource;
  beforeEach(() => {
    reserved.length = 0;
    recorded.length = 0;
  });

  it('uploads a local asset under the prefix and meters it', async () => {
    const result = await handleAddAsset({ repoRoot: repo, assets: scoped }, upload);
    expect(result).toMatchObject({ storage: 'r2', key: 'r/42/example/images/photo.png', reference: 'r2:r/42/example/images/photo.png' });
    expect(bucket.objects.has('r/42/example/images/photo.png')).toBe(true);
    expect(bucket.objects.has('example/images/photo.png')).toBe(false);
    expect(reserved).toEqual([['r/42/example/images/photo.png', 21]]);
    expect(recorded).toEqual([['r/42/example/images/photo.png', 21]]);
  });

  it('holds an upload to the scope object limit, and reserves nothing for one that already exists', async () => {
    const big = { ...upload, filename: 'scan.pdf', base64Content: Buffer.alloc(2 * 1024 * 1024, 7).toString('base64') };
    await expect(handleAddAsset({ repoRoot: repo, assets: scoped }, big)).rejects.toThrow(/up to 1 MiB/);
    await handleAddAsset({ repoRoot: repo, assets: scoped }, upload);
    reserved.length = 0;
    await expect(handleAddAsset({ repoRoot: repo, assets: scoped }, upload)).rejects.toThrow(/already exists: r2:r\/42\/example\/images\/photo\.png/);
    expect(reserved).toEqual([]);
  });

  it('lists only the scope’s objects and deletes only inside it, recording the size removed', async () => {
    bucket.objects.set('r/42/example/mine.png', Buffer.from('mine'));
    bucket.objects.set('r/43/example/theirs.png', Buffer.from('theirs'));
    bucket.objects.set('example/unscoped.png', Buffer.from('plain'));
    const listed = await callRemoteTool(reader(), 'list_assets', { notebookId: 'example' }, false, undefined, scoped);
    expect((listed.assets as { key: string; }[]).map(asset => asset.key)).toEqual(['r/42/example/mine.png']);

    for (const key of ['r/43/example/theirs.png', 'example/unscoped.png']) {
      await expect(callRemoteTool(reader(), 'delete_asset', { path: `r2:${key}`, force: true }, true, undefined, scoped)).rejects.toThrow(/not found/);
      expect(bucket.objects.has(key)).toBe(true);
    }
    expect(await callRemoteTool(reader(), 'delete_asset', { path: 'r2:r/42/example/mine.png' }, true, undefined, scoped)).toMatchObject({ success: true, key: 'r/42/example/mine.png' });
    expect(recorded).toEqual([['r/42/example/mine.png', -4]]);
    expect(bucket.deletions).toEqual(['r/42/example/mine.png']);
  });

  it('uploads a hosted asset into the scope, and keeps it in Git when the scope has no bucket', async () => {
    expect(await callRemoteTool(reader(), 'add_asset', { ...upload, filename: 'scan.pdf' }, true, undefined, scoped)).toMatchObject({ storage: 'r2', key: 'r/42/example/images/scan.pdf' });
    const none: ToolAssets = { scope: async () => null };
    const mutate = { path: 'notes/example/assets/images/scan.pdf' };
    const git = { ...reader(), getSnapshot: async () => ({ sha: 'head' }), mutateAsset: async () => mutate } as unknown as RemoteSource;
    expect(await callRemoteTool(git, 'add_asset', { ...upload, filename: 'scan.pdf' }, true, undefined, none)).toMatchObject({ storage: 'git' });
    expect(bucket.objects.size).toBe(1);
  });
});
