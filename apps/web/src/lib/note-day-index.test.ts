import { describe, expect, it } from 'vitest';
import type { NoteItem } from './types.js';
import type { TodoTask } from './todo-list.js';
import { buildDayCounts, dayKeyFromISO, notesForDay, notesForMonth, tasksForDay, tasksForMonth } from './note-day-index.js';

function note(path: string, metadata: Record<string, unknown>): NoteItem {
  return { id: path, path, notebookId: 'nb', title: path, tags: [], metadata, content: '' };
}

function task(id: string, due: string | undefined, checked = false): TodoTask {
  return { id, notePath: `${id}.md`, notebookId: 'nb', noteTitle: id, lineIndex: 0, lineText: '', checked, due };
}

describe('dayKeyFromISO', () => {
  it('extracts the local calendar day from an ISO UTC timestamp', () => {
    expect(dayKeyFromISO('2026-09-15T10:00:00.000Z')).toBe(formattedLocalDay('2026-09-15T10:00:00.000Z'));
  });

  it('returns undefined for a missing or unparsable value', () => {
    expect(dayKeyFromISO(undefined)).toBeUndefined();
    expect(dayKeyFromISO('not-a-date')).toBeUndefined();
  });
});

function formattedLocalDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

describe('buildDayCounts', () => {
  it('counts created, updated, and due independently per day', () => {
    const day = formattedLocalDay('2026-09-15T10:00:00.000Z');
    const notes = [
      note('a', { created: '2026-09-15T10:00:00.000Z', updated: '2026-09-15T12:00:00.000Z' }),
      note('b', { created: '2026-09-10T10:00:00.000Z', updated: '2026-09-15T09:00:00.000Z' }),
    ];
    const tasks = [task('t1', day), task('t2', day, true)];
    const counts = buildDayCounts(notes, tasks);
    expect(counts.get(day)).toEqual({ created: 1, updated: 2, due: 2 });
  });
});

describe('notesForDay / tasksForDay', () => {
  it('filters notes by the requested field and tasks by due date', () => {
    const day = '2026-09-15';
    const notes = [note('a', { created: '2026-09-15T10:00:00.000Z' }), note('b', { created: '2026-09-14T10:00:00.000Z' })];
    expect(notesForDay(notes, day, 'created').map(n => n.path)).toEqual(['a']);
    expect(notesForDay(notes, day, 'updated')).toEqual([]);

    const tasks = [task('t1', day), task('t2', '2026-09-16')];
    expect(tasksForDay(tasks, day).map(t => t.id)).toEqual(['t1']);
  });
});

describe('notesForMonth / tasksForMonth', () => {
  it('filters notes and tasks to the given year/month regardless of day', () => {
    // Times are kept well clear of local midnight so this holds regardless of the runner's timezone.
    const notes = [
      note('a', { created: '2026-09-01T12:00:00.000Z' }),
      note('b', { created: '2026-09-30T12:00:00.000Z' }),
      note('c', { created: '2026-10-01T12:00:00.000Z' }),
      note('d', { created: '2025-09-15T12:00:00.000Z' }),
    ];
    expect(notesForMonth(notes, 2026, 8, 'created').map(n => n.path).sort()).toEqual(['a', 'b']);

    const tasks = [task('t1', '2026-09-05'), task('t2', '2026-10-01'), task('t3', undefined)];
    expect(tasksForMonth(tasks, 2026, 8).map(t => t.id)).toEqual(['t1']);
  });
});
