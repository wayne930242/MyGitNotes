import { SourceError } from '@mygitnotes/core';
import { nativeRedisCommand } from '../redis-store.js';
import type { RecordBackend } from './record-store.js';
import { digest, random } from './sealing.js';

export function redisRestConnection() {
  return process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN ? { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN } : { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
}

/** Whether this deployment keeps records in Redis: native Redis, Redis REST, or any Vercel deployment. */
export function usesRedis() {
  return Boolean(process.env.REDIS_URL || process.env.VERCEL || redisRestConnection().url);
}

/** The key prefix of this deployment, isolated by MYGITNOTES_SESSION_NAMESPACE when several share one database. */
export function recordKeyPrefix() {
  const namespace = process.env.MYGITNOTES_SESSION_NAMESPACE || '';
  if (namespace && !/^[A-Za-z0-9_-]{1,64}$/.test(namespace)) throw new Error('MYGITNOTES_SESSION_NAMESPACE must contain 1-64 letters, digits, underscores or hyphens.');
  return namespace ? `gh-notes:${namespace}` : 'gh-notes';
}

/** Records in native Redis (REDIS_URL) or Redis REST (Upstash or Vercel KV variables). */
export class RedisRecordBackend implements RecordBackend {
  readonly scope: string;
  /** `owner` names the server that holds this backend, so its in-process lock queue is its own. */
  constructor(private readonly prefix: string, owner = '') {
    this.scope = `redis:${prefix}:${owner}`;
  }
  async command(command: string[]): Promise<unknown> {
    if (process.env.REDIS_URL) return nativeRedisCommand(process.env.REDIS_URL, command);
    const { url, token } = redisRestConnection();
    if (!url || !token || !url.startsWith('https://')) throw new Error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for server-held sessions.');
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
    if (!response.ok) throw new Error('Session store unavailable.');
    const body = await response.json() as { result: unknown; error?: string; };
    if (body.error) throw new Error('Session store command failed.');
    return body.result;
  }
  async put(hash: string, sealed: string, ttl: number | null) {
    await this.command(['SET', `${this.prefix}:${hash}`, sealed, ...(ttl === null ? [] : ['EX', String(ttl)])]);
  }
  async fetch(hash: string) {
    return await this.command(['GET', `${this.prefix}:${hash}`]) as string | null;
  }
  async remove(hash: string) {
    await this.command(['DEL', `${this.prefix}:${hash}`]);
  }
  async grantCandidates(ownerId: number | string) {
    return await this.command(['SMEMBERS', `${this.prefix}:grants:${ownerId}`]) as string[];
  }
  async addGrant(ownerId: number | string, hash: string) {
    await this.command(['SADD', `${this.prefix}:grants:${ownerId}`, hash]);
  }
  async forgetGrant(ownerId: number | string, hash: string) {
    await this.command(['SREM', `${this.prefix}:grants:${ownerId}`, hash]);
  }
  async lockAcrossInstances(id: string) {
    const nonce = random(), key = `${this.prefix}:refresh:${digest(id)}`;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await this.command(['SET', key, nonce, 'NX', 'PX', '30000']) === 'OK') {
        return async () => {
          await this.command(['EVAL', "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", '1', key, nonce]);
        };
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new SourceError('Authorization refresh is busy. Retry shortly.', 503);
  }
}
