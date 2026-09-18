import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TodoTask } from './todo-list.js';
import {
  computeGanttRange,
  computeGanttRows,
  computeGanttTicks,
  formatDayIndex,
  ganttDayWidth,
  getSavedGanttScale,
  saveGanttScale,
} from './todo-gantt.js';

function task(overrides: Partial<TodoTask>): TodoTask {
  return {
    id: 'a.md#0', notePath: 'a.md', notebookId: 'nb', noteTitle: 'a', lineIndex: 0,
    lineText: '- [ ] Task', checked: false, ...overrides,
  };
}

describe('computeGanttRange', () => {
  const today = '2026-09-15';

  it('always includes today with 1-day padding, minimum 7-day span', () => {
    const range = computeGanttRange([], today);
    expect(range.days).toBeGreaterThanOrEqual(7);
    expect(formatDayIndex(range.startDay + range.todayOffset)).toBe(today);
  });

  it('expands to cover every open task date, ignoring completed tasks', () => {
    const tasks = [
      task({ start: '2026-09-10', due: '2026-09-12' }),
      task({ due: '2026-10-01' }),
      task({ checked: true, due: '2026-12-25' }),
    ];
    const range = computeGanttRange(tasks, today);
    const firstDay = formatDayIndex(range.startDay);
    const lastDay = formatDayIndex(range.startDay + range.days - 1);
    expect(firstDay <= '2026-09-10').toBe(true);
    expect(lastDay >= '2026-10-01').toBe(true);
    expect(lastDay < '2026-12-25').toBe(true);
  });

  it('at week scale, snaps to Monday..Sunday week boundaries and spans at least 4 weeks', () => {
    const range = computeGanttRange([task({ due: '2026-09-16' })], today, 'week');
    expect(range.days % 7).toBe(0);
    expect(range.days).toBeGreaterThanOrEqual(28);
    expect(new Date(range.startDay * 86_400_000).getUTCDay()).toBe(1); // Monday
    const lastDay = range.startDay + range.days - 1;
    expect(new Date(lastDay * 86_400_000).getUTCDay()).toBe(0); // Sunday
  });

  it('at month scale, snaps to the 1st..end-of-month and spans at least 3 months', () => {
    const range = computeGanttRange([task({ due: '2026-09-16' })], today, 'month');
    expect(formatDayIndex(range.startDay)).toBe('2026-09-01');
    const lastDay = formatDayIndex(range.startDay + range.days - 1);
    expect(lastDay).toBe('2026-11-30'); // Sep + Oct + Nov = 3 months
  });

  it('at month scale, a task date far in the future extends the span beyond the 3-month minimum', () => {
    const range = computeGanttRange([task({ due: '2027-01-10' })], today, 'month');
    expect(formatDayIndex(range.startDay)).toBe('2026-09-01');
    expect(formatDayIndex(range.startDay + range.days - 1)).toBe('2027-01-31');
  });
});

