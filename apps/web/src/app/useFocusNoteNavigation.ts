import { type NoteListItem } from '@mygitnotes/core/note-query';
import type { NoteItem } from '../lib/types.js';
import type { WorkspaceState } from './workspace-state.js';
import type { useFocusPanes } from './useFocusPanes.js';
import type { useNoteActions } from './useNoteActions.js';

interface Params {
  noteFocus: ReturnType<typeof useFocusPanes>['noteFocus'];
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
  setFocusNarrowView: ReturnType<typeof useFocusPanes>['setFocusNarrowView'];
  handleOpenNote: ReturnType<typeof useNoteActions>['handleOpenNote'];
  setAddingToFocus: ReturnType<typeof useFocusPanes>['setAddingToFocus'];
}

export function useFocusNoteNavigation({ noteFocus, selectedNotebookId, setFocusNarrowView, handleOpenNote, setAddingToFocus }: Params) {
  /** In a displayed Focus a note of this notebook opens in a pane: the active one, or beside `source`; false leaves it to zoom. */
  const openInFocus = async (note: NoteListItem, source?: number) => {
    if (!noteFocus.shown || note.notebookId !== selectedNotebookId) return false;
    const result = await noteFocus.openNote(note.path, source);
    if (result === 'opened') setFocusNarrowView('focus');
    return result === 'opened' || result === 'blocked';
  };
  const openFromBrowse = async (note: NoteListItem) => {
    if (!await openInFocus(note)) await handleOpenNote(note);
  };
  const openLink = async (note: NoteListItem, anchor?: string, source?: HTMLElement) => {
    const pane = source?.closest<HTMLElement>('[data-focus-pane]')?.dataset.focusPane;
    if (pane === undefined || !await openInFocus(note, Number(pane))) await handleOpenNote(note, anchor);
  };
  const zoomFocusNote = (path: string) => {
    const note = noteFocus.notes.get(path);
    if (note) void handleOpenNote(note);
  };
  const addToFocus = (note: NoteItem) => note.notebookId === selectedNotebookId ? () => setAddingToFocus({ tab: { kind: 'note', path: note.path }, label: note.title }) : undefined;

  return { openInFocus, openFromBrowse, openLink, zoomFocusNote, addToFocus };
}
