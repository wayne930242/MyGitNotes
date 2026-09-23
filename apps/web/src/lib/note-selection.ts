/** A row/card click with a modifier held toggles selection instead of opening the note,
 * matching FolderTree's and the graph's modifier-click convention. */
export function isSelectionClick(event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; }): boolean {
  return Boolean(event.shiftKey || event.ctrlKey || event.metaKey);
}

export interface Selectable {
  path: string;
}

/** Toggle one note's membership in the selection map, keyed by path. */
export function toggleNoteSelection<T extends Selectable>(selected: Map<string, T>, note: T): Map<string, T> {
  const next = new Map(selected);
  if (next.has(note.path)) next.delete(note.path);
  else next.set(note.path, note);
  return next;
}

/** Drop selected notes no longer present in `availablePaths`; returns the same map when nothing changed. */
export function pruneNoteSelection<T extends Selectable>(selected: Map<string, T>, availablePaths: Set<string>): Map<string, T> {
  let changed = false;
  const next = new Map<string, T>();
  for (const [path, note] of selected) {
    if (availablePaths.has(path)) next.set(path, note);
    else changed = true;
  }
  return changed ? next : selected;
}
