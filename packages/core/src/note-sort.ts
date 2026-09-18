export type SortField = 'updated' | 'created' | 'title' | 'status';
export type SortOrder = 'asc' | 'desc';

export interface SortableNote {
  title: string;
  status?: string;
  metadata: Record<string, unknown>;
  mtime?: number;
}

function getTimestamp(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

/** The time a note was last modified: its `updated` field, else its file mtime; 0 when neither is known. */
export function noteUpdatedTime(note: Pick<SortableNote, 'metadata' | 'mtime'>): number {
  return getTimestamp(note.metadata?.updated, note.mtime || 0);
}

const compareTitles = (a: SortableNote, b: SortableNote) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Sorts notes by field and order; status sorting follows the notebook workflow order with unknown statuses last.
 * Returns a new array without mutating the original.
 */
export function sortNotes<T extends SortableNote>(notes: T[], field: SortField, order: SortOrder, statuses: string[] = []): T[] {
  const factor = order === 'asc' ? 1 : -1;
  return [...notes].sort((a, b) => {
    switch (field) {
      case 'title':
        return factor * (a.title || '').trim().localeCompare((b.title || '').trim(), undefined, { numeric: true, sensitivity: 'base' });
      case 'status': {
        const indexA = statuses.indexOf((a.status || '').trim().toLowerCase());
        const indexB = statuses.indexOf((b.status || '').trim().toLowerCase());
        const rankA = indexA >= 0 ? indexA : Number.MAX_SAFE_INTEGER;
        const rankB = indexB >= 0 ? indexB : Number.MAX_SAFE_INTEGER;
        return rankA !== rankB ? factor * (rankA - rankB) : compareTitles(a, b);
      }
      case 'created': {
        const timeA = getTimestamp(a.metadata?.created ?? a.metadata?.date, a.mtime || 0);
        const timeB = getTimestamp(b.metadata?.created ?? b.metadata?.date, b.mtime || 0);
        return timeA !== timeB ? factor * (timeA - timeB) : compareTitles(a, b);
      }
      case 'updated':
      default: {
        const timeA = noteUpdatedTime(a);
        const timeB = noteUpdatedTime(b);
        return timeA !== timeB ? factor * (timeA - timeB) : compareTitles(a, b);
      }
    }
  });
}
