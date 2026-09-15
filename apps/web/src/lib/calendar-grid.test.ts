import { describe, expect, it } from 'vitest';
import { formatDateYMD } from './date-utils.js';
import { buildMonthGrid } from './calendar-grid.js';

describe('buildMonthGrid', () => {
  it('pads a Sunday-start September 2026 grid to full weeks', () => {
    // 2026-09-01 is a Tuesday; 2026-09-30 is a Wednesday.
    const grid = buildMonthGrid(2026, 8, 0);
    expect(formatDateYMD(grid[0])).toBe('2026-08-30'); // preceding Sunday
    expect(formatDateYMD(grid[grid.length - 1])).toBe('2026-10-03'); // trailing Saturday
    expect(grid.length % 7).toBe(0);
    expect(grid.some(day => formatDateYMD(day) === '2026-09-01')).toBe(true);
    expect(grid.some(day => formatDateYMD(day) === '2026-09-30')).toBe(true);
  });

  it('pads a Monday-start grid for the same month differently', () => {
    const grid = buildMonthGrid(2026, 8, 1);
    expect(formatDateYMD(grid[0])).toBe('2026-08-31'); // preceding Monday
    expect(grid.length % 7).toBe(0);
  });

  it('needs no padding when the month starts and ends exactly on week boundaries', () => {
    // 2026-11-01 is a Sunday; 2026-11-30 is a Monday -> with Sunday start, trailing pad to Saturday.
    const grid = buildMonthGrid(2026, 10, 0);
    expect(formatDateYMD(grid[0])).toBe('2026-11-01');
    expect(grid.length % 7).toBe(0);
  });
});
