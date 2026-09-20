import { type NoteListItem } from '@mygitnotes/core/note-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { noteRoute } from '../lib/routes.js';
import { readWorkingNotes, updateWorkingNote } from '../lib/working-notes.js';
import React from 'react';
import { fetchGitStatus, readNote, restoreNote, saveNote } from '../lib/api.js';
import { useQueryClient } from '@tanstack/react-query';
import { noteLookupOptions, useNoteQueryScope } from '../lib/use-note-queries.js';
import { noteStatusChange } from '../lib/note-mutations.js';
import type { NoteItem } from '../lib/types.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';
import type { useNoteSaving } from './useNoteSaving.js';

interface Params {
  remote: WorkspaceState['remote'];
  workingScope: WorkspaceState['workingScope'];
  setWorkingNotes: WorkspaceState['setWorkingNotes'];
  setEditingNote: React.Dispatch<React.SetStateAction<NoteListItem | null>>;
  navigate: ReturnType<typeof useNavigate>;
  returnTo: string;
  invalidateNotes: () => void;
  setGitStatus: WorkspaceState['setGitStatus'];
  setActionError: WorkspaceState['setActionError'];
  handleSaveNote: ReturnType<typeof useNoteSaving>['handleSaveNote'];
  readNoteForChange: (path: string) => Promise<NoteItem>;
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
  canWrite: WorkspaceState['canWrite'];
  t: I18nContextValue['t'];
  config: WorkspaceState['config'];
  queryClient: ReturnType<typeof useQueryClient>;
  queryScope: ReturnType<typeof useNoteQueryScope>;
  stageWorkingNote: WorkspaceState['stageWorkingNote'];
  revision: WorkspaceState['revision'];
  location: ReturnType<typeof useLocation>;
}

export function useNoteRestoration({ remote, workingScope, setWorkingNotes, setEditingNote, navigate, returnTo, invalidateNotes, setGitStatus, setActionError, handleSaveNote, readNoteForChange, selectedNotebookId, canWrite, t, config, queryClient, queryScope, stageWorkingNote, revision, location }: Params) {
  // Restore single note file uncommitted changes from Git HEAD (Requirement 1)
  const handleRestoreNoteFile = async (notePath: string): Promise<NoteItem | null> => {
    try {
      if (remote) {
        if (readWorkingNotes(workingScope)[notePath]?.base === null) {
          setWorkingNotes(updateWorkingNote(workingScope, notePath, null));
          setEditingNote(null);
          navigate(returnTo, { replace: true });
          return null;
        }
        const latest = await readNote(notePath);
        setWorkingNotes(updateWorkingNote(workingScope, notePath, null));
        setEditingNote(latest);
        return latest;
      }
      const res = await restoreNote({ path: notePath });
      const restored = res.note;
      invalidateNotes();
      setEditingNote(res.note);
      if (!restored) navigate(returnTo, { replace: true });
      const statusRes = await fetchGitStatus();
      setGitStatus(statusRes.status);
      return res.note;
    } catch (err) {
      console.error('Failed to restore note file:', err);
      throw err;
    }
  };

  // In-table status change without opening note (Requirement 3)
  const handleUpdateNoteStatus = async (note: NoteListItem, newStatus: string) => {
    setActionError('');
    // The row carries no body; the note is read in full before the status is written.
    try {
      await handleSaveNote(await noteStatusChange(readNoteForChange, note, newStatus));
    } catch (error) {
      setActionError((error as Error).message);
    }
  };

  const handleOpenFolderIndex = async (folder: string, folderRevision?: string, notebookId = selectedNotebookId) => {
    if (!canWrite) throw new Error(t('folder.readOnly'));
    const notebook = config?.notebooks.find(item => item.id === notebookId);
    if (!notebook) throw new Error(t('route.notebookNotFound'));
    const path = `${notebook.root.replace(/\/$/, '')}/${folder}/index.md`;
    const existing = (await queryClient.fetchQuery(noteLookupOptions(queryScope, [path], true))).notes.find(item => item.path === path);
    let note: NoteListItem | undefined = (remote ? readWorkingNotes(workingScope)[path]?.note : undefined) || existing;
    if (!note) {
      const metadata = { title: t('folder.index'), tags: [] };
      const content = `# ${t('folder.index')}\n\n`;
      note = remote ? stageWorkingNote({ id: path, path, notebookId: notebook.id, title: metadata.title, content, metadata, tags: [], revision: folderRevision || revision }, null) : (await saveNote({ path, notebookId: notebook.id, content, metadata, createOnly: true, noCommit: true })).note;
      if (!remote) invalidateNotes();
    }
    setEditingNote(note);
    const query = new URLSearchParams(location.search);
    query.delete('notebook');
    query.set('folder', folder);
    navigate(noteRoute(notebook.id, `${folder}/index.md`) + '?' + query.toString());
    if (!remote) void fetchGitStatus().then(result => setGitStatus(result.status)).catch(error => setActionError(error.message));
  };

  return { handleRestoreNoteFile, handleUpdateNoteStatus, handleOpenFolderIndex };
}
