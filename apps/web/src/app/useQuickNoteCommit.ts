import { commitStagedChanges, fetchFileChanges } from '../lib/api.js';
import type { WorkspaceState } from './workspace-state.js';
import type { useWorkingNoteCommit } from './useWorkingNoteCommit.js';
import { commitMessage, noteChangeFacts, summarizeCommit } from '../lib/commit-summary.js';
import type { TranslationKey } from '../lib/i18n/index.js';
import type { NewVersionRequest } from '../lib/history-api.js';

interface Params {
  remote: WorkspaceState['remote'];
  repositoryFor: WorkspaceState['repositoryFor'];
  refreshWorkspace: WorkspaceState['refreshWorkspace'];
  commitWorkingNotes: ReturnType<typeof useWorkingNoteCommit>['commitWorkingNotes'];
  activeWorkingNotes: WorkspaceState['activeWorkingNotes'];
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

/** The fixed message of a one-note local commit, which has no draft to describe; it needs no diff review. */
export const quickCommitMessage = (path: string) => `docs(notes): update ${path.split('/').pop()!.replace(/\.[^.]+$/, '')}`;

/** Commits one note's saved changes alone, from the editor footer. */
export function useQuickNoteCommit({ remote, repositoryFor, refreshWorkspace, commitWorkingNotes, activeWorkingNotes, t }: Params) {
  /** With `version`, the commit also records this note's new version. */
  const commitNoteFile = async (path: string, notebookId: string, version?: NewVersionRequest) => {
    const repository = repositoryFor(notebookId)?.id;
    if (remote) {
      // A remote draft holds both versions, so the commit names what changed in it.
      const draft = Object.values(activeWorkingNotes).find(entry => entry.note.path === path && entry.note.notebookId === notebookId);
      const summary = draft && summarizeCommit([noteChangeFacts(draft.note, draft.base)], [], t);
      await commitWorkingNotes([{ path, repository }], summary ? commitMessage(summary.subject, summary.details) : quickCommitMessage(path), version);
    } else {
      const message = quickCommitMessage(path);
      // The reviewed revision guards the commit: the server refuses it when the file changed since this read.
      const change = (await fetchFileChanges()).find(file => file.path === path && file.repository === repository);
      if (!change?.available) throw new Error('This note has no committable change. Open Changes to review it.');
      await commitStagedChanges([change], message, true, version);
    }
    await refreshWorkspace();
  };
  return { commitNoteFile };
}
