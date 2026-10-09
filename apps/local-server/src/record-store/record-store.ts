import { digest, seal, sealingKey, type StoredRecord, unseal } from './sealing.js';

export const sealedElsewhere = Symbol('sealed with another SESSION_SECRET');
export const recordLifetime = 30 * 24 * 60 * 60;
const rejectionLifetime = 7 * 24 * 60 * 60;
const opaqueId = /^[A-Za-z0-9_-]{43}$/, recordDigest = /^[a-f0-9]{64}$/;

export interface GrantSummary {
  id: string;
  name: string;
  write: boolean;
  /** A grant made before grants bound to a person and site: the one repository it reaches while that repository is a visible member. */
  source?: string;
  /** A grant bound to a person and site: the site whose visible repositories it reaches. */
  site?: string;
  createdAt: number;
  expiresAt: null;
  lastRejection: StoredRecord | null;
}

/** Encrypted server records: sessions, provider credentials, OAuth state and persistent agent grants. */
export interface RecordStore {
  /** Whether records outlive the process and are shared by every instance (persistent agent grants need this). */
  readonly durable: boolean;
  /** False while the store lacks configuration it needs to keep records (the community store on Vercel without Redis); absent counts as ready. */
  readonly ready?: boolean;
  set(id: string, value: unknown, ttlSeconds?: number | null): Promise<void>;
  get(id: string): Promise<StoredRecord | null>;
  /** Returns the stored value, null, or the sealedElsewhere marker. */
  readRecord(id: string): Promise<StoredRecord | typeof sealedElsewhere | null>;
  getByDigest(hash: string): Promise<StoredRecord | null>;
  delete(id: string): Promise<void>;
  deleteByDigest(hash: string): Promise<void>;
  /** Serializes credential refreshes in this process and, when the backend can, across instances. */
  withCredentialLock<T>(id: string, work: () => Promise<T>): Promise<T>;
  recordRejection(token: string, reason: string): Promise<void>;
  indexGrant(token: string, ownerId: number | string): Promise<void>;
  listGrants(ownerId: number | string): Promise<GrantSummary[]>;
  revokeGrant(id: string, ownerId: number | string): Promise<boolean>;
}

/**
 * Raw storage under a {@link SealedRecordStore}: values arrive sealed and are addressed by the sha256 digest of
 * their id. A new store (Postgres in the Pro edition) implements these operations and inherits sealing, expiry,
 * grant listing and lock ordering.
 */
export interface RecordBackend {
  /** Distinguishes in-process lock queues of backends that share ids but not storage. */
  readonly scope: string;
  put(hash: string, sealed: string, ttlSeconds: number | null): Promise<void>;
  fetch(hash: string): Promise<string | null>;
  remove(hash: string): Promise<void>;
  /** Digests that may be grants of an owner; stale or foreign entries are filtered by the caller. */
  grantCandidates(ownerId: number | string): Promise<string[]>;
  addGrant(ownerId: number | string, hash: string): Promise<void>;
  forgetGrant(ownerId: number | string, hash: string): Promise<void>;
  /** Takes a lock shared with other instances and returns its release, or null when the backend is process-local. */
  lockAcrossInstances(id: string): Promise<(() => Promise<void>) | null>;
}

const credentialLocks = new Map<string, Promise<void>>();

