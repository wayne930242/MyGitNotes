import { type NoteListItem, type NoteRef } from '@mygitnotes/core/note-query';
import { useNavigate } from 'react-router-dom';
import React, { useState } from 'react';
import { deleteNote, fetchGitStatus, restoreNote } from '../lib/api.js';
import type { NoteItem } from '../lib/types.js';
import { type FileResult, mutateFile } from '../lib/files-api.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  canWriteNotebook: WorkspaceState['canWriteNotebook'];
  revisionFor: WorkspaceState['revisionFor'];
  setNotebookRevision: WorkspaceState['setNotebookRevision'];
  updateDraft: WorkspaceState['updateDraft'];
  editingNote: NoteListItem | null;
  setEditingNote: React.Dispatch<React.SetStateAction<NoteListItem | null>>;
  navigate: ReturnType<typeof useNavigate>;
  returnTo: string;
  remote: WorkspaceState['remote'];
  setActionError: WorkspaceState['setActionError'];
  readNoteForChange: (note: NoteRef) => Promise<NoteItem>;
  invalidateNotes: () => void;
  setGitStatus: WorkspaceState['setGitStatus'];
}

export function useDeletionUndo({ canWriteNotebook, revisionFor, setNotebookRevision, updateDraft, editingNote, setEditingNote, navigate, returnTo, remote, setActionError, readNoteForChange, invalidateNotes, setGitStatus }: Params) {
  const [deletedNotes, setDeletedNotes] = useState<NoteItem[]>([]);
  const [undoToast, setUndoToast] = useState<{ note: NoteItem; timerId: any; } | null>(null);

  // Remote delete: no working tree to trash into, so commit the removal immediately.
  const handleRemoteDeleteNote = async (note: NoteListItem) => {
    if (!canWriteNotebook(note.notebookId)) return;
    let result: FileResult;
    try {
      result = await mutateFile({ kind: 'delete', notebookId: note.notebookId, path: note.path }, note.revision || revisionFor(note.notebookId));
    } catch (error) {
      setActionError((error as Error).message);
      throw error;
    }
    // Apply everything in one synchronous batch: the still-mounted editor must not re-stage a
    // phantom draft for the path we just deleted while the new revision is being queried.
    setNotebookRevision(note.notebookId, result.revision);
    updateDraft(note.notebookId, note.path, null);
    if (editingNote?.path === note.path) {
      setEditingNote(null);
      navigate(returnTo, { replace: true });
    }
  };

  // Trash action: delete without immediate commit, allowing restore
  const handleDeleteNote = async (note: NoteListItem) => {
    if (!canWriteNotebook(note.notebookId)) return;
    if (remote) return handleRemoteDeleteNote(note);
    // 1. Read the full note first; Undo restores it from this buffer.
    let deleted: NoteItem;
    try {
      deleted = await readNoteForChange(note);
    } catch (error) {
      setActionError((error as Error).message);
      return;
    }
    setDeletedNotes((prev) => [deleted, ...prev.filter((n) => n.path !== note.path)]);

    // 2. Delete from disk without committing to git
    await deleteNote(note.path, { noCommit: true });
    invalidateNotes();
    const statusRes = await fetchGitStatus();
    setGitStatus(statusRes.status);

    if (editingNote?.path === note.path) {
      setEditingNote(null);
    }

    // 4. Trigger Undo Toast notification
    if (undoToast?.timerId) clearTimeout(undoToast.timerId);
    const timerId = setTimeout(() => {
      setUndoToast(null);
    }, 8000);
    setUndoToast({ note: deleted, timerId });
  };

  // Restore deleted note before commit
  const handleRestoreNote = async (note: NoteItem) => {
    const res = await restoreNote({ path: note.path, content: note.content, metadata: note.metadata, notebookId: note.notebookId });
    if (!res.note) throw new Error('The deleted note could not be restored.');
    invalidateNotes();
    setDeletedNotes((prev) => prev.filter((n) => n.path !== note.path));

    if (undoToast?.note.path === note.path) {
      clearTimeout(undoToast.timerId);
      setUndoToast(null);
    }

    const statusRes = await fetchGitStatus();
    setGitStatus(statusRes.status);
  };

  return { deletedNotes, setDeletedNotes, undoToast, setUndoToast, handleDeleteNote, handleRestoreNote };
}
