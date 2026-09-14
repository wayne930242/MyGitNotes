import { afterEach, expect, it, vi } from 'vitest';
import { SessionStore } from '../src/auth.js';

const id = 's'.repeat(43);
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('isolates credentials, grants, revocation and refresh locks while retaining legacy Redis keys', async () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('MYGITNOTES_SESSION_NAMESPACE', '');
  vi.stubEnv('SESSION_SECRET', 'legacy'.repeat(10));
  const values = new Map<string, string>(), sets = new Map<string, Set<string>>();
  const commands: string[][] = [];
  vi.spyOn(SessionStore.prototype, 'command').mockImplementation(async command => {
    commands.push(command);
    const [op, key, ...args] = command;
    if (op === 'GET') return values.get(key) ?? null;
    if (op === 'SET') { values.set(key, args[0]); return 'OK'; }
    if (op === 'DEL') return Number(values.delete(key));
    if (op === 'SADD') { const set = sets.get(key) || new Set<string>(); set.add(args[0]); sets.set(key, set); return 1; }
    if (op === 'SMEMBERS') return [...(sets.get(key) || [])];
    if (op === 'SREM') return Number(sets.get(key)?.delete(args[0]));
    if (op === 'EVAL') return Number(values.delete(args[1]));
    throw new Error('Unexpected Redis command');
  });
  const legacy = new SessionStore('/tmp/namespace-fixture');
  await legacy.set(id, { kind: 'agent', ownerId: 42, name: 'legacy' }, null);
  await legacy.indexGrant(id, 42);
  const original = new Map(values);
  vi.stubEnv('MYGITNOTES_SESSION_NAMESPACE', 'gitlab-test');
  vi.stubEnv('SESSION_SECRET', 'test'.repeat(16));
  const isolated = new SessionStore('/tmp/namespace-fixture');
  expect(await isolated.get(id)).toBeNull();
  expect(await isolated.listGrants(42)).toEqual([]);
  await isolated.set(id, { kind: 'agent', ownerId: 42, name: 'test' }, null);
  await isolated.indexGrant(id, 42);
  const [grant] = await isolated.listGrants(42);
  expect(grant.name).toBe('test');
  await isolated.withCredentialLock(id, async () => expect(await isolated.get(id)).toMatchObject({ name: 'test' }));
  expect(commands.some(c => c[0] === 'SET' && c[1].startsWith('gh-notes:gitlab-test:refresh:'))).toBe(true);
  expect(await isolated.revokeGrant(grant.id, 42)).toBe(true);
  expect(values).toEqual(original);
  vi.stubEnv('SESSION_SECRET', 'legacy'.repeat(10));
  expect((await legacy.listGrants(42))[0].name).toBe('legacy');
});

it('uses the native Vercel Upstash REST variables and rejects invalid namespaces', async () => {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  vi.stubEnv('KV_REST_API_URL', 'https://redis.example.test');
  vi.stubEnv('KV_REST_API_TOKEN', 'fixture-redis-token');
  vi.stubEnv('MYGITNOTES_SESSION_NAMESPACE', 'test');
  const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: 'PONG' })));
  expect(await new SessionStore('/tmp/namespace-fixture').command(['PING'])).toBe('PONG');
  expect(request).toHaveBeenCalledWith('https://redis.example.test', expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer fixture-redis-token' }) }));
  vi.stubEnv('MYGITNOTES_SESSION_NAMESPACE', 'invalid:namespace');
  expect(() => new SessionStore('/tmp/namespace-fixture')).toThrow('MYGITNOTES_SESSION_NAMESPACE');
});
