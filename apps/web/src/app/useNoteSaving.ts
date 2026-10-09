import { sameNote } from '@mygitnotes/core/note-query';
import { type NoteListItem } from '@mygitnotes/core/note-query';
import { adoptGraphDrafts } from '../lib/storage.js';
import React, { useEffect } from 'react';
import { fetchGitStatus, saveNote } from '../lib/api.js';
import type { NoteItem } from '../lib/types.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';
import type { useWorkspaceNotes } from './useWorkspaceNotes.js';

type WorkspaceNotes = ReturnType<typeof useWorkspaceNotes>;

interface Params {
  canWriteNotebook: WorkspaceState['canWriteNotebook'];
  remote: WorkspaceState['remote'];
  readDraft: WorkspaceState['readDraft'];
  readCommittedNote: WorkspaceNotes['readCommittedNote'];
  t: I18nContextValue['t'];
  stageWorkingNote: WorkspaceState['stageWorkingNote'];
  invalidateNotes: () => void;
  setEditingNote: React.Dispatch<React.SetStateAction<NoteListItem | null>>;
  setGitStatus: WorkspaceState['setGitStatus'];
  /** The default repository's draft scope, where the retired graph editing store kept its drafts. */
  defaultDraftScope: string;
}

export function useNoteSaving({ canWriteNotebook, remote, readDraft, readCommittedNote, t, stageWorkingNote, invalidateNotes, setEditingNote, setGitStatus, defaultDraftScope }: Params) {
  /** Saves a note of `notebookId`, whose repository decides whether it may be written. */
  const handleSaveNote = async (params: { path: string; content: string; metadata?: Record<string, unknown>; notebookId: string; revision?: string; baseNote?: NoteItem; }) => {
    if (!canWriteNotebook(params.notebookId)) throw new Error('This workspace is read-only.');
    if (remote) {
      // A draft is staged against the committed note it was edited from; read it when the
      // caller did not bring one, so nothing is written from a list row without a body.
      const pending = readDraft(params.notebookId, params.path);
      const base = pending?.base === null ? null : params.baseNote || pending?.base || await readCommittedNote({ notebookId: params.notebookId, path: params.path });
      const original = pending?.note || base;
      if (!original) throw new Error(t('notes.unavailable'));
      return stageWorkingNote({ ...original, content: params.content, metadata: params.metadata || original.metadata, title: typeof params.metadata?.title === 'string' ? params.metadata.title : original.title, status: typeof params.metadata?.status === 'string' ? params.metadata.status : undefined, tags: Array.isArray(params.metadata?.tags) ? params.metadata.tags.map(String) : [], revision: base?.revision || original.revision }, base, pending?.blocked);
    }
    // Local saves update the working tree for the explicit Commit action.
    const res = await saveNote({ ...params, noCommit: true });
    // The local workspace keeps one revision, so its cached query answers are refetched.
    invalidateNotes();
    setEditingNote(prev => prev && sameNote(prev, res.note) ? res.note : prev);
    // Refresh git status to update dirty count
    const statusRes = await fetchGitStatus();
    setGitStatus(statusRes.status);
    return res.note;
  };

  // Drafts the retired graph editing store left behind join the editor's own draft recovery.
  useEffect(() => {
    if (defaultDraftScope) adoptGraphDrafts(defaultDraftScope);
  }, [defaultDraftScope]);

  return { handleSaveNote };
}
