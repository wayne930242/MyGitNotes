import type { NoteItem } from './types.js';
import { formatDateYMD } from './date-utils.js';
import type { TodoTask } from './todo-list.js';

export interface DayCounts {
  created: number;
  updated: number;
  due: number;
}

/** The local calendar day (`YYYY-MM-DD`) an ISO timestamp falls on, or undefined if unparsable. */
export function dayKeyFromISO(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return formatDateYMD(date);
}

/** Per-day counts of notes created, notes updated, and todos due, for the calendar month grid. */
export function buildDayCounts(notes: NoteItem[], tasks: TodoTask[]): Map<string, DayCounts> {
  const index = new Map<string, DayCounts>();
  const bump = (key: string | undefined, field: keyof DayCounts) => {
    if (!key) return;
    const entry = index.get(key) || { created: 0, updated: 0, due: 0 };
    entry[field]++;
    index.set(key, entry);
  };
  for (const note of notes) {
    bump(dayKeyFromISO(note.metadata.created), 'created');
    bump(dayKeyFromISO(note.metadata.updated), 'updated');
  }
  for (const task of tasks) {
    bump(task.due, 'due');
  }
  return index;
}

export function notesForDay(notes: NoteItem[], day: string, field: 'created' | 'updated'): NoteItem[] {
  return notes.filter(note => dayKeyFromISO(note.metadata[field]) === day);
}

export function tasksForDay(tasks: TodoTask[], day: string): TodoTask[] {
  return tasks.filter(task => task.due === day);
}

function monthPrefix(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function notesForMonth(notes: NoteItem[], year: number, month: number, field: 'created' | 'updated'): NoteItem[] {
  const prefix = monthPrefix(year, month);
  return notes.filter(note => dayKeyFromISO(note.metadata[field])?.startsWith(prefix));
}

export function tasksForMonth(tasks: TodoTask[], year: number, month: number): TodoTask[] {
  const prefix = monthPrefix(year, month);
  return tasks.filter(task => task.due?.startsWith(prefix));
}
