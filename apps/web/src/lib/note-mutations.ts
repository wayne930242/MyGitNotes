import { withNoteStatus } from '@mygitnotes/core/note-status';
import type { NoteRef } from '@mygitnotes/core/note-query';
import type { NoteItem } from './types.js';

export interface NoteSaveInput {
  path: string;
  content: string;
  metadata: Record<string, unknown>;
  notebookId: string;
}

/**
 * A list row carries no body, so a status change reads the note in full first. A failed read
 * rejects, which keeps the caller from writing an empty note over a real one.
 */
export async function noteStatusChange(read: (note: NoteRef) => Promise<NoteItem>, note: NoteRef, status: string): Promise<NoteSaveInput> {
  const current = await read({ notebookId: note.notebookId, path: note.path });
  return { path: current.path, content: current.content, metadata: withNoteStatus({ ...current.metadata, status: current.status }, status), notebookId: current.notebookId };
}
