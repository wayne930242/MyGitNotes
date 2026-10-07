import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { envAssetStorage } from '../src/asset-storage.js';
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
  });

  it('has no scope when R2 is not configured', async () => {
    const { req, res, repository } = request();
    expect(await envAssetStorage({}).resolve(req, res, repository)).toBeNull();
  });
});
