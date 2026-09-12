export type TagSort = 'name-asc' | 'name-desc' | 'count-desc' | 'count-asc';
export const TAG_SORT_STORAGE_KEY = 'github-notes:tag-sort';

export function filterAndSortTags(counts: Record<string, number>, query: string, sort: TagSort, locale: string): string[] {
  const search = query.trim().toLocaleLowerCase(locale);
  const byName = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  return Object.keys(counts)
    .filter(tag => tag.toLocaleLowerCase(locale).includes(search))
    .sort((a, b) => {
      const nameOrder = byName.compare(a, b) || a.localeCompare(b, locale);
      if (sort === 'count-desc') return counts[b] - counts[a] || nameOrder;
      if (sort === 'count-asc') return counts[a] - counts[b] || nameOrder;
      return sort === 'name-desc' ? -nameOrder : nameOrder;
    });
}

export function getSavedTagSort(): TagSort {
  try {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(TAG_SORT_STORAGE_KEY) : null;
    if (saved === 'name-asc' || saved === 'name-desc' || saved === 'count-desc' || saved === 'count-asc') return saved;
  } catch { /* Keep the default when browser storage is blocked. */ }
  return 'name-asc';
}

export function saveTagSort(sort: TagSort): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(TAG_SORT_STORAGE_KEY, sort);
  } catch { /* Sorting still works when the preference cannot be saved. */ }
}
