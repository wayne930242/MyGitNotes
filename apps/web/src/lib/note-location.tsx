import { createContext, type ReactNode, useContext } from 'react';
import type { NoteRef } from '@mygitnotes/core/note-query';

/** Why a note cannot be edited. */
export type ReadOnlyReason = 'unavailable' | 'core' | 'branch' | 'no-push';

/** Where a note lives, as the note Info tab shows it. */
export interface NoteLocation {
  notebook: string;
  /** The platform repository, or the worktree path of a local home repository. */
  repository: string;
  branch: string;
  path: string;
  readOnly?: ReadOnlyReason;
  /** Whether the note may be published as a Gist: a writable note of a GitHub repository. */
  gists: boolean;
}

const NoteLocationContext = createContext<(note: NoteRef) => NoteLocation | undefined>(() => undefined);

export function NoteLocationProvider({ locate, children }: { locate: (note: NoteRef) => NoteLocation | undefined; children: ReactNode; }) {
  return <NoteLocationContext.Provider value={locate}>{children}</NoteLocationContext.Provider>;
}

export const useNoteLocation = (note: NoteRef) => useContext(NoteLocationContext)(note);

/** The reason a repository refuses edits: unavailable, the product `core` branch, another branch, or no push access. */
export function readOnlyReason(repository: { unavailable?: unknown; branch: string; write: boolean; } | undefined): ReadOnlyReason | undefined {
  if (!repository || repository.unavailable) return 'unavailable';
  if (repository.write) return undefined;
  if (repository.branch === 'core') return 'core';
  if (repository.branch && repository.branch !== 'main') return 'branch';
  return 'no-push';
}
