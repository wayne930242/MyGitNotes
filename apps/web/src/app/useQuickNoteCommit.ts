import { commitStagedChanges, fetchFileChanges } from '../lib/api.js';
import type { WorkspaceState } from './workspace-state.js';
import type { useWorkingNoteCommit } from './useWorkingNoteCommit.js';

interface Params {
  remote: WorkspaceState['remote'];
  repositoryFor: WorkspaceState['repositoryFor'];
  refreshWorkspace: WorkspaceState['refreshWorkspace'];
  commitWorkingNotes: ReturnType<typeof useWorkingNoteCommit>['commitWorkingNotes'];
}

/** The fixed message of a one-note commit; it needs no diff review, so it skips message generation. */
export const quickCommitMessage = (path: string) => `docs(notes): update ${path.split('/').pop()!.replace(/\.[^.]+$/, '')}`;

/** Commits one note's saved changes alone, from the editor footer. */
export function useQuickNoteCommit({ remote, repositoryFor, refreshWorkspace, commitWorkingNotes }: Params) {
  const commitNoteFile = async (path: string, notebookId: string) => {
    const repository = repositoryFor(notebookId)?.id;
    const message = quickCommitMessage(path);
    if (remote) await commitWorkingNotes([{ path, repository }], message);
    else {
      // The reviewed revision guards the commit: the server refuses it when the file changed since this read.
      const change = (await fetchFileChanges()).find(file => file.path === path && file.repository === repository);
      if (!change?.available) throw new Error('This note has no committable change. Open Changes to review it.');
      await commitStagedChanges([change], message, true);
    }
    await refreshWorkspace();
  };
  return { commitNoteFile };
}
