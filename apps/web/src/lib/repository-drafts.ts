import type { RepositoryStatus } from '@mygitnotes/core/repository';
import { clearLocalDraft, listLocalDrafts } from './storage.js';
import { discardDocumentDraft, pendingDocumentDrafts } from './use-workspace-document.js';
import { WORKSPACE_DOCUMENT_CLIENTS } from './workspace-document-clients.js';
import { draftScope } from './workspace-repositories.js';
import { readStoredWorkingNotes, workingNotesKey } from './working-notes.js';

/** One uncommitted draft this browser holds for a repository. */
export interface RepositoryDraft {
  kind: 'note' | 'deletion' | 'document' | 'editor' | 'unreadable';
  path: string;
}

/** A repository as its drafts are keyed: by id and branch, its notebooks named by its alias. */
export type DraftRepository = Pick<RepositoryStatus, 'id' | 'branch' | 'alias'>;

/**
 * The drafts this browser holds for a repository: working notes and remote deletions waiting in Changes, workspace
 * document drafts, and editor drafts not yet saved. Hiding or removing the repository waits until they are gone, so no
 * work goes invisible; drafts of another browser stay there.
 */
export function repositoryDrafts(repository: DraftRepository): RepositoryDraft[] {
  const scope = draftScope(repository);
  let notes: RepositoryDraft[];
  try {
    notes = Object.entries(readStoredWorkingNotes(scope)).map(([path, entry]) => ({ kind: entry.deleted ? 'deletion' : 'note', path }));
  } catch {
    notes = [{ kind: 'unreadable', path: workingNotesKey(scope) }];
  }
  const documents = pendingDocumentDrafts(WORKSPACE_DOCUMENT_CLIENTS, [repository]).map((document): RepositoryDraft => ({ kind: 'document', path: document.file }));
  const editors = listLocalDrafts(scope).filter(draft => !notes.some(note => note.path === draft.path)).map((draft): RepositoryDraft => ({ kind: 'editor', path: draft.path }));
  return [...notes, ...documents, ...editors];
}

/** Discards every draft this browser holds for a repository. */
export function discardRepositoryDrafts(repository: DraftRepository): void {
  const scope = draftScope(repository);
  for (const draft of listLocalDrafts(scope)) clearLocalDraft(scope, draft.path);
  localStorage.removeItem(workingNotesKey(scope));
  for (const client of WORKSPACE_DOCUMENT_CLIENTS) discardDocumentDraft(client, repository.id);
}
