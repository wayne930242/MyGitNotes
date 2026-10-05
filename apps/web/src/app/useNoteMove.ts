import { useState } from 'react';
import { relocateFocusPaths } from '@mygitnotes/core/focus-page';
import type { QueryClient } from '@tanstack/react-query';
import { fetchFiles, type FileResult, mutateFile } from '../lib/files-api.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import { planNoteMove } from '../lib/note-move.js';
import { noteLookupOptions, type NoteQueryScope } from '../lib/use-note-queries.js';
import type { NoteItem } from '../lib/types.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  config: WorkspaceState['config'];
  remote: boolean;
  canWriteNotebook: WorkspaceState['canWriteNotebook'];
  readDraft: WorkspaceState['readDraft'];
  updateDraft: WorkspaceState['updateDraft'];
  stageWorkingNote: WorkspaceState['stageWorkingNote'];
  focus: WorkspaceState['focus'];
  queryClient: QueryClient;
  queryScope: NoteQueryScope;
  flushEditors: () => Promise<boolean>;
  beforeFileChange: () => Promise<void>;
  onFilesChanged: (result: FileResult) => Promise<void>;
  setActionError: WorkspaceState['setActionError'];
  t: I18nContextValue['t'];
}

/** The Move action of an open note or compilation: the note it asks to move, and the move to the folder chosen for it. */
export function useNoteMove({ config, remote, canWriteNotebook, readDraft, updateDraft, stageWorkingNote, focus, queryClient, queryScope, flushEditors, beforeFileChange, onFilesChanged, setActionError, t }: Params) {
  const [moving, setMoving] = useState<NoteItem | null>(null);
  const [busy, setBusy] = useState(false);
  const moveNote = (note: NoteItem) => canWriteNotebook(note.notebookId) ? () => setMoving(note) : undefined;

  const moveTo = async (note: NoteItem, folder: string | null) => {
    const notebook = config?.notebooks.find(nb => nb.id === note.notebookId);
    if (!notebook) return;
    // The editor's pending edits are saved first, so the move carries them.
    if (!await flushEditors()) throw new Error(t('folder.draftsHint'));
    const plan = planNoteMove(note.path, notebook.root, folder, remote ? readDraft(note.notebookId, note.path) : undefined);
    if (plan.kind === 'none') return;
    if (plan.kind === 'file') {
      await beforeFileChange();
      const result = await mutateFile({ kind: 'move', notebookId: note.notebookId, path: note.path, destination: plan.destination }, (await fetchFiles(note.notebookId)).revision);
      await onFilesChanged(result);
      return;
    }
    const taken = Boolean(readDraft(note.notebookId, plan.destination)) || (await queryClient.fetchQuery(noteLookupOptions(queryScope, [{ notebookId: note.notebookId, path: plan.destination }], false))).notes.length > 0;
    if (taken) throw new Error(t('files.moveTaken', { path: plan.destination }));
    stageWorkingNote({ ...plan.draft.note, path: plan.destination }, null);
    updateDraft(note.notebookId, note.path, null);
    // A Focus tab of the draft follows it, as a file move relocates the tabs of a committed note.
    const page = structuredClone(focus.page);
    if (relocateFocusPaths(page, note.notebookId, path => path === note.path ? plan.destination : path)) focus.change(page);
    await onFilesChanged({ revision: '', selectedPath: plan.destination, pathMap: { [note.path]: plan.destination }, deletedPaths: [] });
  };

  const confirmMove = async (folder: string | null) => {
    if (!moving || busy) return;
    setBusy(true);
    setActionError('');
    try {
      await moveTo(moving, folder);
      setMoving(null);
    } catch (error) {
      setActionError((error as Error).message);
      setMoving(null);
    } finally {
      setBusy(false);
    }
  };

  return { moving, busy, moveNote, confirmMove, cancelMove: () => setMoving(null) };
}
