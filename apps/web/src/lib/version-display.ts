import { useSyncExternalStore } from 'react';
import type { NoteVersion } from '@mygitnotes/core/note-versions';

/** Which of a version's two numbers this device shows first; both are always recorded. */
export type VersionNumbering = 'sequence' | 'date';
export const VERSION_NUMBERING_STORAGE_KEY = 'mygitnotes:version-numbering';

let current: VersionNumbering | undefined;
const listeners = new Set<() => void>();

export function readVersionNumbering(storage?: Pick<Storage, 'getItem'>): VersionNumbering {
  try {
    return (storage ?? globalThis.localStorage).getItem(VERSION_NUMBERING_STORAGE_KEY) === 'date' ? 'date' : 'sequence';
  } catch {
    return 'sequence';
  }
}

const getVersionNumbering = () => current ??= readVersionNumbering();

export function writeVersionNumbering(value: VersionNumbering, storage?: Pick<Storage, 'setItem'>) {
  current = value;
  try {
    (storage ?? globalThis.localStorage).setItem(VERSION_NUMBERING_STORAGE_KEY, value);
  } catch { /* Keep the in-page preference. */ }
  for (const listener of listeners) listener();
}

export function useVersionNumbering(): VersionNumbering {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersionNumbering,
    () => 'sequence',
  );
}

/** A version's numbers in display order: the chosen one first, the other second. */
export function versionNumbers(version: Pick<NoteVersion, 'sequence' | 'date'>, numbering: VersionNumbering): [string, string] {
  const sequence = `v${version.sequence}`;
  return numbering === 'date' ? [version.date, sequence] : [sequence, version.date];
}
