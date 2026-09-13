import type { NoteItem } from './types.js';
import { sameValue } from './merge-note.js';

/** Replace the refreshed scope while keeping unchanged rows and other notebooks. */
export function mergeNoteSnapshot(previous: NoteItem[], incoming: NoteItem[], notebookId?: string): NoteItem[] {
  const remaining = new Map(incoming.map(note => [note.path, note]));
  const next: NoteItem[] = [];
  for (const note of previous) {
    if (notebookId && note.notebookId !== notebookId) {
      next.push(note);
      continue;
    }
    const refreshed = remaining.get(note.path);
    if (refreshed) {
      next.push(sameValue(note, refreshed) ? note : refreshed);
      remaining.delete(note.path);
    }
  }
  next.push(...remaining.values());
  return next.length === previous.length && next.every((note, index) => note === previous[index]) ? previous : next;
}
