import { useMemo } from 'react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { fetchGitStatus, saveNote } from '../lib/api.js';
import type { CompilationActions } from '../lib/compilation-actions.js';
import type { GitStatus, NoteItem } from '../lib/types.js';

interface Params {
  remote: boolean;
  canWriteNotebook: (notebookId: string) => boolean;
  repositoryId: (notebookId: string) => string | undefined;
  revisionFor: (notebookId: string) => string | undefined;
  save: (params: { path: string; content: string; metadata?: Record<string, unknown>; notebookId: string; }) => Promise<unknown>;
  remove: (note: NoteListItem) => Promise<void>;
  stageWorkingNote: (note: NoteItem, base: NoteItem | null) => NoteItem;
  invalidateNotes: () => void;
  setGitStatus: (status: GitStatus) => void;
  createNote: CompilationActions['createNote'];
}

/** What compilation views may do to the workspace, wired to the same handlers notes use. */
export function useCompilationActionsValue({ remote, canWriteNotebook, repositoryId, revisionFor, save, remove, stageWorkingNote, invalidateNotes, setGitStatus, createNote }: Params): CompilationActions {
  return useMemo(() => ({
    canWrite: canWriteNotebook,
    save: (note, content, metadata) => save({ path: note.path, notebookId: note.notebookId, content, metadata }),
    create: async (notebookId, path, content, metadata) => {
      if (!canWriteNotebook(notebookId)) throw new Error('This workspace is read-only.');
      if (remote) {
        const title = typeof metadata.title === 'string' ? metadata.title : path;
        return stageWorkingNote({ id: path, path, notebookId, title, content, metadata, tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [], ...(typeof metadata.status === 'string' ? { status: metadata.status } : {}), revision: revisionFor(notebookId) }, null);
      }
      const { note } = await saveNote({ path, notebookId, createOnly: true, content, metadata, noCommit: true });
      invalidateNotes();
      setGitStatus((await fetchGitStatus()).status);
      return note;
    },
    remove,
    repository: repositoryId,
    createNote,
  }), [remote, canWriteNotebook, repositoryId, revisionFor, save, remove, stageWorkingNote, invalidateNotes, setGitStatus, createNote]);
}
