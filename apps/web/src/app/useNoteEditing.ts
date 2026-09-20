import { type NoteListItem } from '@mygitnotes/core/note-query';
import { useState } from 'react';

export function useNoteEditing() {
  const [editingNote, setEditingNote] = useState<NoteListItem | null>(null);
  const [fileEditorRevision, setFileEditorRevision] = useState(0);

  return { editingNote, setEditingNote, fileEditorRevision, setFileEditorRevision };
}
