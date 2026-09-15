import { describe, expect, it } from 'vitest';
import { addDays, formatDateTime, formatDateYMD, getLocaleWeekStartDay, nextMonday, startOfDay } from './date-utils.js';

describe('formatDateYMD', () => {
  it('formats using local year/month/day, zero-padded', () => {
    expect(formatDateYMD(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatDateYMD(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('formatDateTime', () => {
  it('formats date and zero-padded 24h time', () => {
    expect(formatDateTime(new Date(2026, 8, 15, 9, 5))).toBe('2026-09-15 09:05');
    expect(formatDateTime(new Date(2026, 8, 15, 23, 59))).toBe('2026-09-15 23:59');
  });
});

describe('startOfDay / addDays', () => {
  it('zeroes the time of day', () => {
    const start = startOfDay(new Date(2026, 8, 15, 13, 45, 30));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(formatDateYMD(start)).toBe('2026-09-15');
  });

  it('adds and subtracts days across month boundaries', () => {
    expect(formatDateYMD(addDays(new Date(2026, 8, 30), 1))).toBe('2026-10-01');
    expect(formatDateYMD(addDays(new Date(2026, 8, 1), -1))).toBe('2026-08-31');
  });
});

describe('nextMonday', () => {
  it('skips today even when today is already Monday', () => {
    const monday = new Date(2026, 8, 14); // 2026-09-14 is a Monday
    expect(formatDateYMD(nextMonday(monday))).toBe('2026-09-21');
  });

  it('returns the coming Monday for any other day of the week', () => {
    const tuesday = new Date(2026, 8, 15);
    expect(formatDateYMD(nextMonday(tuesday))).toBe('2026-09-21');
    const sunday = new Date(2026, 8, 20);
    expect(formatDateYMD(nextMonday(sunday))).toBe('2026-09-21');
  });
});

describe('getLocaleWeekStartDay', () => {
  it('returns Sunday-first for en-US and Monday-first for de-DE', () => {
    expect(getLocaleWeekStartDay('en-US')).toBe(0);
    expect(getLocaleWeekStartDay('de-DE')).toBe(1);
  });

  it('falls back to Sunday for an unrecognized locale', () => {
    expect(getLocaleWeekStartDay('not-a-real-locale')).toBe(0);
  });
});
