import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import type { AssetStorage } from './asset-storage.js';
import type { RepositoryHandle } from './request-workspace.js';

/** What an {@link AssetStorage} needs the contract to ask it. */
export interface AssetStorageFixture {
  storage: AssetStorage;
  /** A request, response and repository the storage resolves to a scope. */
  available(): { req: Request; res: Response; repository: RepositoryHandle; };
  /** A request the storage has no bucket for; omit it when every request has one. */
  unavailable?(): { req: Request; res: Response; repository: RepositoryHandle; };
}

/**
 * The behavior every {@link AssetStorage} must keep. An edition runs it against its own implementation:
 * `assetStorageContract('tenant', () => ({ storage: tenantAssets(sql), available: () => signedInAs(octo) }))`.
 * `makeFixture` is called once per test.
 */
export function assetStorageContract(name: string, makeFixture: () => AssetStorageFixture | Promise<AssetStorageFixture>) {
  describe(`${name} asset storage contract`, () => {
    const scoped = async () => {
      const fixture = await makeFixture();
      const { req, res, repository } = fixture.available();
      const scope = await fixture.storage.resolve(req, res, repository);
      if (!scope) throw new Error('The available request resolved no scope.');
      return { fixture, scope };
    };

    it('names a bucket, a key prefix that is empty or ends in a slash, and an object size limit', async () => {
      const { scope } = await scoped();
      expect(scope.settings.bucket).toBeTruthy();
      expect(scope.prefix === '' || scope.prefix.endsWith('/')).toBe(true);
      expect(Number.isSafeInteger(scope.limits.maxObjectBytes)).toBe(true);
      expect(scope.limits.maxObjectBytes).toBeGreaterThan(0);
    });

    it('resolves the same scope for the same request', async () => {
      const { fixture, scope } = await scoped();
      const { req, res, repository } = fixture.available();
      const again = await fixture.storage.resolve(req, res, repository);
      expect(again?.prefix).toBe(scope.prefix);
      expect(again?.settings.bucket).toBe(scope.settings.bucket);
    });

    it('answers null when R2 is not available to the request', async () => {
      const fixture = await makeFixture();
      if (!fixture.unavailable) return;
      const { req, res, repository } = fixture.unavailable();
      expect(await fixture.storage.resolve(req, res, repository)).toBeNull();
    });

    it('lets a quota hook refuse an upload with a SourceError and accepts an upload within it', async () => {
      const { fixture, scope } = await scoped();
      if (!fixture.storage.reserve) return;
      await expect(fixture.storage.reserve(scope, 0)).resolves.toBeUndefined();
      await expect(fixture.storage.reserve(scope, scope.limits.maxObjectBytes + 1)).rejects.toMatchObject({ status: 413 });
    });
  });
}
