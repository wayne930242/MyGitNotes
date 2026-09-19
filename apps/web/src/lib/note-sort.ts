import type { SortField, SortOrder } from '@mygitnotes/core/note-sort';

export { noteUpdatedTime, type SortField, sortNotes, type SortOrder } from '@mygitnotes/core/note-sort';

export interface SortConfig {
  field: SortField;
  order: SortOrder;
}

export const SORT_FIELD_STORAGE_KEY = 'github-notes:sort-field';
export const SORT_ORDER_STORAGE_KEY = 'github-notes:sort-order';

export const DEFAULT_SORT: SortConfig = { field: 'updated', order: 'desc' };

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
