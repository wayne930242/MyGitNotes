import { useState } from 'react';
import type { NoteItem } from '../lib/types.js';

export function useDeletionBuffer() {
  // Deletion and Undo Buffer State (Requirement 2)
  const [deletedNotes, setDeletedNotes] = useState<NoteItem[]>([]);
  const [undoToast, setUndoToast] = useState<{ note: NoteItem; timerId: any; } | null>(null);

  return { deletedNotes, setDeletedNotes, undoToast, setUndoToast };
}