/** A {@link RecordStore} over any {@link RecordBackend}; a function backend is resolved on every operation. */
export class SealedRecordStore implements RecordStore {
  readonly durable = true;
  constructor(private readonly backend: RecordBackend | (() => RecordBackend)) {}
  private get raw() {
    return typeof this.backend === 'function' ? this.backend() : this.backend;
  }
  async set(id: string, value: unknown, ttl: number | null = recordLifetime) {
    await this.raw.put(digest(id), seal({ value, expires: ttl === null ? null : Date.now() + ttl * 1000 }), ttl);
  }
  async get(id: string) {
    const value = await this.readRecord(id);
    return value === sealedElsewhere ? null : value;
  }
  async readRecord(id: string) {
    return opaqueId.test(id) ? this.read(digest(id)) : null;
  }
  async getByDigest(hash: string) {
    const value = await this.read(hash);
    return value === sealedElsewhere ? null : value;
  }
  private async read(hash: string): Promise<StoredRecord | typeof sealedElsewhere | null> {
    if (!recordDigest.test(hash)) return null;
    const raw = await this.raw.fetch(hash);
    if (!raw) return null;
    const secret = sealingKey();
    let record: StoredRecord;
    // Another deployment sharing this keyspace, or a rotated secret, sealed the record; it stays with its writer.
    try {
      record = unseal(raw, secret);
    } catch {
      console.warn(`[auth] record ${hash.slice(0, 8)} sealed with another SESSION_SECRET`);
      return sealedElsewhere;
    }
    if (record?.expires !== null && record?.expires <= Date.now()) {
      await this.deleteByDigest(hash);
      return null;
    }
    return record?.value;
  }
  async delete(id: string) {
    if (opaqueId.test(id)) await this.deleteByDigest(digest(id));
  }
  async deleteByDigest(hash: string) {
    if (recordDigest.test(hash)) await this.raw.remove(hash);
  }
  async withCredentialLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const backend = this.raw, lockKey = `${backend.scope}:${id}`;
    const previous = credentialLocks.get(lockKey) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    credentialLocks.set(lockKey, tail);
    await previous;
    let unlock: (() => Promise<void>) | null = null;
    try {
      unlock = await backend.lockAcrossInstances(id);
      return await work();
    } finally {
      try {
        await unlock?.();
      } finally {
        release();
        if (credentialLocks.get(lockKey) === tail) credentialLocks.delete(lockKey);
      }
    }
  }
  async recordRejection(token: string, reason: string) {
    await this.set(`rejection:${digest(token)}`, { reason, at: Date.now() }, rejectionLifetime);
  }
  async indexGrant(token: string, ownerId: number | string) {
    await this.raw.addGrant(ownerId, digest(token));
  }
  async listGrants(ownerId: number | string) {
    const backend = this.raw, results: GrantSummary[] = [];
    for (const id of await backend.grantCandidates(ownerId)) {
      const grant = await this.read(id);
      if (grant === sealedElsewhere) continue;
      if (grant?.kind === 'agent' && grant.ownerId === ownerId) results.push({ id, name: grant.name, write: grant.write, ...(typeof grant.source === 'string' ? { source: grant.source } : {}), ...(typeof grant.site === 'string' ? { site: grant.site } : {}), createdAt: grant.createdAt, expiresAt: null, lastRejection: await this.getByDigest(digest(`rejection:${id}`)) || null });
      else if (!grant) await backend.forgetGrant(ownerId, id);
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }
  async revokeGrant(id: string, ownerId: number | string) {
    const grant = await this.getByDigest(id);
    if (grant?.kind !== 'agent' || grant.ownerId !== ownerId) return false;
    await this.deleteByDigest(id);
    await this.raw.forgetGrant(ownerId, id);
    return true;
  }
}

/**
 * The record store of the lightweight mode, which keeps nothing on the server: reads find nothing and writes
 * fail, so a feature that needs server records (persistent agent grants) is unavailable instead of half working.
 */
export class NoRecordStore implements RecordStore {
  readonly durable = false;
  private refuse(): never {
    throw new Error('This deployment keeps no server records.');
  }
  async set() {
    this.refuse();
  }
  async get() {
    return null;
  }
  async readRecord() {
    return null;
  }
  async getByDigest() {
    return null;
  }
  async delete() {}
  async deleteByDigest() {}
  async withCredentialLock<T>(_id: string, work: () => Promise<T>) {
    return work();
  }
  async recordRejection() {
    this.refuse();
  }
  async indexGrant() {
    this.refuse();
  }
  async listGrants() {
    return [];
  }
  async revokeGrant() {
    return false;
  }
}
