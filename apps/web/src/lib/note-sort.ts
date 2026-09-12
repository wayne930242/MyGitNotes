import { NoteItem } from './types.js';

export type SortField = 'updated' | 'created' | 'title' | 'status';
export type SortOrder = 'asc' | 'desc';

export interface SortConfig {
  field: SortField;
  order: SortOrder;
}

export const SORT_FIELD_STORAGE_KEY = 'github-notes:sort-field';
export const SORT_ORDER_STORAGE_KEY = 'github-notes:sort-order';

export const DEFAULT_SORT: SortConfig = {
  field: 'updated',
  order: 'desc',
};

/**
 * Parses timestamp from note metadata or mtime.
 */
function getTimestamp(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

/**
 * Sorts an array of notes based on the given sort field, order, and status workflow list.
 * Returns a new sorted array without mutating the original.
 */
export function sortNotes(
  notes: NoteItem[],
  field: SortField,
  order: SortOrder,
  statuses: string[] = []
): NoteItem[] {
  const factor = order === 'asc' ? 1 : -1;

  return [...notes].sort((a, b) => {
    switch (field) {
      case 'title': {
        const titleA = (a.title || '').trim();
        const titleB = (b.title || '').trim();
        return factor * titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' });
      }

      case 'status': {
        const statusA = (a.status || '').trim().toLowerCase();
        const statusB = (b.status || '').trim().toLowerCase();
        const indexA = statuses.indexOf(statusA);
        const indexB = statuses.indexOf(statusB);

        // Put unknown statuses at the end
        const rankA = indexA >= 0 ? indexA : Number.MAX_SAFE_INTEGER;
        const rankB = indexB >= 0 ? indexB : Number.MAX_SAFE_INTEGER;

        if (rankA !== rankB) {
          return factor * (rankA - rankB);
        }
        return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
      }

      case 'created': {
        const timeA = getTimestamp(a.metadata?.created ?? a.metadata?.date, a.mtime || 0);
        const timeB = getTimestamp(b.metadata?.created ?? b.metadata?.date, b.mtime || 0);
        if (timeA !== timeB) {
          return factor * (timeA - timeB);
        }
        return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
      }

      case 'updated':
      default: {
        const timeA = getTimestamp(a.metadata?.updated, a.mtime || 0);
        const timeB = getTimestamp(b.metadata?.updated, b.mtime || 0);
        if (timeA !== timeB) {
          return factor * (timeA - timeB);
        }
        return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
      }
    }
  });
}

/**
 * Loads sort configuration from localStorage with safe fallback to DEFAULT_SORT.
 */
export function getSavedSort(): SortConfig {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_SORT;
  }
  try {
    const rawField = window.localStorage.getItem(SORT_FIELD_STORAGE_KEY);
    const rawOrder = window.localStorage.getItem(SORT_ORDER_STORAGE_KEY);

    const validFields: SortField[] = ['updated', 'created', 'title', 'status'];
    const validOrders: SortOrder[] = ['asc', 'desc'];

    const field = validFields.includes(rawField as SortField) ? (rawField as SortField) : DEFAULT_SORT.field;
    const order = validOrders.includes(rawOrder as SortOrder) ? (rawOrder as SortOrder) : DEFAULT_SORT.order;

    return { field, order };
  } catch {
    return DEFAULT_SORT;
  }
}

/**
 * Persists sort configuration to localStorage.
 */
export function saveSort(field: SortField, order: SortOrder): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(SORT_FIELD_STORAGE_KEY, field);
    window.localStorage.setItem(SORT_ORDER_STORAGE_KEY, order);
  } catch {
    // ignore quota / storage errors
  }
}
