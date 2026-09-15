import { NoteMetadata } from './types.js';

/**
 * Stamps `updated` (always) and, only for a genuinely new note (`isNew`),
 * fills `created` when missing. An existing note that predates this feature
 * and lacks `created` keeps it missing on ordinary edits, so the one-time
 * backfill command (which reads git history) is the only thing that fills
 * it in — an edit must never invent today's date as a stand-in for a note's
 * real, unknown creation date.
 */
export function stampSaveTimestamps(metadata: NoteMetadata, isNew: boolean, now: Date = new Date()): NoteMetadata {
  const iso = now.toISOString();
  return { ...metadata, created: isNew ? (metadata.created ?? iso) : metadata.created, updated: iso };
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
