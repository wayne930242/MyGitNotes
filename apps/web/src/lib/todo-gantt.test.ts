import { describe, expect, it } from 'vitest';
import type { TodoTask } from './todo-list.js';
import { computeGanttRange, computeGanttRows, computeGanttTicks, formatDayIndex } from './todo-gantt.js';

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
});

describe('computeGanttTicks', () => {
  it('includes the first and last column plus weekly ticks', () => {
    const range = { startDay: 100, days: 10, todayOffset: 1 };
    const ticks = computeGanttTicks(range);
    expect(ticks[0].offset).toBe(0);
    expect(ticks.at(-1)?.offset).toBe(9);
    expect(ticks.some(tick => tick.offset === 7)).toBe(true);
  });
});
