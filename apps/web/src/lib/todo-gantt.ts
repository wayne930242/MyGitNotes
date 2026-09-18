import type { TodoTask } from './todo-list.js';

const MS_PER_DAY = 86_400_000;
const MIN_SPAN_DAYS = 7;

function dayIndex(dateYMD: string): number {
  return Math.floor(Date.parse(`${dateYMD}T00:00:00Z`) / MS_PER_DAY);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Formats a day index (see `dayIndex`) back to `YYYY-MM-DD`, in UTC to match the index's own basis. */
export function formatDayIndex(index: number): string {
  const date = new Date(index * MS_PER_DAY);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export interface GanttRange {
  /** Day index (see `dayIndex`) of the first visible column. */
  startDay: number;
  /** Number of visible day columns. */
  days: number;
  /** Column offset of today, may fall outside `[0, days)` in principle but never does by construction. */
  todayOffset: number;
}

/**
 * The visible day range: covers every open task's start/due dates and
 * today, with one day of padding on each side and at least a 7-day span.
 */
export function computeGanttRange(tasks: TodoTask[], today: string): GanttRange {
  const todayDay = dayIndex(today);
  const taskDays = tasks
    .filter(task => !task.checked)
    .flatMap(task => [task.start, task.due])
    .filter((value): value is string => Boolean(value))
    .map(dayIndex);
  const all = [...taskDays, todayDay];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const startDay = min - 1;
  const coveredDays = max + 1 - startDay + 1;
  const days = Math.max(coveredDays, MIN_SPAN_DAYS);
  return { startDay, days, todayOffset: todayDay - startDay };
}

export type GanttRowKind = 'range' | 'dueOnly' | 'startOnly';

export interface GanttRow {
  task: TodoTask;
  /** Column offset (from `range.startDay`) where the bar/marker begins. */
  offset: number;
  /** Number of day columns the bar/marker spans (always >= 1). */
  span: number;
  kind: GanttRowKind;
}

/**
 * One row per open task that has a start and/or due date, sorted by where
 * it starts on the timeline. Completed and undated tasks are excluded —
 * the caller lists those separately, outside the timeline.
 */
export function computeGanttRows(tasks: TodoTask[], range: GanttRange): GanttRow[] {
  const rows: GanttRow[] = [];
  for (const task of tasks) {
    if (task.checked) continue;
    if (task.start && task.due) {
      const startDay = dayIndex(task.start);
      const dueDay = dayIndex(task.due);
      const from = Math.min(startDay, dueDay);
      const to = Math.max(startDay, dueDay);
      rows.push({ task, offset: from - range.startDay, span: to - from + 1, kind: 'range' });
    } else if (task.due) {
      rows.push({ task, offset: dayIndex(task.due) - range.startDay, span: 1, kind: 'dueOnly' });
    } else if (task.start) {
      rows.push({ task, offset: dayIndex(task.start) - range.startDay, span: 1, kind: 'startOnly' });
    }
  }
  return rows.sort((a, b) => a.offset - b.offset);
}

export interface GanttTick {
  offset: number;
  date: string;
}

/** Weekly date ticks across the range, plus the first and last column. */
export function computeGanttTicks(range: GanttRange): GanttTick[] {
  const offsets = new Set<number>();
  for (let offset = 0; offset < range.days; offset += 7) offsets.add(offset);
  offsets.add(0);
  offsets.add(range.days - 1);
  return [...offsets].sort((a, b) => a - b).map(offset => ({ offset, date: formatDayIndex(range.startDay + offset) }));
}