describe('computeGanttRows', () => {
  const today = '2026-09-15';

  it('renders a range bar spanning start to due', () => {
    const range = computeGanttRange([task({ start: '2026-09-15', due: '2026-09-18' })], today);
    const rows = computeGanttRows([task({ id: 't1', start: '2026-09-15', due: '2026-09-18' })], range);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('range');
    expect(rows[0].span).toBe(4);
    expect(formatDayIndex(range.startDay + rows[0].offset)).toBe('2026-09-15');
  });

  it('normalizes a start date that is after the due date', () => {
    const range = computeGanttRange([task({ start: '2026-09-20', due: '2026-09-16' })], today);
    const rows = computeGanttRows([task({ id: 't1', start: '2026-09-20', due: '2026-09-16' })], range);
    expect(formatDayIndex(range.startDay + rows[0].offset)).toBe('2026-09-16');
    expect(rows[0].span).toBe(5);
  });

  it('renders a single-day milestone marker for a due-only task', () => {
    const range = computeGanttRange([task({ due: '2026-09-20' })], today);
    const rows = computeGanttRows([task({ id: 't1', due: '2026-09-20' })], range);
    expect(rows[0]).toMatchObject({ kind: 'dueOnly', span: 1 });
    expect(formatDayIndex(range.startDay + rows[0].offset)).toBe('2026-09-20');
  });

  it('renders a single-day marker for a start-only task', () => {
    const range = computeGanttRange([task({ start: '2026-09-12' })], today);
    const rows = computeGanttRows([task({ id: 't1', start: '2026-09-12' })], range);
    expect(rows[0]).toMatchObject({ kind: 'startOnly', span: 1 });
    expect(formatDayIndex(range.startDay + rows[0].offset)).toBe('2026-09-12');
  });

  it('excludes completed and undated tasks', () => {
    const range = computeGanttRange([], today);
    const rows = computeGanttRows([
      task({ id: 't1', checked: true, due: '2026-09-16' }),
      task({ id: 't2' }),
    ], range);
    expect(rows).toHaveLength(0);
  });

  it('sorts rows by where they start on the timeline', () => {
    const tasks = [task({ id: 't1', due: '2026-09-20' }), task({ id: 't2', due: '2026-09-16' })];
    const range = computeGanttRange(tasks, today);
    const rows = computeGanttRows(tasks, range);
    expect(rows.map(row => row.task.id)).toEqual(['t2', 't1']);
  });

  it('positions a bar by exact day-precision offset even against a week/month-snapped range', () => {
    const tasks = [task({ id: 't1', start: '2026-09-16', due: '2026-09-18' })];
    const weekRange = computeGanttRange(tasks, today, 'week');
    const weekRows = computeGanttRows(tasks, weekRange);
    expect(formatDayIndex(weekRange.startDay + weekRows[0].offset)).toBe('2026-09-16');
    expect(weekRows[0].span).toBe(3);

    const monthRange = computeGanttRange(tasks, today, 'month');
    const monthRows = computeGanttRows(tasks, monthRange);
    expect(formatDayIndex(monthRange.startDay + monthRows[0].offset)).toBe('2026-09-16');
    expect(monthRows[0].span).toBe(3);
  });
});

describe('computeGanttTicks', () => {
  it('includes the first and last column plus weekly ticks', () => {
    const range = { startDay: 100, days: 10, todayOffset: 1 };
    const ticks = computeGanttTicks(range);
    expect(ticks[0].offset).toBe(0);
    expect(ticks.at(-1)?.offset).toBe(9);
    expect(ticks.some(tick => tick.offset === 7)).toBe(true);
  });

  it('at week scale, ticks one per week (identical spacing to day scale, since the range is already week-aligned)', () => {
    const today = '2026-09-15';
    const range = computeGanttRange([], today, 'week'); // 4-week minimum span => 28 days
    expect(range.days).toBe(28);
    const ticks = computeGanttTicks(range, 'week');
    expect(ticks.map(tick => tick.offset)).toEqual([0, 7, 14, 21, 27]);
  });

  it('at month scale, one tick per calendar month plus the first/last column', () => {
    const today = '2026-09-15';
    const range = computeGanttRange([], today, 'month'); // Sep 1 .. Nov 30 (3-month minimum)
    const ticks = computeGanttTicks(range, 'month');
    expect(ticks.map(tick => tick.date)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01', '2026-11-30']);
  });
});

describe('ganttDayWidth', () => {
  it('narrows as the scale zooms out from day to week to month', () => {
    expect(ganttDayWidth('day')).toBeGreaterThan(ganttDayWidth('week'));
    expect(ganttDayWidth('week')).toBeGreaterThan(ganttDayWidth('month'));
  });
});

describe('gantt scale persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage(): Map<string, string> {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
    return storage;
  }

  it('defaults to day when nothing is stored', () => {
    stubStorage();
    expect(getSavedGanttScale()).toBe('day');
  });

  it('round-trips a saved scale', () => {
    stubStorage();
    saveGanttScale('month');
    expect(getSavedGanttScale()).toBe('month');
  });

  it('falls back to day when the stored value is no longer valid', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
    storage.set('github-notes:todo-gantt-scale', 'quarter');
    expect(getSavedGanttScale()).toBe('day');
  });
});
