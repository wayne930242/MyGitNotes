import { describe, expect, it, vi } from 'vitest';
import { openRemoteHome } from '../src/remote-factory.js';
import { gitBlobId, MemoryRemoteCache, type RemoteCache } from '../src/remote-cache.js';
import { blobBatches } from '../src/github-source.js';

const manifest = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n';
const fixture: Record<string, string> = { 'notes/.github-notes.yaml': manifest, 'notes/example/alpha.md': '---\ntags: [a]\n---\n# Alpha\n', 'notes/example/deep/beta.md': '# Beta\n' };
const shaOf = (content: string) => gitBlobId(Buffer.from(content, 'utf8'), 40);
const bySha = new Map(Object.values(fixture).map(content => [shaOf(content), content]));

function tree() {
  const directories = new Set<string>();
  for (const file of Object.keys(fixture)) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  return [...Object.entries(fixture).map(([file, content]) => ({ path: file, type: 'blob', mode: '100644', sha: shaOf(content), size: content.length })), ...[...directories].map(directory => ({ path: directory, type: 'tree', mode: '040000', sha: `tree-${directory}` }))];
}

/** GitHub double serving one commit, its tree, blob reads and GraphQL batches. */
function github(options: { corrupt?: boolean; } = {}) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input).replace('https://api.github.com/repos/owner/repo', '');
    if (url === 'https://api.github.com/graphql') {
      const body = JSON.parse(String(init!.body)) as { query: string; };
      const shas = [...body.query.matchAll(/b(\d+): object\(oid: "([a-f0-9]+)"\)/g)];
      const fields = Object.fromEntries(shas.map(([, index, sha]) => [`b${index}`, { isBinary: false, isTruncated: false, text: bySha.get(sha) ?? null }]));
      return new Response(JSON.stringify({ data: { repository: fields } }), { status: 200 });
    }
    let result: unknown;
    if (!url) result = { private: true, permissions: { push: true } };
    else if (url.startsWith('/commits/')) result = { sha: url.slice('/commits/'.length), commit: { tree: { sha: 'tree1' } } };
    else if (url === '/git/trees/tree1?recursive=1') result = { tree: tree(), truncated: false };
    else if (url.startsWith('/git/blobs/')) {
      const content = bySha.get(url.slice('/git/blobs/'.length));
      if (content === undefined) return new Response('{}', { status: 404 });
      result = { encoding: 'base64', content: Buffer.from(options.corrupt ? `${content}tampered` : content, 'utf8').toString('base64') };
    } else return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(result), { status: 200 });
  });
}

const reader = (request: ReturnType<typeof github>, cache?: RemoteCache) => openRemoteHome({ type: 'github', repository: 'owner/repo', branch: 'main' }, 'token', request as unknown as typeof fetch, cache).reader;
const blobRequests = (request: ReturnType<typeof github>) => request.mock.calls.filter(([url]) => String(url).includes('/git/blobs/') || String(url) === 'https://api.github.com/graphql').length;

