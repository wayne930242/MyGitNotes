import { DUE_EMOJI, getTokenValue, isTaskChecked, isTaskLine } from './task-tokens.js';

export interface TodoTask {
  id: string;
  notePath: string;
  notebookId: string;
  noteTitle: string;
  lineIndex: number;
  lineText: string;
  checked: boolean;
  due?: string;
}

export interface AgendaSourceNote {
  path: string;
  notebookId: string;
  title: string;
  content: string;
}

/** Extracts every GFM task line from a set of notes as flat TodoTask records. */
export function extractTodoTasks(notes: AgendaSourceNote[]): TodoTask[] {
  const tasks: TodoTask[] = [];
  for (const note of notes) {
    note.content.split('\n').forEach((lineText, lineIndex) => {
      if (!isTaskLine(lineText)) return;
      tasks.push({
        id: `${note.path}#${lineIndex}`,
        notePath: note.path,
        notebookId: note.notebookId,
        noteTitle: note.title,
        lineIndex,
        lineText,
        checked: isTaskChecked(lineText) ?? false,
        due: getTokenValue(lineText, DUE_EMOJI),
      });
    });
  }
  return tasks;
}
