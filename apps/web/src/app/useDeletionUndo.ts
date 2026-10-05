import { type NoteListItem, type NoteRef, sameNote } from '@mygitnotes/core/note-query';
import { useNavigate } from 'react-router-dom';
import React, { useEffect, useState } from 'react';
import { deleteNote, fetchFileChanges, fetchGitStatus, restoreNote } from '../lib/api.js';
import { pendingDeletedNotes } from '../lib/deleted-notes.js';
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
  gitStatus: WorkspaceState['gitStatus'];
  setGitStatus: WorkspaceState['setGitStatus'];
  repositoryFor: WorkspaceState['repositoryFor'];
}

export function useDeletionUndo({ canWriteNotebook, revisionFor, setNotebookRevision, updateDraft, editingNote, setEditingNote, navigate, returnTo, remote, setActionError, readNoteForChange, invalidateNotes, gitStatus, setGitStatus, repositoryFor }: Params) {
  const [deletedNotes, setDeletedNotes] = useState<NoteItem[]>([]);
  const [undoToast, setUndoToast] = useState<{ note: NoteItem; timerId: any; } | null>(null);
  const hasDeletedNotes = deletedNotes.length > 0;

  // A deletion committed or restored outside this app leaves the list once Git reports it gone.
  useEffect(() => {
    if (!hasDeletedNotes) return;
    let cancelled = false;
    void fetchFileChanges().then(changes => {
      if (!cancelled) setDeletedNotes(prev => pendingDeletedNotes(prev, changes, notebookId => repositoryFor(notebookId)?.id));
    }).catch(error => {
      if (!cancelled) setActionError((error as Error).message);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Reconcile when Git status changes, not on every new list entry or helper identity.
  }, [gitStatus, hasDeletedNotes]);

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
    if (editingNote && sameNote(editingNote, note)) {
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

    // 2. Delete from disk without committing to git; an untracked note leaves nothing to commit, so it is not listed.
    const { pending } = await deleteNote(note.path, { noCommit: true, notebookId: note.notebookId });
    setDeletedNotes((prev) => pending ? [deleted, ...prev.filter((n) => !sameNote(n, note))] : prev.filter((n) => !sameNote(n, note)));
    invalidateNotes();
    const statusRes = await fetchGitStatus();
    setGitStatus(statusRes.status);

    if (editingNote && sameNote(editingNote, note)) {
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
    setDeletedNotes((prev) => prev.filter((n) => !sameNote(n, note)));

    if (undoToast && sameNote(undoToast.note, note)) {
      clearTimeout(undoToast.timerId);
      setUndoToast(null);
    }

    const statusRes = await fetchGitStatus();
    setGitStatus(statusRes.status);
  };

  return { deletedNotes, setDeletedNotes, undoToast, setUndoToast, handleDeleteNote, handleRestoreNote };
}
