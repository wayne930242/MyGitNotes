import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordStore } from './record-store.js';
import { digest } from './sealing.js';

const id = (letter: string) => letter.repeat(43);

/**
 * The behavior every {@link RecordStore} must keep. An edition runs it against its own store:
 * `recordStoreContract('postgres', () => new SealedRecordStore(new PostgresBackend(pool)))`.
 * `makeStore` is called once per test, after SESSION_SECRET is set, and should start empty.
 */
export function recordStoreContract(name: string, makeStore: () => RecordStore | Promise<RecordStore>) {
  describe(`${name} record store contract`, () => {
    let store: RecordStore;
    beforeEach(async () => {
      vi.stubEnv('SESSION_SECRET', 'contract-secret'.repeat(4));
      store = await makeStore();
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    });

    it('round-trips a sealed value by id and by digest, and deletes it', async () => {
      await store.set(id('a'), { kind: 'session', login: 'octo' });
      expect(await store.get(id('a'))).toEqual({ kind: 'session', login: 'octo' });
      expect(await store.getByDigest(digest(id('a')))).toEqual({ kind: 'session', login: 'octo' });
      await store.delete(id('a'));
      expect(await store.get(id('a'))).toBeNull();
    });

    it('ignores ids and digests that are not opaque tokens', async () => {
      expect(await store.get('short')).toBeNull();
      expect(await store.getByDigest('not-a-digest')).toBeNull();
      await expect(store.delete('short')).resolves.toBeUndefined();
    });

    it('expires a record after its lifetime and keeps one without a lifetime', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      await store.set(id('b'), { kind: 'oauth' }, 600);
      await store.set(id('c'), { kind: 'credential' }, null);
      vi.setSystemTime(Date.now() + 601_000);
      expect(await store.get(id('b'))).toBeNull();
      expect(await store.get(id('c'))).toEqual({ kind: 'credential' });
    });

    it('treats a record sealed with another secret as missing without deleting it', async () => {
      await store.set(id('d'), { kind: 'session' });
      vi.stubEnv('SESSION_SECRET', 'another-secret'.repeat(4));
      expect(await store.get(id('d'))).toBeNull();
      vi.stubEnv('SESSION_SECRET', 'contract-secret'.repeat(4));
      expect(await store.get(id('d'))).toEqual({ kind: 'session' });
    });

    it("lists, records rejections for and revokes only the owner's agent grants", async () => {
      await store.set(id('e'), { kind: 'agent', ownerId: 7, name: 'older', write: false, source: 'home', createdAt: 1 }, null);
      await store.indexGrant(id('e'), 7);
      await store.set(id('f'), { kind: 'agent', ownerId: 7, name: 'newer', write: true, source: 'home', createdAt: 2 }, null);
      await store.indexGrant(id('f'), 7);
      await store.set(id('g'), { kind: 'agent', ownerId: 8, name: 'other', write: false, source: 'home', createdAt: 3 }, null);
      await store.indexGrant(id('g'), 8);
      await store.recordRejection(id('e'), 'grant-source');
      const grants = await store.listGrants(7);
      expect(grants.map(grant => grant.name)).toEqual(['newer', 'older']);
      expect(grants[1].lastRejection).toMatchObject({ reason: 'grant-source' });
      expect(await store.revokeGrant(digest(id('g')), 7)).toBe(false);
      expect(await store.revokeGrant(digest(id('e')), 7)).toBe(true);
      expect((await store.listGrants(7)).map(grant => grant.name)).toEqual(['newer']);
      expect(await store.get(id('e'))).toBeNull();
    });

    it('runs credential work one at a time for the same id', async () => {
      const order: string[] = [];
      const work = (label: string) =>
        store.withCredentialLock(id('h'), async () => {
          order.push(`${label}:start`);
          await new Promise(resolve => setTimeout(resolve, 5));
          order.push(`${label}:end`);
          return label;
        });
      expect(await Promise.all([work('one'), work('two')])).toEqual(['one', 'two']);
      expect(order).toEqual(['one:start', 'one:end', 'two:start', 'two:end']);
    });
  });
}
