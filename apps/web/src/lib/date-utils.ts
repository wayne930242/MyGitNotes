function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Formats a Date as `YYYY-MM-DD` in local time. */
export function formatDateYMD(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Formats a Date as `YYYY-MM-DD HH:mm` in local time. */
export function formatDateTime(date: Date): string {
  return `${formatDateYMD(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** The next Monday strictly after `from` (today's own Monday does not count). */
export function nextMonday(from: Date): Date {
  const daysUntilMonday = ((1 - from.getDay() + 7) % 7) || 7;
  return startOfDay(addDays(from, daysUntilMonday));
}

/**
 * The locale's first day of the week as a JS day index (0=Sunday..6=Saturday).
 * Falls back to Sunday when the runtime has no week-info data for the locale.
 */
export function getLocaleWeekStartDay(locale?: string): number {
  const resolved = locale || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  try {
    const info = (new Intl.Locale(resolved) as Intl.Locale & { weekInfo?: { firstDay: number; }; }).weekInfo;
    if (info && typeof info.firstDay === 'number') return info.firstDay % 7;
  } catch {
    // Unsupported locale or missing weekInfo; fall through to the default.
  }
  return 0;
}