describe('shared remote cache', () => {
  it('serves a second reader entirely from the cache', async () => {
    const cache = new MemoryRemoteCache();
    const cold = github();
    expect((await reader(cold, cache).catalog().index({ id: 'example', title: 'Example', root: 'notes/example' })).map(note => note.path)).toEqual(['notes/example/alpha.md', 'notes/example/deep/beta.md']);
    expect(blobRequests(cold)).toBeGreaterThan(0);

    const warm = github();
    const notes = await reader(warm, cache).catalog().index({ id: 'example', title: 'Example', root: 'notes/example' });
    expect(notes.map(note => note.tags)).toEqual([['a'], []]);
    expect(blobRequests(warm)).toBe(0);
  });

  it('lists a tree once across server instances, still checking access and the branch head each time', async () => {
    const cache = new MemoryRemoteCache();
    const trees = (request: ReturnType<typeof github>) => request.mock.calls.filter(([url]) => String(url).includes('/git/trees/')).map(([url]) => String(url));
    const cold = github();
    await reader(cold, cache).getSnapshot();
    expect(trees(cold)).toHaveLength(1);

    // A new instance has its own GitHub runtime, as a fresh `fetch` double gives it here.
    const warm = github();
    const snapshot = await reader(warm, cache).getSnapshot();
    expect(trees(warm)).toEqual([]);
    expect(warm.mock.calls.map(([url]) => String(url).replace('https://api.github.com/repos/owner/repo', ''))).toEqual(['', '/commits/main']);
    expect(snapshot.entries).toEqual(tree());
    expect((await reader(warm, cache).catalog().index({ id: 'example', title: 'Example', root: 'notes/example' })).map(note => note.path)).toEqual(['notes/example/alpha.md', 'notes/example/deep/beta.md']);
  });

  it('lists the tree again when the cached listing is damaged', async () => {
    const damaged: RemoteCache = { get: async keys => keys.map(key => key.startsWith('mgn:tree:') ? '{not json' : null), set: async () => {} };
    const request = github();
    expect((await reader(request, damaged).getSnapshot()).entries).toEqual(tree());
    expect(request.mock.calls.some(([url]) => String(url).includes('/git/trees/'))).toBe(true);
  });

  it('looks up only blobs that the authorized tree lists', async () => {
    const keys: string[] = [];
    const cache: RemoteCache = {
      get: async requested => {
        keys.push(...requested);
        return requested.map(() => null);
      },
      set: async () => {},
    };
    const request = github();
    const source = reader(request, cache);
    await source.catalog().index({ id: 'example', title: 'Example', root: 'notes/example' });
    await expect(source.readFile('notes/example/absent.md')).rejects.toThrow(/unavailable/i);
    const allowed = new Set(tree().filter(entry => entry.type === 'blob').map(entry => `mgn:blob:v1:owner/repo:${entry.sha}`));
    const blobKeys = keys.filter(key => key.startsWith('mgn:blob:'));
    expect(blobKeys.length).toBeGreaterThan(0);
    expect(blobKeys.every(key => allowed.has(key))).toBe(true);
    // The only tree it asks for is the one its authorized commit read named.
    expect(keys.filter(key => !key.startsWith('mgn:blob:')).every(key => key.startsWith('mgn:index:v3:owner/repo:') || key === 'mgn:tree:v1:owner/repo:tree1')).toBe(true);
  });

  it('never stores content whose git object id does not match the tree', async () => {
    const stored: string[] = [];
    const cache: RemoteCache = {
      get: async keys => keys.map(() => null),
      set: async entries => {
        stored.push(...entries.map(([key]) => key));
      },
    };
    const source = reader(github({ corrupt: true }), cache);
    await source.readFile('notes/example/alpha.md');
    // The tree listing came from the authorized API; no tampered content reached the cache.
    expect(stored.filter(key => !key.startsWith('mgn:tree:'))).toEqual([]);
  });

  it('completes concurrent prefetches of different file sets', async () => {
    const request = github();
    const source = reader(request, new MemoryRemoteCache());
    await Promise.all([source.prefetchFiles(['notes/example/alpha.md']), source.prefetchFiles(['notes/example/deep/beta.md'])]);
    expect((await source.readFile('notes/example/deep/beta.md')).toString('utf8')).toBe(fixture['notes/example/deep/beta.md']);
    expect((await source.readFile('notes/example/alpha.md')).toString('utf8')).toBe(fixture['notes/example/alpha.md']);
  });

  it('ignores a cached value that does not hash to its key', async () => {
    const poisoned: RemoteCache = { get: async keys => keys.map(key => (key.startsWith('mgn:blob:') ? Buffer.from('tampered content', 'utf8').toString('base64') : null)), set: async () => {} };
    const request = github();
    const source = reader(request, poisoned);
    expect((await source.readFile('notes/example/alpha.md')).toString('utf8')).toBe(fixture['notes/example/alpha.md']);
    expect(blobRequests(request)).toBeGreaterThan(0);
  });
});

describe('GraphQL blob batches', () => {
  const entry = (index: number, size?: number) => ({ path: `notes/${index}.md`, type: 'blob', mode: '100644', sha: String(index).padStart(40, '0'), size });
  it('fills each request up to its count and byte bounds, keeping an oversized blob alone', () => {
    expect(blobBatches(Array.from({ length: 1001 }, (_, index) => entry(index, 10))).map(batch => batch.length)).toEqual([500, 500, 1]);
    const mb = 1024 * 1024;
    expect(blobBatches([entry(1, 3 * mb), entry(2, 2 * mb), entry(3, 5 * mb), entry(4), entry(5, mb)]).map(batch => batch.map(item => item.path))).toEqual([['notes/1.md'], ['notes/2.md'], ['notes/3.md'], ['notes/4.md', 'notes/5.md']]);
  });
});
