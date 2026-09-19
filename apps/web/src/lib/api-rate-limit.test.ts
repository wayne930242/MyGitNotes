import { afterEach, expect, it, vi } from 'vitest';
import { fetchWorkspace, readNote, readNotes } from './api.js';
import { fetchR2References } from './r2-api.js';

afterEach(() => vi.unstubAllGlobals());
it('preserves the upstream retry time so background polling can pause', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Wait for GitHub', retryAfter: 120 }), { status: 429, headers: { 'Retry-After': '120' } })));
  await expect(readNote('notes/ex/a.md')).rejects.toMatchObject({ status: 429, retryAfter: 120 });
});
it('propagates retry hints through R2 API errors', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'GitHub API is temporarily rate limited. Retry in 7 seconds.', retryAfter: 7 }), { status: 429, headers: { 'Retry-After': '7' } })));
  await expect(fetchR2References('ex', 'ex/old', true)).rejects.toMatchObject({ status: 429, retryAfter: 7 });
});
it('requests a fresh commit base and reads selected notes together at that revision', async () => {
  const requests: { url: string; body: any; }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, body: init?.body && JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ notes: [], revision: 'a'.repeat(40) }));
    }),
  );
  await fetchWorkspace(true);
  await readNotes(['notes/ex/a.md', 'notes/ex/b.md'], 'a'.repeat(40));
  expect(requests).toEqual([{ url: '/api/workspace?fresh=1', body: undefined }, { url: '/api/notes/read-batch', body: { paths: ['notes/ex/a.md', 'notes/ex/b.md'], revision: 'a'.repeat(40) } }]);
});
