import type { Request, Response } from 'express';
import { type R2Settings, r2SettingsFromEnv } from '@mygitnotes/core';
import type { RepositoryHandle } from './request-workspace.js';

/** What one request may use of the R2 bucket. */
export interface AssetScope {
  settings: R2Settings;
  /** The key prefix every object of this request lives under: empty, or ending in `/`. Keys outside it answer 404. */
  prefix: string;
  limits: {
    /** The largest object one upload may declare. */
    maxObjectBytes: number;
  };
}

/** Decides which bucket and key space a request reaches, and lets an edition meter what it stores there (docs/adr/0002-open-core-editions.md). */
export interface AssetStorage {
  /** The bucket and the key prefix this request may use, or null when R2 is not available to it. */
  resolve(req: Request, res: Response, repository: RepositoryHandle): Promise<AssetScope | null>;
  /** Called before an upload URL is signed; throws a SourceError (413) when the upload would exceed a quota. */
  reserve?(scope: AssetScope, bytes: number): Promise<void>;
  /** Called after an object is created, copied or deleted, with the signed size change. */
  record?(scope: AssetScope, key: string, deltaBytes: number): Promise<void>;
}

/** R2 accepts at most 5 GiB in one PUT, and a presigned upload is a single PUT. */
export const R2_MAX_OBJECT_BYTES = 5 * 1024 ** 3;

/** The community behavior: the bucket comes from the deployment's environment, every key is allowed, and nothing is metered. */
export function envAssetStorage(env: NodeJS.ProcessEnv = process.env): AssetStorage {
  return {
    resolve: async () => {
      const settings = r2SettingsFromEnv(env);
      return settings && { settings, prefix: '', limits: { maxObjectBytes: R2_MAX_OBJECT_BYTES } };
    },
  };
}

/** Whether `key` lies in `scope`'s key space. */
export const inAssetScope = (scope: AssetScope, key: string) => key.startsWith(scope.prefix);
