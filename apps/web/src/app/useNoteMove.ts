import { useState } from 'react';
import { relocateFocusPaths } from '@mygitnotes/core/focus-page';
import type { QueryClient } from '@tanstack/react-query';
import { readNote } from '../lib/api.js';
import { fetchFiles, type FileResult, mutateFile } from '../lib/files-api.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import { noteStem, noteSuffix, planRelocation, renamedPath, retitle } from '../lib/note-move.js';
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
  /** Saves a note the way its editor does: a remote draft, or the local working tree. */
  saveNote: (params: { path: string; notebookId: string; content: string; metadata?: Record<string, unknown>; }) => Promise<NoteItem>;
  focus: WorkspaceState['focus'];
  queryClient: QueryClient;
  queryScope: NoteQueryScope;
  flushEditors: () => Promise<boolean>;
  beforeFileChange: () => Promise<void>;
  onFilesChanged: (result: FileResult) => Promise<void>;
  setActionError: WorkspaceState['setActionError'];
  t: I18nContextValue['t'];
}

/** What the Move or Rename dialog acts on. A compilation keeps its name in its own file, so it applies the new name itself. */
export type NoteMoveRequest = { mode: 'move'; note: NoteItem; } | { mode: 'rename'; note: NoteItem; applyTitle?: (title: string) => void; };

const isCompilation = (path: string) => noteSuffix(path) === '.compilation.yml';

/** The Move and Rename actions of an open note, outline or compilation, and the dialogs that choose the folder or name. */
export function useNoteMove({ config, remote, canWriteNotebook, readDraft, updateDraft, stageWorkingNote, saveNote, focus, queryClient, queryScope, flushEditors, beforeFileChange, onFilesChanged, setActionError, t }: Params) {
  const [request, setRequest] = useState<NoteMoveRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const moveNote = (note: NoteItem) => canWriteNotebook(note.notebookId) ? () => setRequest({ mode: 'move', note }) : undefined;
  const renameNote = (note: NoteItem, applyTitle?: (title: string) => void) => canWriteNotebook(note.notebookId) ? () => setRequest({ mode: 'rename', note, applyTitle }) : undefined;

  /** Puts `note` at `destination`, retitled `title` when given (a compilation has already applied it). */
  const relocate = async (note: NoteItem, destination: string, title?: string) => {
    // The editors' pending edits are saved first, so the move carries them.
    if (!await flushEditors()) throw new Error(t('folder.draftsHint'));
    const retitled = title && !isCompilation(note.path) ? title : undefined;
    const withTitle = (current: NoteItem) => retitled ? { ...current, ...retitle(current.content, current.metadata, retitled, noteSuffix(current.path) === '.outline.md', current.title), title: retitled } : current;
    const plan = planRelocation(note.path, destination, remote ? readDraft(note.notebookId, note.path) : undefined);
    if (plan.kind !== 'none') {
      const taken = Boolean(readDraft(note.notebookId, destination)) || (await queryClient.fetchQuery(noteLookupOptions(queryScope, [{ notebookId: note.notebookId, path: destination }], false))).notes.length > 0;
      if (taken) throw new Error(t('files.moveTaken', { path: destination }));
    }
    if (plan.kind === 'draft') {
      stageWorkingNote(withTitle({ ...plan.draft.note, path: destination }), null);
      updateDraft(note.notebookId, note.path, null);
      // A Focus tab of the draft follows it, as a file move relocates the tabs of a committed note.
      const page = structuredClone(focus.page);
      if (relocateFocusPaths(page, note.notebookId, path => path === note.path ? destination : path)) focus.change(page);
      await onFilesChanged({ revision: '', selectedPath: destination, pathMap: { [note.path]: destination }, deletedPaths: [] });
      return;
    }
    let result: FileResult = { revision: '', selectedPath: destination, pathMap: {}, deletedPaths: [] };
    if (plan.kind === 'file') {
      await beforeFileChange();
      result = await mutateFile({ kind: 'move', notebookId: note.notebookId, path: note.path, destination }, (await fetchFiles(note.notebookId)).revision);
    }
    const save = async () => {
      if (!retitled) return;
      const current = withTitle(readDraft(note.notebookId, destination)?.note ?? await readNote(destination, note.notebookId));
      await saveNote({ path: destination, notebookId: note.notebookId, content: current.content, metadata: current.metadata });
    };
    // A local file is retitled where it now lies before the editor reopens it; a remote move commits, so the
    // new title is staged on the moved note once the workspace has read that commit.
    if (!remote) await save();
    await onFilesChanged(result);
    if (remote) await save();
  };

  const run = async (action: (current: NoteMoveRequest) => Promise<void>) => {
    if (!request || busy) return;
    setBusy(true);
    setActionError('');
    try {
      await action(request);
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setRequest(null);
      setBusy(false);
    }
  };

  const confirmMove = (folder: string | null) =>
    run(async ({ note }) => {
      const notebook = config?.notebooks.find(nb => nb.id === note.notebookId);
      if (!notebook) return;
      const base = notebook.root.replace(/\/$/, '');
      await relocate(note, `${folder ? `${base}/${folder}` : base}/${note.path.slice(note.path.lastIndexOf('/') + 1)}`);
    });

  const confirmRename = (name: string) =>
    run(async current => {
      const title = name.trim();
      if (!noteStem(title)) throw new Error(t('files.renameInvalid'));
      if (current.mode === 'rename') current.applyTitle?.(title);
      await relocate(current.note, renamedPath(current.note.path, title), title);
    });

  return { request, busy, moveNote, renameNote, confirmMove, confirmRename, cancel: () => setRequest(null) };
}
