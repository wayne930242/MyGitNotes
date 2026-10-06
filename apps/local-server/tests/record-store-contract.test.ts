import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, vi } from 'vitest';
import { recordStoreContract } from '../src/record-store/contract.js';
import { DirectoryRecordBackend, RedisRecordBackend, SealedRecordStore } from '../src/record-store/index.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

recordStoreContract('directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-store-'));
  dirs.push(dir);
  return new SealedRecordStore(new DirectoryRecordBackend(dir));
});

/** Answers the Redis commands the backend sends, as one Redis server would. */
function fakeRedis() {
  const values = new Map<string, string>(), sets = new Map<string, Set<string>>();
  return async (command: string[]): Promise<unknown> => {
    const [op, key, ...args] = command;
    if (op === 'GET') return values.get(key) ?? null;
    if (op === 'SET') {
      if (args.includes('NX') && values.has(key)) return null;
      values.set(key, args[0]);
      return 'OK';
    }
    if (op === 'DEL') return Number(values.delete(key));
    if (op === 'SADD') {
      sets.set(key, (sets.get(key) ?? new Set()).add(args[0]));
      return 1;
    }
    if (op === 'SMEMBERS') return [...(sets.get(key) ?? [])];
    if (op === 'SREM') return Number(sets.get(key)?.delete(args[0]));
    if (op === 'EVAL') return values.get(args[1]) === args[2] ? Number(values.delete(args[1])) : 0;
    throw new Error(`Unexpected Redis command ${op}`);
  };
}

recordStoreContract('redis', () => {
  const backend = new RedisRecordBackend('gh-notes:contract');
  vi.spyOn(backend, 'command').mockImplementation(fakeRedis());
  return new SealedRecordStore(backend);
});
