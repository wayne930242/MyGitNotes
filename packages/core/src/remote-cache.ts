import { createHash } from 'node:crypto';

/** Content-addressed storage shared by remote readers. Values are strings; missing keys return null. */
export interface RemoteCache {
  get(keys: string[]): Promise<(string | null)[]>;
  set(entries: [string, string][], ttlSeconds: number): Promise<void>;
}

export const REMOTE_CACHE_TTL = 30 * 24 * 60 * 60;
/** Largest cached value; keeps single Redis REST requests small. */
export const REMOTE_CACHE_MAX_VALUE = 700 * 1024;
/** Estimated value bytes per multi-key read. */
export const REMOTE_CACHE_BATCH_BYTES = 800 * 1024;

/** Process-local cache used when no shared store is configured. */
export class MemoryRemoteCache implements RemoteCache {
  private entries = new Map<string, { value: string; expires: number; }>();
  private bytes = 0;
  constructor(private maxBytes = 64 * 1024 * 1024) {}
  async get(keys: string[]): Promise<(string | null)[]> {
    return keys.map(key => {
      const entry = this.entries.get(key);
      if (!entry) return null;
      this.entries.delete(key);
      if (entry.expires <= Date.now()) {
        this.bytes -= entry.value.length;
        return null;
      }
      this.entries.set(key, entry);
      return entry.value;
    });
  }
  async set(entries: [string, string][], ttlSeconds: number): Promise<void> {
    for (const [key, value] of entries) {
      const previous = this.entries.get(key);
      if (previous) {
        this.bytes -= previous.value.length;
        this.entries.delete(key);
      }
      if (value.length > this.maxBytes) continue;
      while (this.bytes + value.length > this.maxBytes) {
        const oldest = this.entries.keys().next().value!;
        this.bytes -= this.entries.get(oldest)!.value.length;
        this.entries.delete(oldest);
      }
      this.entries.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
      this.bytes += value.length;
    }
  }
}

/** Git object id of blob content; SHA-256 repositories use 64-character ids. */
export function gitBlobId(bytes: Buffer, idLength: number): string {
  return createHash(idLength === 64 ? 'sha256' : 'sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

export const hashJson = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
