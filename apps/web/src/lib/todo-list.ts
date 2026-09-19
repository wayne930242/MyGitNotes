import type { TodoTask } from '@mygitnotes/core/note-agenda';
import { classifyDueDate, type TodoGroup } from './task-tokens.js';

export { extractTodoTasks, type TodoTask } from '@mygitnotes/core/note-agenda';

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
    if (task.checked) {
      groups.completed.push(task);
      continue;
    }
    const group: TodoGroup = classifyDueDate(task.due, today);
    groups[group].push(task);
  }
  return groups;
}
