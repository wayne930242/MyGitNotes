import { type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';

/** A row/card click with a modifier held toggles selection instead of opening the note,
 * matching FolderTree's and the graph's modifier-click convention. */
export function isSelectionClick(event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; }): boolean {
  return Boolean(event.shiftKey || event.ctrlKey || event.metaKey);
}

/** Toggle one note's membership in the selection map, keyed by `noteRefKey`. */
export function toggleNoteSelection<T extends NoteRef>(selected: Map<string, T>, note: T): Map<string, T> {
  const next = new Map(selected);
  const key = noteRefKey(note);
  if (next.has(key)) next.delete(key);
  else next.set(key, note);
  return next;
}

/** Drop selected notes whose keys are no longer in `availableKeys`; returns the same map when nothing changed. */
export function pruneNoteSelection<T extends NoteRef>(selected: Map<string, T>, availableKeys: Set<string>): Map<string, T> {
  let changed = false;
  const next = new Map<string, T>();
  for (const [key, note] of selected) {
    if (availableKeys.has(key)) next.set(key, note);
    else changed = true;
  }
  return changed ? next : selected;
}
