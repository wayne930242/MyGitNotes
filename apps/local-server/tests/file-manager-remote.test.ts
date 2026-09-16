import { it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { GitHubSource, GitLabSource, assetHash, type RemoteChange } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
vi.mock('../src/auth.js', async original => ({ ...await original<typeof import('../src/auth.js')>(), authToken: async () => 'fixture-token' }));

it.each(['github', 'gitlab'])('%s file HTTP adapter uses an atomic revision-checked commit for text and binary moves', async provider => {
  const binary = Buffer.from([137, 0, 255, 78]);
  const files = new Map([
    ['.github-notes.yaml', Buffer.from('schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n')],
    ['notes/a/folder/image.png', binary], ['notes/a/note.md', Buffer.from('![image](folder/image.png)\n')],
    ['notes/a/.hidden.json', Buffer.from('{}')],
  ]);
  let revision = 'one', canPush = true;
  const published: RemoteChange[][] = [];
  const prototype = (provider === 'github' ? GitHubSource : GitLabSource).prototype as any;
  vi.spyOn(prototype, 'loadSnapshot').mockImplementation(async () => {
    const dirs = new Set<string>();
    for (const file of files.keys()) { const parts = file.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
    return { sha: revision, treeSha: revision, info: { private: true, permissions: { push: canPush }, default_branch: 'main' }, entries: [
      ...[...dirs].map(path => ({ path, type: 'tree', mode: '040000', sha: path })),
      ...[...files].map(([path, bytes]) => ({ path, type: 'blob', mode: '100644', sha: assetHash(bytes), size: bytes.length })),
    ] };
  });
  vi.spyOn(prototype, 'readBlob').mockImplementation(async (...args: unknown[]) => [...files.values()].find(bytes => assetHash(bytes) === args[0])!);
  vi.spyOn(prototype, 'publishChanges').mockImplementation(async (...args: unknown[]) => {
    const changes = args[0] as RemoteChange[]; published.push(changes);
    const blobs = new Map([...files.values()].map(bytes => [assetHash(bytes), bytes]));
    for (const change of changes) {
      if (change.sha === null) files.delete(change.path);
      else files.set(change.path, change.content !== undefined ? Buffer.from(change.content) : change.base64 !== undefined ? Buffer.from(change.base64, 'base64') : blobs.get(change.sha!)!);
    }
    return revision += '-next';
  });
  vi.stubEnv('MYGITNOTES_SOURCE', provider); vi.stubEnv('MYGITNOTES_REPOSITORY', 'example/notes'); vi.stubEnv('MYGITNOTES_BRANCH', 'main'); vi.stubEnv('APP_URL', ''); vi.stubEnv('VERCEL', '');
  const server = createServer(createApp(process.cwd()));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (command: unknown, expected = revision) => fetch(base + '/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, revision: expected }) });
  try {
    const listing = await fetch(base + '/api/files?notebookId=a').then(r => r.json());
    expect(listing.remote).toBe(true); expect(listing.writable).toBe(true);
    expect(prototype.readBlob).toHaveBeenCalledTimes(1); // Only the manifest; browsing does not download file contents.
    const moved = await post({ notebookId: 'a', kind: 'move', path: 'notes/a/folder', destination: 'notes/a/renamed' });
    expect(moved.status).toBe(200);
    expect(published).toHaveLength(1);
    expect(files.get('notes/a/renamed/image.png')).toEqual(binary);
    expect(files.get('notes/a/note.md')!.toString()).toContain('renamed/image.png');
    expect(published[0].find(change => change.path === 'notes/a/renamed/image.png')?.sha).toBe(assetHash(binary));
    expect((await post({ notebookId: 'a', kind: 'create', path: 'notes/a/empty.txt' })).status).toBe(200);
    expect(files.get('notes/a/empty.txt')!.length).toBe(0);
    expect((await post({ notebookId: 'a', kind: 'write', path: 'notes/a/.hidden.json', content: '{"new":true}\n' })).status).toBe(200);
    expect((await post({ notebookId: 'a', kind: 'upload', path: 'notes/a/new.bin', base64: binary.toString('base64') })).status).toBe(200);
    expect(files.get('notes/a/new.bin')).toEqual(binary);
    expect((await post({ notebookId: 'a', kind: 'delete', path: 'notes/a/empty.txt' }, 'one')).status).toBe(409);
    expect(files.has('notes/a/empty.txt')).toBe(true);
    canPush = false;
    expect((await post({ notebookId: 'a', kind: 'delete', path: 'notes/a/empty.txt' })).status).toBe(403);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); vi.restoreAllMocks(); vi.unstubAllEnvs(); }
});
