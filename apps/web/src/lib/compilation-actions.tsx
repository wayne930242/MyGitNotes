import { createContext, type ReactNode, useContext } from 'react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { NoteItem } from './types.js';

/** What the open workspace lets a compilation do to its file; every write goes through the note actions. */
export interface CompilationActions {
  /** Whether the notebook's repository may be written. */
  canWrite: (notebookId: string) => boolean;
  /** Writes a changed compilation: the YAML, with the title, tags and status the listings show. */
  save: (note: Pick<NoteListItem, 'path' | 'notebookId'>, content: string, metadata: Record<string, unknown>) => Promise<unknown>;
  /** Writes a new compilation file; a taken path fails. */
  create: (notebookId: string, path: string, content: string, metadata: Record<string, unknown>) => Promise<NoteItem>;
  /** Deletes a compilation like a note. */
  remove: (note: NoteListItem) => Promise<void>;
  /** The repository that keeps the Study data of a notebook. */
  repository: (notebookId: string) => string | undefined;
  /** Starts a note in the folder or tag a dynamic compilation draws from. */
  createNote?: (context?: { notebookId?: string; folder?: string; tag?: string; }) => void;
}

const CompilationActionsContext = createContext<CompilationActions | null>(null);

export function CompilationActionsProvider({ value, children }: { value: CompilationActions; children: ReactNode; }) {
  return <CompilationActionsContext.Provider value={value}>{children}</CompilationActionsContext.Provider>;
}

export function useCompilationActions(): CompilationActions {
  const actions = useContext(CompilationActionsContext);
  if (!actions) throw new Error('useCompilationActions must be used within a CompilationActionsProvider');
  return actions;
}
