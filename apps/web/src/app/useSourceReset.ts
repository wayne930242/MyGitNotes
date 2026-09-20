import { type NoteListItem } from '@mygitnotes/core/note-query';
import React, { useEffect } from 'react';
import type { WorkspaceState } from './workspace-state.js';
import type { useDeletionUndo } from './useDeletionUndo.js';

interface Params {
  sourceId: WorkspaceState['sourceId'];
  setEditingNote: React.Dispatch<React.SetStateAction<NoteListItem | null>>;
  setDeletedNotes: ReturnType<typeof useDeletionUndo>['setDeletedNotes'];
}

export function useSourceReset({ sourceId, setEditingNote, setDeletedNotes }: Params) {
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- The source transition clears state owned by other workspace hooks after commit; resetting their shared owner would discard unrelated UI state. */
    setEditingNote(null);
    /* eslint-enable react/set-state-in-effect */
    setDeletedNotes([]);
  }, [sourceId, setEditingNote, setDeletedNotes]);
}
