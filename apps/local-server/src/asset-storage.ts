import type { Request, Response } from 'express';
import { assertAssetPrefix, type AssetScope, R2_MAX_OBJECT_BYTES, r2SettingsFromEnv } from '@mygitnotes/core';
import type { RepositoryHandle } from './request-workspace.js';

export { type AssetScope, inAssetScope, R2_MAX_OBJECT_BYTES } from '@mygitnotes/core';

/** Decides which bucket and key space a request reaches, and lets an edition meter what it stores there (docs/adr/0002-open-core-editions.md). */
export interface AssetStorage {
  /** The bucket and the key prefix this request may use, or null when R2 is not available to it. A non-empty prefix must end in `/`. */
  resolve(req: Request, res: Response, repository: RepositoryHandle): Promise<AssetScope | null>;
  /**
   * Called before an upload URL is signed, with the exact key and the declared size (the signed `Content-Length`);
   * throws a SourceError (413) when the upload would exceed a quota. An edition that counts concurrent uploads
   * stores a pending row for `key` here, so uploads that are never confirmed still count until it clears them.
   */
  reserve?(scope: AssetScope, key: string, bytes: number): Promise<void>;
  /**
   * Called after an object is created, copied or deleted, with the signed size change. For an upload it runs
   * when the browser confirms the key at `/api/r2/uploaded`, with the size the bucket reports; a browser may
   * confirm the same key again, so an edition keeps one row per key (a positive change for a key that has a
   * row sets it, and confirms a pending one) and a repeat changes nothing.
   */
  record?(scope: AssetScope, key: string, deltaBytes: number): Promise<void>;
  /**
   * Called when a move has finished with one object: the notes now reference `to`, the object is there with `bytes`,
   * and `from` has been deleted. An edition that keeps one row per key re-keys the row of `from` to `to`, so a move
   * neither charges the person who moved it nor frees the person who uploaded it. A key with no row is charged as
   * `record` would. When an edition defines this, a move calls it instead of `record` for the copy and the delete,
   * and an undone move calls nothing, because the quota never changed.
   */
  moved?(scope: AssetScope, from: string, to: string, bytes: number): Promise<void>;
}

/** The community behavior: the bucket comes from the deployment's environment, every key is allowed, and nothing is metered. */
export function envAssetStorage(env: NodeJS.ProcessEnv = process.env): AssetStorage {
  return {
    resolve: async () => {
      const settings = r2SettingsFromEnv(env);
      return settings && { settings, prefix: '', limits: { maxObjectBytes: R2_MAX_OBJECT_BYTES } };
    },
  };
}

/** `storage.resolve`, failing fast on a scope whose prefix could reach a sibling folder. */
export async function resolveAssetScope(storage: AssetStorage, req: Request, res: Response, repository: RepositoryHandle): Promise<AssetScope | null> {
  const scope = await storage.resolve(req, res, repository);
  if (scope) assertAssetPrefix(scope.prefix);
  return scope;
}
