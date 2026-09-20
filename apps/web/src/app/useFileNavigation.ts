import { type NoteListItem } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import { listLocalDrafts } from '../lib/storage.js';
import { useLocation, useNavigate } from 'react-router-dom';
import { noteRoute, parseWorkspaceRoute } from '../lib/routes.js';
import { readWorkingNotes } from '../lib/working-notes.js';
import React from 'react';
import { readNote } from '../lib/api.js';
import { useNoteEditorRegistry } from '../lib/note-editing.js';
import { type FileResult } from '../lib/files-api.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';
import type { useNoteRestoration } from './useNoteRestoration.js';

interface Params {
  editorRegistry: ReturnType<typeof useNoteEditorRegistry>;
  workingScope: WorkspaceState['workingScope'];
  documents: WorkspaceState['documents'];
  t: I18nContextValue['t'];
  config: WorkspaceState['config'];
  setFileDialog: React.Dispatch<React.SetStateAction<{ notebookId: string; path?: string; movePath?: string; } | undefined>>;
  setActionError: WorkspaceState['setActionError'];
  refreshWorkspace: WorkspaceState['refreshWorkspace'];
  refreshDocuments: () => Promise<void>;
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
  editorNotebookId: string;
  setEditingNote: React.Dispatch<React.SetStateAction<NoteListItem | null>>;
  navigate: ReturnType<typeof useNavigate>;
  location: ReturnType<typeof useLocation>;
  returnTo: string;
  setFileEditorRevision: React.Dispatch<React.SetStateAction<number>>;
  selectedFolder: string | null;
  folderRoot: string | undefined;
  changeFilters: FilterControls['onChange'];
  handleOpenFolderIndex: ReturnType<typeof useNoteRestoration>['handleOpenFolderIndex'];
}

export function useFileNavigation({ editorRegistry, workingScope, documents, t, config, setFileDialog, setActionError, refreshWorkspace, refreshDocuments, editorRoute, editorNotebookId, setEditingNote, navigate, location, returnTo, setFileEditorRevision, selectedFolder, folderRoot, changeFilters, handleOpenFolderIndex }: Params) {
  const beforeFileChange = async () => {
    await editorRegistry.flushEditors();
    if (Object.keys(readWorkingNotes(workingScope)).length || listLocalDrafts(workingScope).length || documents.some(document => document.dirty)) throw new Error(t('folder.draftsHint'));
  };
  const openFileManager = (notebookId: string, relativePath = '') => {
    const notebook = config?.notebooks.find(nb => nb.id === notebookId);
    if (notebook) setFileDialog({ notebookId, path: notebook.root + (relativePath ? '/' + relativePath : '') });
  };
  const handleMoveNote = async (note: NoteListItem) => {
    try {
      await beforeFileChange();
      setFileDialog({ notebookId: note.notebookId, path: note.path, movePath: note.path });
    } catch (error) {
      setActionError((error as Error).message);
      throw error;
    }
  };
  const moveNoteAction = (note: NoteListItem) => {
    void handleMoveNote(note).catch(() => {});
  };
  const onFilesChanged = async (result: FileResult) => {
    await refreshWorkspace();
    await refreshDocuments();
    if (editorRoute.note) {
      const nb = config?.notebooks.find(nb => nb.id === editorNotebookId);
      const previous = nb ? nb.root + '/' + editorRoute.note : '';
      if (nb && result.pathMap[previous]) {
        setEditingNote(null);
        navigate(noteRoute(nb.id, result.pathMap[previous].slice(nb.root.length + 1)) + location.search, { replace: true });
        setFileDialog(undefined);
      } else if (nb) {
        try {
          if (result.deletedPaths.includes(previous)) {
            setEditingNote(null);
            navigate(returnTo, { replace: true });
          } else {
            setEditingNote(await readNote(previous, nb.id));
            setFileEditorRevision(value => value + 1);
          }
        } catch (error) {
          if ((error as { status?: number; }).status !== 404) throw error;
          setEditingNote(null);
          navigate(returnTo, { replace: true });
        }
      }
    }
    if (selectedFolder && folderRoot && result.pathMap[folderRoot + '/' + selectedFolder]) {
      const moved = result.pathMap[folderRoot + '/' + selectedFolder];
      changeFilters({ folders: [moved] });
    }
  };
  const openFileIndex = async (path: string, notebookId: string) => {
    const nb = config?.notebooks.find(nb => nb.id === notebookId);
    if (!nb) return;
    await handleOpenFolderIndex(path === nb.root ? '' : path.slice(nb.root.length + 1), undefined, nb.id);
    setFileDialog(undefined);
  };

  return { beforeFileChange, openFileManager, moveNoteAction, onFilesChanged, openFileIndex };
}
