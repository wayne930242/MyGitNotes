import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { GitHubSource } from '../src/github-source.js';

const manifest = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n';
const blobSha = (value: string) => createHash('sha1').update(`blob ${Buffer.byteLength(value)}\0${value}`).digest('hex');
async function fixture(count = 100) {
  const files: Record<string, string> = { 'notes/.github-notes.yaml': manifest };
  for (let i = 0; i < count; i++) files[`notes/ex/n${i}.md`] = `# Note ${i}\n`;
  const entries = Object.entries(files).map(([path, content]) => ({ path, type: 'blob', mode: '100644', sha: blobSha(content), size: Buffer.byteLength(content) }));
  const pack = tar.pack(); const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    pack.on('data', chunk => chunks.push(chunk)); pack.on('end', () => resolve(gzipSync(Buffer.concat(chunks)))); pack.on('error', reject);
  });
  for (const [file, text] of Object.entries(files)) pack.entry({ name: `repo-head/${file}` }, text);
  pack.finalize(); const archive = await finished;
  const calls: { url: string; init: RequestInit }[] = [];
  let head = 'a'.repeat(40); let permitted = true;
  const request = vi.fn(async (input: any, init: RequestInit = {}) => {
    const url = String(input); calls.push({ url, init });
    const headers = new Headers(init.headers);
    const json = (data: unknown, etag?: string) => etag && headers.get('if-none-match') === etag
      ? new Response(null, { status: 304 }) : new Response(JSON.stringify(data), { headers: etag ? { etag } : {} });
    if (headers.get('Authorization') === 'Bearer denied' || !permitted) return new Response('{}', { status: 404 });
    if (url.startsWith('https://codeload.github.com/')) return new Response(archive);
    const endpoint = url.replace('https://api.github.com/repos/owner/repo', '');
    if (init.method && init.method !== 'GET') return json({ sha: 'b'.repeat(40) });
    if (!endpoint) return json({ private: false, permissions: { push: true } }, '"repo"');
    if (endpoint.startsWith('/commits/')) return json({ sha: head, commit: { tree: { sha: 'c'.repeat(40) } } }, `"${head}"`);
    if (endpoint.startsWith('/git/trees/')) return json({ tree: entries, truncated: false });
    if (endpoint.startsWith('/tarball/')) return new Response(null, { status: 302, headers: { location: 'https://codeload.github.com/owner/repo/legacy.tar.gz/' + head } });
    if (endpoint.startsWith('/git/blobs/')) {
      const entry = entries.find(e => e.sha === endpoint.slice('/git/blobs/'.length));
      return json({ encoding: 'base64', content: Buffer.from(files[entry!.path]).toString('base64') });
    }
    throw new Error(`Unexpected fixture endpoint: ${endpoint}`);
  }) as typeof fetch;
  return { calls, request, reader: (token?: string) => new GitHubSource('owner/repo', 'main', token, request),
    revoke: () => { permitted = false; }, advance: () => { head = 'd'.repeat(40); } };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('GitHub request budgets', () => {
  it('loads 100 anonymous notes within one hourly budget and reuses unchanged content across readers', async () => {
    const f = await fixture();
    expect(await f.reader().notes()).toHaveLength(100);
    expect(f.calls.length).toBe(6); // Five REST calls plus one archive download, independent of note count.
    const before = f.calls.length;
    expect(await f.reader().notes()).toHaveLength(100);
    expect(f.calls.length - before).toBeLessThanOrEqual(2);
  });
  it('coalesces parallel reads and keeps cached private data scoped to credentials', async () => {
    const f = await fixture(1);
    const notes = await Promise.all(Array.from({ length: 6 }, () => f.reader('allowed').note('notes/ex/n0.md')));
    expect(notes.every(n => n.title === 'Note 0')).toBe(true);
    expect(f.calls.length).toBeLessThanOrEqual(5);
    await expect(f.reader('denied').note('notes/ex/n0.md')).rejects.toMatchObject({ status: 404 });
  });
  it('revalidates cached data after its freshness window and fails closed on lost access', async () => {
    const f = await fixture(1); let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    await f.reader('allowed').note('notes/ex/n0.md'); now += 61_000;
    expect((await f.reader('allowed').note('notes/ex/n0.md')).title).toBe('Note 0');
    expect(f.calls.some(c => new Headers(c.init.headers).has('If-None-Match'))).toBe(true);
    f.revoke(); now += 61_000;
    await expect(f.reader('allowed').note('notes/ex/n0.md')).rejects.toMatchObject({ status: 404 });
  });
  it('shares a retry-after cooldown across readers and repositories without retrying writes', async () => {
    const request = vi.fn(async () => new Response('{"message":"secondary rate limit"}', { status: 429, headers: { 'retry-after': '120' } }));
    const reader = () => new GitHubSource('owner/repo', 'main', 'token', request);
    await expect(reader().notes()).rejects.toMatchObject({ status: 429, retryAfter: 120 });
    await expect(new GitHubSource('owner/other', 'main', 'token', request).notes()).rejects.toMatchObject({ status: 429 });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('creates one text tree for 100 notes and still rejects a stale cached revision before writes', async () => {
    const f = await fixture(); await f.reader('allowed').notes();
    const notes = Array.from({ length: 100 }, (_, i) => ({ path: `notes/ex/n${i}.md`, content: '# Changed', metadata: {} }));
    const before = f.calls.length;
    const workspace = f.reader('allowed'); await workspace.getSnapshot(true); await workspace.config();
    await f.reader('allowed').readNotes(notes.map(note => note.path), 'a'.repeat(40));
    await f.reader('allowed').commitNotes(notes, 'a'.repeat(40), 'docs(notes): update');
    expect(f.calls.length - before).toBe(9); // Includes the browser's fresh workspace and batch review.
    const writes = f.calls.filter(c => c.init.method && c.init.method !== 'GET');
    expect(writes).toHaveLength(3);
    const body = JSON.parse(String(writes[0].init.body));
    expect(body.tree).toHaveLength(100); expect(body.tree[0].content).toContain('# Changed');
    expect(body.tree[0]).not.toHaveProperty('sha');
    f.advance();
    await expect(f.reader('allowed').commitNotes(notes, 'a'.repeat(40), 'stale')).rejects.toMatchObject({ status: 409 });
    expect(f.calls.filter(c => c.init.method && c.init.method !== 'GET')).toHaveLength(3);
  });
  it('reads selected notes against one fresh revision and rejects a changed branch', async () => {
    const f = await fixture();
    const notes = await f.reader('allowed').readNotes(['notes/ex/n0.md', 'notes/ex/n1.md'], 'a'.repeat(40));
    expect(notes.map(note => note.title)).toEqual(['Note 0', 'Note 1']);
    expect(f.calls.length).toBeLessThanOrEqual(6);
    f.advance();
    await expect(f.reader('allowed').readNotes(['notes/ex/n0.md'], 'a'.repeat(40))).rejects.toMatchObject({status:409});
  });
  it('does not forward credentials to archive download URLs', async () => {
    const f = await fixture(); await f.reader('allowed').notes();
    const download = f.calls.find(call => call.url.startsWith('https://codeload.github.com/'))!;
    expect(new Headers(download.init.headers).has('Authorization')).toBe(false);
  });
  it('does not follow a foreign archive redirect or continue with individual requests', async () => {
    const f = await fixture();
    const request = vi.fn(async (input: any, init?: RequestInit) => String(input).includes('/tarball/')
      ? new Response(null, { status: 302, headers: { location: 'https://example.com/steal' } }) : f.request(input, init));
    await expect(new GitHubSource('owner/repo', 'main', 'allowed', request).notes()).rejects.toMatchObject({status:502});
    expect(request.mock.calls.some(([url]) => String(url).startsWith('https://example.com/'))).toBe(false);
  });
  it('uses the primary reset deadline, resumes afterwards, and keeps other credentials independent', async () => {
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    const reset = Math.ceil(now / 1000) + 300;
    const request = vi.fn(async () => new Response('{}', { status: 403, headers: {'x-ratelimit-remaining':'0','x-ratelimit-reset':String(reset)} }));
    const first = new GitHubSource('owner/repo', 'main', 'one', request);
    await expect(first.notes()).rejects.toMatchObject({status:429});
    await expect(new GitHubSource('owner/other', 'main', 'one', request).notes()).rejects.toMatchObject({status:429});
    expect(request).toHaveBeenCalledTimes(1);
    await expect(new GitHubSource('owner/repo', 'main', 'two', request).notes()).rejects.toMatchObject({status:429});
    expect(request).toHaveBeenCalledTimes(2);
    now = (reset + 1) * 1000;
    await expect(new GitHubSource('owner/repo', 'main', 'one', request).notes()).rejects.toMatchObject({status:429});
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('keeps ordinary permission errors separate from quota errors and rechecks revoked cached access immediately', async () => {
    const denied = vi.fn(async () => new Response('{"message":"Resource not accessible"}', {status:403}));
    const source = new GitHubSource('owner/repo', 'main', 'one', denied);
    await expect(source.api('')).rejects.toMatchObject({status:403, retryAfter:undefined});
    await expect(source.api('')).rejects.toMatchObject({status:403});
    expect(denied).toHaveBeenCalledTimes(2);
    const f = await fixture(1); await f.reader('allowed').notes(); f.revoke();
    await expect(f.reader('allowed').notes()).rejects.toMatchObject({status:404});
  });
  it('retains deleted draft paths as missing and keeps path guards on batch reads', async () => {
    const f = await fixture(1);
    expect(await f.reader('allowed').readNotes(['notes/ex/deleted.md'], 'a'.repeat(40))).toEqual([]);
    await expect(f.reader('allowed').readNotes(['notes/ex/../../.env'], 'a'.repeat(40))).rejects.toThrow();
  });
});
