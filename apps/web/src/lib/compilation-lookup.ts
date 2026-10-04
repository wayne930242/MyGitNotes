import type { NoteListItem } from '@mygitnotes/core/note-query';
import { DEFAULT_NOTE_QUERY } from '@mygitnotes/core/note-query';
import { fetchNoteQuery } from './notes-api.js';

/** Every compilation of the workspace, all notebooks, hidden ones included. */
export async function listCompilations(): Promise<NoteListItem[]> {
  const found: NoteListItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchNoteQuery({ ...DEFAULT_NOTE_QUERY, notebookId: 'all', kind: 'compilation', showHidden: true }, { cursor, limit: 200 });
    found.push(...page.notes);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return found;
}

/** The compilation with this id, or undefined; ids are unique across the workspace. */
export async function findCompilationById(id: string): Promise<NoteListItem | undefined> {
  return (await listCompilations()).find(note => note.metadata.id === id);
}
