import type { NoteItem } from './types.js';
import { classifyDueDate, DUE_EMOJI, getTokenValue, isTaskChecked, isTaskLine, type TodoGroup } from './task-tokens.js';

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

/** Extracts every GFM task line from a set of notes as flat TodoTask records. */
export function extractTodoTasks(notes: NoteItem[]): TodoTask[] {
  const tasks: TodoTask[] = [];
  for (const note of notes) {
    const lines = note.content.split('\n');
    lines.forEach((lineText, lineIndex) => {
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

export interface TodoGroups {
  overdue: TodoTask[];
  today: TodoTask[];
  upcoming: TodoTask[];
  noDate: TodoTask[];
  completed: TodoTask[];
}

/** Splits tasks into the panel's groups: completed tasks are set aside regardless of due date. */
export function groupTodoTasks(tasks: TodoTask[], today: string): TodoGroups {
  const groups: TodoGroups = { overdue: [], today: [], upcoming: [], noDate: [], completed: [] };
  for (const task of tasks) {
    if (task.checked) { groups.completed.push(task); continue; }
    const group: TodoGroup = classifyDueDate(task.due, today);
    groups[group].push(task);
  }
  return groups;
}
