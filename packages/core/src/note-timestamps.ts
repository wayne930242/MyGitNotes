import { NoteMetadata } from './types.js';

/**
 * Stamps `created` (only if missing) and `updated` (always) as ISO 8601 UTC
 * strings. Used on every note content save so `created`/`updated` reflect
 * the note's own save history rather than filesystem mtimes.
 */
export function stampSaveTimestamps(metadata: NoteMetadata, now: Date = new Date()): NoteMetadata {
  const iso = now.toISOString();
  return { ...metadata, created: metadata.created ?? iso, updated: iso };
}

/**
 * Fills `created`/`updated` only where missing, from the given fallbacks.
 * Never overwrites an existing value. Used by the one-time backfill command.
 */
export function fillMissingTimestamps(
  metadata: NoteMetadata,
  createdFallback: string | undefined,
  updatedFallback: string | undefined
): { metadata: NoteMetadata; changed: boolean } {
  let changed = false;
  const next: NoteMetadata = { ...metadata };
  if (!next.created && createdFallback) {
    next.created = createdFallback;
    changed = true;
  }
  if (!next.updated && updatedFallback) {
    next.updated = updatedFallback;
    changed = true;
  }
  return { metadata: next, changed };
}
