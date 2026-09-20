import { type NoteListItem } from '@mygitnotes/core/note-query';
import { adoptGraphDrafts } from '../lib/storage.js';
import { readWorkingNotes } from '../lib/working-notes.js';
import React, { useEffect } from 'react';
import { fetchGitStatus, saveNote } from '../lib/api.js';
import type { NoteItem } from '../lib/types.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  canWrite: WorkspaceState['canWrite'];
  remote: WorkspaceState['remote'];
  workingScope: WorkspaceState['workingScope'];
  readCommittedNote: (path: string) => Promise<NoteItem>;
  t: I18nContextValue['t'];
  stageWorkingNote: WorkspaceState['stageWorkingNote'];
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
  invalidateNotes: () => void;
  setEditingNote: React.Dispatch<React.SetStateAction<NoteListItem | null>>;
  setGitStatus: WorkspaceState['setGitStatus'];
  sourceId: WorkspaceState['sourceId'];
  branch: WorkspaceState['branch'];
}

export function useNoteSaving({ canWrite, remote, workingScope, readCommittedNote, t, stageWorkingNote, selectedNotebookId, invalidateNotes, setEditingNote, setGitStatus, sourceId, branch }: Params) {
  const handleSaveNote = async (params: { path: string; content: string; metadata?: Record<string, unknown>; notebookId?: string; revision?: string; baseNote?: NoteItem; }) => {
    if (!canWrite) throw new Error('This workspace is read-only.');
    if (remote) {
      // A draft is staged against the committed note it was edited from; read it when the
      // caller did not bring one, so nothing is written from a list row without a body.
      const pending = readWorkingNotes(workingScope)[params.path];
      const base = pending?.base === null ? null : params.baseNote || pending?.base || await readCommittedNote(params.path);
      const original = pending?.note || base;
      if (!original) throw new Error(t('notes.unavailable'));
      return stageWorkingNote({ ...original, content: params.content, metadata: params.metadata || original.metadata, title: typeof params.metadata?.title === 'string' ? params.metadata.title : original.title, status: typeof params.metadata?.status === 'string' ? params.metadata.status : undefined, tags: Array.isArray(params.metadata?.tags) ? params.metadata.tags.map(String) : [], revision: base?.revision || original.revision }, base, pending?.blocked);
    }
    // Local saves update the working tree for the explicit Commit action.
    const res = await saveNote({ ...params, notebookId: params.notebookId || selectedNotebookId, noCommit: true });
    // The local workspace keeps one revision, so its cached query answers are refetched.
    invalidateNotes();
    setEditingNote(prev => prev?.path === res.note.path ? res.note : prev);
    // Refresh git status to update dirty count
    const statusRes = await fetchGitStatus();
    setGitStatus(statusRes.status);
    return res.note;
  };

  // Drafts the retired graph editing store left behind join the editor's own draft recovery.
  useEffect(() => adoptGraphDrafts(`${sourceId}:${branch}`), [sourceId, branch]);

  return { handleSaveNote };
}
