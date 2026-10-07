import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { type AssetStorage, envAssetStorage, inAssetScope, resolveAssetScope } from '../src/asset-storage.js';
import { assetStorageContract } from '../src/asset-storage-contract.js';
import type { RepositoryHandle } from '../src/request-workspace.js';

const R2_ENV = { MYGITNOTES_R2_ACCOUNT_ID: 'acc', MYGITNOTES_R2_ACCESS_KEY_ID: 'AK', MYGITNOTES_R2_SECRET_ACCESS_KEY: 'secret', MYGITNOTES_R2_BUCKET: 'assets' };
const request = () => ({ req: {} as Request, res: {} as Response, repository: {} as RepositoryHandle });

assetStorageContract('environment', () => ({ storage: envAssetStorage(R2_ENV), available: request }));

describe('environment asset storage', () => {
  it("keeps today's behavior: the bucket from the environment, every key, no quota hooks", async () => {
    const storage = envAssetStorage(R2_ENV);
    const { req, res, repository } = request();
    const scope = await storage.resolve(req, res, repository);
    expect(scope).toMatchObject({ prefix: '', settings: { accountId: 'acc', bucket: 'assets' } });
    expect(storage.reserve).toBeUndefined();
    expect(storage.record).toBeUndefined();
    expect(storage.moved).toBeUndefined();
  });

  it('has no scope when R2 is not configured', async () => {
    const { req, res, repository } = request();
    expect(await envAssetStorage({}).resolve(req, res, repository)).toBeNull();
  });
});

describe('asset scope prefixes', () => {
  const scoped = (prefix: string): AssetStorage => ({ resolve: async () => ({ settings: { accountId: 'acc', accessKeyId: 'AK', secretAccessKey: 's', bucket: 'assets' }, prefix, limits: { maxObjectBytes: 1 } }) });
  const { req, res, repository } = request();

  it('accepts an empty prefix and one that ends in a slash', async () => {
    for (const prefix of ['', 'r/', 'r/12/']) expect(await resolveAssetScope(scoped(prefix), req, res, repository)).toMatchObject({ prefix });
  });

  it('refuses a prefix that does not end in a slash, which would also cover a sibling such as r/123/', async () => {
    await expect(resolveAssetScope(scoped('r/12'), req, res, repository)).rejects.toMatchObject({ status: 500, message: expect.stringContaining('end in "/"') });
    expect(() => inAssetScope({ prefix: 'r/12' }, 'r/123/a.pdf')).toThrow(/end in "\/"/);
    expect(inAssetScope({ prefix: 'r/12/' }, 'r/123/a.pdf')).toBe(false);
    expect(inAssetScope({ prefix: 'r/12/' }, 'r/12/a.pdf')).toBe(true);
  });
});
