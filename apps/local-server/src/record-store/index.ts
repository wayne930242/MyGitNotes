import { DirectoryRecordBackend } from './directory-backend.js';
import { type RecordStore, SealedRecordStore } from './record-store.js';
import { recordKeyPrefix, RedisRecordBackend, usesRedis } from './redis-backend.js';

export { DirectoryRecordBackend } from './directory-backend.js';
export { type GrantSummary, type RecordBackend, recordLifetime, type RecordStore, SealedRecordStore, sealedElsewhere } from './record-store.js';
export { recordKeyPrefix, RedisRecordBackend, redisRestConnection, usesRedis } from './redis-backend.js';
export { digest, random, seal, type StoredRecord, unseal } from './sealing.js';

/**
 * The community record store: Redis when the deployment configures it (and always on Vercel), otherwise the
 * local encrypted directory. The choice follows the environment at each operation, as it always has.
 */
export function createRecordStore(base: string): RecordStore {
  const redis = new RedisRecordBackend(recordKeyPrefix(), base), directory = new DirectoryRecordBackend(base);
  return new SealedRecordStore(() => usesRedis() ? redis : directory);
}
