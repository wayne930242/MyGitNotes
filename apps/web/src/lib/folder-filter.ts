import { noteDirectory, type NoteListItem } from '@mygitnotes/core/note-query';
import type { TodoTask } from './todo-list.js';

/** True when `path`'s directory is `folder` itself or one of its subfolders. */
export function pathInFolder(path: string, folder: string): boolean {
  const directory = noteDirectory(path);
  return directory === folder || directory.startsWith(folder + '/');
}

export function filterTasksByFolder(tasks: TodoTask[], folder: string): TodoTask[] {
  return tasks.filter(task => pathInFolder(task.notePath, folder));
}

export function filterNotesByFolder(notes: NoteListItem[], folder: string): NoteListItem[] {
  return notes.filter(note => pathInFolder(note.path, folder));
}
