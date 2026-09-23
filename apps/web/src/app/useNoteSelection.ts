import { type NoteListItem } from '@mygitnotes/core/note-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { pruneNoteSelection, toggleNoteSelection } from '../lib/note-selection.js';
import type { ViewMode } from '../lib/types.js';

interface Params {
  /** The flat browse result for list/card views; empty (and not authoritative) for kanban, which
   * pages each column on its own, so pruning against it is skipped while kanban is active. */
  displayedNotes: NoteListItem[];
  viewMode: ViewMode;
  selectedNotebookId: string;
}

/** Multi-select for the browse views, matching FolderTree's and the graph's convention: a plain
 * click keeps opening the note; a modifier click toggles selection instead (see note-selection.ts). */
export function useNoteSelection({ displayedNotes, viewMode, selectedNotebookId }: Params) {
  const [selected, setSelected] = useState<Map<string, NoteListItem>>(new Map());

  const toggleSelect = useCallback((note: NoteListItem) => {
    setSelected(previous => toggleNoteSelection(previous, note));
  }, []);

  const clearSelection = useCallback(() => setSelected(new Map()), []);

  // A note that scrolled out of the current filter/page no longer belongs to the selection.
  useEffect(() => {
    if (viewMode === 'kanban') return;
    const availablePaths = new Set(displayedNotes.map(note => note.path));
    setSelected(previous => pruneNoteSelection(previous, availablePaths));
  }, [displayedNotes, viewMode]);

  // Switching notebooks leaves the previous selection's paths meaningless.
  useEffect(() => {
    setSelected(new Map());
  }, [selectedNotebookId]);

  const selectedPaths = useMemo(() => Array.from(selected.keys()), [selected]);
  const selectedNotes = useMemo(() => Array.from(selected.values()), [selected]);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  return { selectedNotes, selectedPaths, selectedPathSet, toggleSelect, clearSelection };
}
