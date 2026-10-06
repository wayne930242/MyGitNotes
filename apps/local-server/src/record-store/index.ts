import { DirectoryRecordBackend } from './directory-backend.js';
import { type RecordStore, SealedRecordStore } from './record-store.js';
import { recordKeyPrefix, RedisRecordBackend, redisRestConnection, usesRedis } from './redis-backend.js';

export { DirectoryRecordBackend } from './directory-backend.js';
export { type GrantSummary, NoRecordStore, type RecordBackend, recordLifetime, type RecordStore, sealedElsewhere, SealedRecordStore } from './record-store.js';
export { recordKeyPrefix, RedisRecordBackend, redisRestConnection, usesRedis } from './redis-backend.js';
export { digest, random, seal, type StoredRecord, unseal } from './sealing.js';

/**
 * The community record store: Redis when the deployment configures it (and always on Vercel), otherwise the
 * local encrypted directory. The choice follows the environment at each operation, as it always has.
 */
export function createRecordStore(base: string): RecordStore {
  const redis = new RedisRecordBackend(recordKeyPrefix(), base), directory = new DirectoryRecordBackend(base);
  const store = new SealedRecordStore(() => usesRedis() ? redis : directory);
  // A Vercel function's directory does not survive the request, so there the store needs Redis.
  Object.defineProperty(store, 'ready', { get: () => !process.env.VERCEL || Boolean(process.env.REDIS_URL) || Boolean(redisRestConnection().url && redisRestConnection().token) });
  return store;
}

/**
 * How this deployment keeps sign-ins. `cookie` is the lightweight mode: chosen with MYGITNOTES_STORAGE=cookie,
 * and on Vercel whenever no Redis is configured, where a server directory would not survive.
 */
export function storageMode(env: NodeJS.ProcessEnv = process.env): 'cookie' | 'redis' | 'directory' {
  if (env.MYGITNOTES_STORAGE === 'cookie') return 'cookie';
  if (env.REDIS_URL || redisRestConnection(env).url) return 'redis';
  return env.VERCEL ? 'cookie' : 'directory';
}
