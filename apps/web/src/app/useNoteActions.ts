import { type NoteListItem } from '@mygitnotes/core/note-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { noteRoute, noteTrail, parseWorkspaceRoute, WorkspaceTab } from '../lib/routes.js';
import React from 'react';
import { fetchAssets } from '../lib/api.js';
import { useNoteEditorRegistry } from '../lib/note-editing.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  activeTab: WorkspaceTab;
  editorRegistry: ReturnType<typeof useNoteEditorRegistry>;
  setEditingNote: React.Dispatch<React.SetStateAction<NoteListItem | null>>;
  config: WorkspaceState['config'];
  location: ReturnType<typeof useLocation>;
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
  returnTo: string;
  selectedFolder: string | null;
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
  navigate: ReturnType<typeof useNavigate>;
  setAssets: WorkspaceState['setAssets'];
}

export function useNoteActions({ activeTab, editorRegistry, setEditingNote, config, location, editorRoute, returnTo, selectedFolder, selectedNotebookId, navigate, setAssets }: Params) {
  // Note Handlers
  const handleOpenNote = async (note: NoteListItem, anchor = '') => {
    // Zoom is a Notes route: leaving another tab unmounts its graph cards, so their edits are saved first.
    if (activeTab !== 'notes' && !await editorRegistry.flushEditors()) return;
    setEditingNote(note);

    const notebook = config?.notebooks.find(nb => nb.id === note.notebookId);
    if (notebook) {
      const query = new URLSearchParams(location.search);
      query.delete('notebook');
      query.set('returnTo', editorRoute.note ? returnTo : location.pathname + location.search + location.hash);
      if (selectedFolder && note.notebookId === selectedNotebookId) query.set('folder', selectedFolder);
      else query.delete('folder');
      // `returnTo` stays the browse view behind the editor, so a note reached from another note
      // stacks that note on the trail instead, and closing walks back the way the reader came.
      const trail = editorRoute.note ? [...noteTrail(location.state), location.pathname + location.search + location.hash] : [];
      navigate(noteRoute(notebook.id, note.path.slice(notebook.root.length + 1)) + '?' + query.toString() + (anchor ? '#' + encodeURIComponent(anchor) : ''), { state: trail.length ? { noteTrail: trail } : null });
    }
    const targetNotebook = note.notebookId || selectedNotebookId;
    if (targetNotebook) {
      fetchAssets(targetNotebook).then(setAssets).catch(console.error);
    }
  };

  return { handleOpenNote };
}
