import type { FileChange, NoteItem } from './types.js';

/** Keeps the deleted notes whose deletion is still an uncommitted change in their repository; one committed or restored outside the app drops out. */
export function pendingDeletedNotes(notes: NoteItem[], changes: FileChange[], repositoryOf: (notebookId: string) => string | undefined): NoteItem[] {
  return notes.filter(note => changes.some(change => change.kind === 'deleted' && change.path === note.path && change.repository === repositoryOf(note.notebookId)));
}
