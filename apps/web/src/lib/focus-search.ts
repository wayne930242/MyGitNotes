import type { FocusTab } from '@mygitnotes/core/focus-page';
import { useNotePaths } from './use-note-queries.js';

/** The paths of the notes and compilations of `notebookId` that match the toolbar search, or null while it is inactive or unanswered. */
export function useFocusSearch({ q, notebookId, enabled }: { q: string; notebookId: string; enabled: boolean; }): ReadonlySet<string> | null {
  const text = q.trim();
  const result = useNotePaths(enabled && text ? { notebookId, q: text, kind: 'all', showHidden: true } : null);
  // A failed or unanswered search leaves the Focus as it is rather than dimming everything.
  if (!enabled || !text || result.error || (result.loading && result.notes.length === 0)) return null;
  return new Set(result.notes.map(note => note.path));
}

/** Whether a tab is dimmed by the search: it is not among the matches. */
export const tabDimmed = (matches: ReadonlySet<string> | null, tab: FocusTab) => matches !== null && !matches.has(tab.path);

/** A pane is dimmed as a whole when the search is active and none of its tabs match. */
export const paneDimmed = (matches: ReadonlySet<string> | null, tabs: readonly FocusTab[]) => matches !== null && tabs.every(tab => tabDimmed(matches, tab));
