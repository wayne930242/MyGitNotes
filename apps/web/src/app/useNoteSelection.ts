import { type NoteListItem } from '@mygitnotes/core/note-query';
import { useCallback, useMemo, useState } from 'react';
import { pruneNoteSelection, toggleNoteSelection } from '../lib/note-selection.js';
import type { ViewMode } from '../lib/types.js';

interface Params {
  /** The flat browse result for list/card views; empty (and not authoritative) for kanban, which
   * pages each column on its own, so pruning against it is skipped while kanban is active. */
  displayedNotes: NoteListItem[];
  viewMode: ViewMode;
  selectedNotebookId: string;
  scopeKey: string;
}

/** Multi-select for the browse views, matching FolderTree's and the graph's convention: a plain
 * click keeps opening the note; a modifier click toggles selection instead (see note-selection.ts). */
export function useNoteSelection({ displayedNotes, viewMode, selectedNotebookId, scopeKey }: Params) {
  const [selected, setSelected] = useState<Map<string, NoteListItem>>(new Map());
  const [selectionScope, setSelectionScope] = useState({ notebookId: selectedNotebookId, viewMode, key: scopeKey });

  // React's guarded render-time adjustment keeps the selection tied to its browse scope.
  // Kanban has its own paged columns, so displayedNotes cannot prune that view.
  if (selectionScope.notebookId !== selectedNotebookId || selectionScope.viewMode !== viewMode || selectionScope.key !== scopeKey) {
    setSelectionScope({ notebookId: selectedNotebookId, viewMode, key: scopeKey });
    setSelected(new Map());
  }

  const toggleSelect = useCallback((note: NoteListItem) => {
    setSelected(previous => toggleNoteSelection(previous, note));
  }, []);

  const clearSelection = useCallback(() => setSelected(new Map()), []);

  const visibleSelection = useMemo(() => viewMode === 'kanban' ? selected : pruneNoteSelection(selected, new Set(displayedNotes.map(note => note.path))), [displayedNotes, selected, viewMode]);
  const selectedPaths = useMemo(() => Array.from(visibleSelection.keys()), [visibleSelection]);
  const selectedNotes = useMemo(() => Array.from(visibleSelection.values()), [visibleSelection]);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  return { selectedNotes, selectedPaths, selectedPathSet, toggleSelect, clearSelection };
}
