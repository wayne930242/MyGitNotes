import { addDays } from './date-utils.js';

/** Builds the Date cells for a month's calendar grid, padded to full weeks. */
export function buildMonthGrid(year: number, month: number, weekStartDay: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const leadingDays = (firstOfMonth.getDay() - weekStartDay + 7) % 7;
  const gridStart = addDays(firstOfMonth, -leadingDays);

  const lastOfMonth = new Date(year, month + 1, 0);
  const trailingDays = (weekStartDay - 1 - lastOfMonth.getDay() + 7) % 7;
  const gridEnd = addDays(lastOfMonth, trailingDays);

  const days: Date[] = [];
  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}
