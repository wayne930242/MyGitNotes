import type { TodoTask } from './todo-list.js';

const MS_PER_DAY = 86_400_000;
const MIN_SPAN_DAYS = 7;
const MIN_SPAN_WEEKS = 4;
const MIN_SPAN_MONTHS = 3;

export type GanttScale = 'day' | 'week' | 'month';

export const GANTT_SCALES: readonly GanttScale[] = ['day', 'week', 'month'];

const GANTT_SCALE_STORAGE_KEY = 'github-notes:todo-gantt-scale';

/** Loads the last-used Gantt scale from localStorage, falling back to `'day'`. */
export function getSavedGanttScale(): GanttScale {
  if (typeof window === 'undefined' || !window.localStorage) return 'day';
  try {
    const raw = window.localStorage.getItem(GANTT_SCALE_STORAGE_KEY);
    return GANTT_SCALES.includes(raw as GanttScale) ? (raw as GanttScale) : 'day';
  } catch {
    return 'day';
  }
}

export function saveGanttScale(scale: GanttScale): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(GANTT_SCALE_STORAGE_KEY, scale);
  } catch {
    // ignore quota / storage errors
  }
}

/** Pixel width of one day column at the given scale; bars and ticks both scale off this. */
export function ganttDayWidth(scale: GanttScale): number {
  if (scale === 'week') return 10;
  if (scale === 'month') return 3;
  return 28;
}

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

function ymFromDay(day: number): { year: number; month: number } {
  const date = new Date(day * MS_PER_DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

/** Day index of the Monday on or before `day`. */
function startOfWeekDay(day: number): number {
  const dow = new Date(day * MS_PER_DAY).getUTCDay(); // 0=Sun..6=Sat
  return day - ((dow + 6) % 7);
}

/** Day index of the 1st of the month `day` falls in. */
function startOfMonthDay(day: number): number {
  const { year, month } = ymFromDay(day);
  return Date.UTC(year, month, 1) / MS_PER_DAY;
}

/** Day index of the last day of the month `day` falls in. */
function endOfMonthDay(day: number): number {
  const { year, month } = ymFromDay(day);
  return Date.UTC(year, month + 1, 0) / MS_PER_DAY;
}

/** Day index of the 1st of the month `months` after `day`'s month. */
function addMonthsDay(day: number, months: number): number {
  const { year, month } = ymFromDay(day);
  return Date.UTC(year, month + months, 1) / MS_PER_DAY;
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
 * today, with one day of padding on each side.
 *
 * At `'day'` scale the span is at least 7 days. At `'week'`/`'month'` scale
 * the range additionally snaps to whole week/month boundaries (so header
 * columns align to full weeks/months) and spans at least 4 weeks / 3 months.
 */
export function computeGanttRange(tasks: TodoTask[], today: string, scale: GanttScale = 'day'): GanttRange {
  const todayDay = dayIndex(today);
  const taskDays = tasks
    .filter(task => !task.checked)
    .flatMap(task => [task.start, task.due])
    .filter((value): value is string => Boolean(value))
    .map(dayIndex);
  const all = [...taskDays, todayDay];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const paddedStart = min - 1;
  const paddedEnd = max + 1;

  if (scale === 'week') {
    const startDay = startOfWeekDay(paddedStart);
    const coveredEnd = startOfWeekDay(paddedEnd) + 6;
    const days = Math.max(coveredEnd - startDay + 1, MIN_SPAN_WEEKS * 7);
    return { startDay, days, todayOffset: todayDay - startDay };
  }

  if (scale === 'month') {
    const startDay = startOfMonthDay(paddedStart);
    const { year: endYear, month: endMonth } = ymFromDay(paddedEnd);
    const { year: startYear, month: startMonth } = ymFromDay(startDay);
    const coveredMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
    const extraMonths = Math.max(MIN_SPAN_MONTHS - coveredMonths, 0);
    const endDay = endOfMonthDay(addMonthsDay(paddedEnd, extraMonths));
    return { startDay, days: endDay - startDay + 1, todayOffset: todayDay - startDay };
  }

  const startDay = paddedStart;
  const coveredDays = paddedEnd - startDay + 1;
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

/**
 * Header column ticks across the range, plus the first and last column.
 * At `'day'`/`'week'` scale, one tick every 7 days (which is one tick per
 * week once `range` was computed with `scale: 'week'`, since its `startDay`
 * is then already week-aligned). At `'month'` scale, one tick per calendar
 * month (requires `range` to have been computed with `scale: 'month'`).
 */
export function computeGanttTicks(range: GanttRange, scale: GanttScale = 'day'): GanttTick[] {
  const offsets = new Set<number>();
  if (scale === 'month') {
    const endDay = range.startDay + range.days - 1;
    for (let day = range.startDay; day <= endDay; day = addMonthsDay(day, 1)) offsets.add(day - range.startDay);
  } else {
    for (let offset = 0; offset < range.days; offset += 7) offsets.add(offset);
  }
  if (scale === 'day') {
    offsets.add(0);
    offsets.add(range.days - 1);
  }
  return [...offsets].sort((a, b) => a - b).map(offset => ({ offset, date: formatDayIndex(range.startDay + offset) }));
}
