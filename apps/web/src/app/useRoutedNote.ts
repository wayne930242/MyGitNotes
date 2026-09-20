import { useEffect, useMemo, useState } from 'react';
import type { NotebookConfig, NoteItem } from '../lib/types.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { useNoteLookup } from '../lib/use-note-queries.js';
import type { parseWorkspaceRoute } from '../lib/routes.js';

interface UseRoutedNoteParams {
  config: { notebooks: NotebookConfig[]; } | null;
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
  editorNotebookId: string;
  editingNote: NoteListItem | null;
  loading: boolean;
  sourceId: string;
  setEditingNote: (note: NoteListItem | null) => void;
}

/** Opening a note reads that one note, with its body, instead of holding every note in memory. */
export function useRoutedNote({ config, editorRoute, editorNotebookId, editingNote, loading, sourceId, setEditingNote }: UseRoutedNoteParams) {
  const [routeError, setRouteError] = useState('');
  const routedNotebook = config?.notebooks.find(nb => nb.id === editorNotebookId) || (!editorRoute.notebook ? config?.notebooks[0] : undefined);
  const routedPath = editorRoute.note && routedNotebook ? `${routedNotebook.root}/${editorRoute.note}` : null;
  const routedLookup = useNoteLookup(routedPath ? [routedPath] : [], true);
  const routedCommitted = routedLookup.committed[0];
  const routedNote = useMemo<NoteItem | null>(() => {
    if (!routedPath) return null;
    if (editingNote?.path === routedPath && typeof editingNote.content === 'string') return editingNote as NoteItem;
    const found = routedLookup.notes[0];
    return found && typeof found.content === 'string' ? found as NoteItem : null;
  }, [routedPath, editingNote, routedLookup.notes]);
  const routedLoading = Boolean(routedPath) && !routedNote && routedLookup.loading;

  useEffect(() => {
    if (loading || !config) return;
    if (!editorRoute.valid) {
      /* eslint-disable react/set-state-in-effect -- Route resolution waits for configuration and the note query; preserve the previous error during loading and clear the shared editor only after route commit. */
      setRouteError('route.pageNotFound');
      /* eslint-enable react/set-state-in-effect */
      return;
    }
    if (!routedNotebook) {
      setRouteError('route.notebookNotFound');
      return;
    }
    if (!editorRoute.note) {
      setRouteError('');
      setEditingNote(null);
      return;
    }
    if (routedLookup.error) {
      setRouteError(routedLookup.error);
      return;
    }
    if (routedNote || routedLoading) {
      setRouteError('');
      return;
    }
    setRouteError('route.noteNotFound');
  }, [editorRoute, config, loading, editorNotebookId, sourceId, routedNotebook, routedNote, routedLoading, routedLookup.error, setEditingNote]);

  return { routedNotebook, routedPath, routedNote, routedCommitted, routedLoading, routeError };
}
