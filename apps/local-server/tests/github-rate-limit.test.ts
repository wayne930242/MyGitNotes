import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createApp } from '../src/app.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('returns a Retry-After header and shares the upstream cooldown across HTTP requests', async () => {
  vi.stubEnv('GITHUB_NOTES_SOURCE', 'github');
  vi.stubEnv('GITHUB_NOTES_REPOSITORY', 'owner/repo');
  vi.stubEnv('GITHUB_NOTES_BRANCH', 'main');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_URL', '');
  const original = globalThis.fetch;
  let upstream = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).startsWith('https://api.github.com/')) {
      upstream++;
      return new Response('{}', { status: 429, headers: { 'Retry-After': '120' } });
    }
    return original(input, init);
  });
  const server = createServer(createApp(process.cwd()));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    for (const endpoint of ['/api/workspace', '/api/notes']) {
      const response = await fetch(base + endpoint);
      expect(response.status).toBe(429);
      expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(119);
      expect((await response.json()).retryAfter).toBeGreaterThanOrEqual(119);
    }
    expect(upstream).toBe(1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
