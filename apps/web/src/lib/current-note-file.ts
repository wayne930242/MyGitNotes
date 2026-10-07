import { serializeNoteFile } from '@mygitnotes/core/note-file';
import type { NoteMetadata } from '@mygitnotes/core';

/**
 * The file the editor's fields would save, for history to compare and keep. It keeps the note's own `updated`, or `fallback`
 * when the note has none, instead of the save's fresh stamp, so the same text always reads the same: an unchanged note equals
 * its latest file, and the same text is kept only once.
 */
export function currentNoteFile(file: string, metadata: NoteMetadata, content: string, latest: string | null, fallback: Date): string {
  const stamp = metadata.updated;
  const updated = stamp instanceof Date ? stamp : new Date(typeof stamp === 'string' ? stamp : Number.NaN);
  return serializeNoteFile(file, metadata, content, latest === null, Number.isNaN(updated.getTime()) ? fallback : updated, latest ?? undefined);
}
