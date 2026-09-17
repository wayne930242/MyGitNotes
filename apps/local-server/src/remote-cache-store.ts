import { MemoryRemoteCache, SourceError, type RemoteCache } from '@mygitnotes/core';
import { nativeRedisCommand } from './redis-store.js';

function restConnection() {
  return process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN
    ? { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }
    : { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
}

/** Shared remote read cache in the session Redis; errors end the request. */
export class RedisRemoteCache implements RemoteCache {
  private readonly prefix: string;
  constructor() {
    const namespace = process.env.MYGITNOTES_SESSION_NAMESPACE || '';
    this.prefix = namespace ? `gh-notes:${namespace}:cache:` : 'gh-notes:cache:';
  }
  private async rest(path: string, body: unknown): Promise<any> {
    const { url, token } = restConnection();
    if (!url || !token || !url.startsWith('https://')) throw new SourceError('Cache store is not configured.', 503);
    const response = await fetch(`${url}${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new SourceError('Cache store unavailable.', 503);
    return response.json();
  }
  async get(keys: string[]): Promise<(string | null)[]> {
    if (!keys.length) return [];
    const command = ['MGET', ...keys.map(key => this.prefix + key)];
    try {
      if (process.env.REDIS_URL) return await nativeRedisCommand(process.env.REDIS_URL, command);
      const body = await this.rest('', command) as { result?: (string | null)[]; error?: string };
      if (body.error || !Array.isArray(body.result)) throw new Error();
      return body.result;
    } catch (error) { throw error instanceof SourceError ? error : new SourceError('Cache store unavailable.', 503); }
  }
  async set(entries: [string, string][], ttlSeconds: number): Promise<void> {
    const commands = entries.map(([key, value]) => ['SET', this.prefix + key, value, 'EX', String(ttlSeconds)]);
    try {
      if (process.env.REDIS_URL) { for (const command of commands) await nativeRedisCommand(process.env.REDIS_URL, command); return; }
      for (let i = 0, bytes = 0, start = 0; i <= commands.length; i++) {
        const size = i < commands.length ? Buffer.byteLength(commands[i][2]) : 0;
        if (i === commands.length || (i > start && bytes + size > 800 * 1024)) {
          const results = await this.rest('/pipeline', commands.slice(start, i)) as { error?: string }[];
          if (!Array.isArray(results) || results.some(result => result.error)) throw new Error();
          start = i; bytes = 0;
        }
        bytes += size;
      }
    } catch (error) { throw error instanceof SourceError ? error : new SourceError('Cache store unavailable.', 503); }
  }
}

export function createRemoteCache(): RemoteCache {
  return process.env.REDIS_URL || restConnection().url ? new RedisRemoteCache() : new MemoryRemoteCache();
}
