import type { ChangeRequest, FileChange } from '../lib/types.js';
import { WorkspaceTab } from '../lib/routes.js';
import { workingDiff } from '../lib/working-notes.js';
import { type NoteChangeFacts, noteChangeFacts } from '../lib/commit-summary.js';
import React, { useState } from 'react';
import { type AgentSystemHandle } from '../components/AgentSystemView.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  activeTab: WorkspaceTab;
  agentSystemRef: React.RefObject<AgentSystemHandle>;
  remote: WorkspaceState['remote'];
  documents: WorkspaceState['documents'];
  setActionError: WorkspaceState['setActionError'];
  activeWorkingNotes: WorkspaceState['activeWorkingNotes'];
  pendingDocuments: WorkspaceState['pendingDocuments'];
  canWriteNotebook: WorkspaceState['canWriteNotebook'];
  repositoryFor: WorkspaceState['repositoryFor'];
}

export function useChangeDialog({ activeTab, agentSystemRef, remote, documents, setActionError, activeWorkingNotes, pendingDocuments, canWriteNotebook, repositoryFor }: Params) {
  const [commitRequest, setCommitRequest] = useState<ChangeRequest>();
  const [isCommitOpen, setIsCommitOpen] = useState<boolean>(false);

  const openCommitModal = (request?: ChangeRequest) => {
    void (async () => {
      if (activeTab === 'agent' && !await agentSystemRef.current?.prepareLeave()) return;
      if (!remote) await Promise.all(documents.map(document => document.save()));
      setCommitRequest(request);
      setIsCommitOpen(true);
    })().catch(error => setActionError(error.message));
  };

  /** A document draft of the open notebook's repository reports its load failure; drafts of other repositories were loaded when they were written. */
  const documentError = (repository: string, file: string) => documents.find(document => document.repository === repository && document.file === file)?.error;
  const panelRemoteChanges: FileChange[] | undefined = remote
    ? [
      ...Object.values(activeWorkingNotes).map(entry => ({ path: entry.note.path, repository: repositoryFor(entry.note.notebookId)?.id, kind: entry.blocked ? 'conflict' as const : entry.deleted ? 'deleted' as const : entry.base ? 'modified' as const : 'added' as const, tracked: Boolean(entry.base), revision: JSON.stringify(entry), available: canWriteNotebook(entry.note.notebookId) && !entry.blocked, staged: false, unstaged: true })),
      // Pending documents are listed only for repositories this requester may commit to.
      ...pendingDocuments.map(document => ({ path: document.file, repository: document.repository, kind: 'modified' as const, tracked: true, revision: document.diff, available: !document.error && !documentError(document.repository, document.file), staged: false, unstaged: true })),
    ]
    : undefined;
  const draftOf = (file: FileChange) => Object.values(activeWorkingNotes).find(entry => entry.note.path === file.path && repositoryFor(entry.note.notebookId)?.id === file.repository);
  const panelGetPreview = remote
    ? (file: FileChange) => {
      const document = pendingDocuments.find(pending => pending.repository === file.repository && pending.file === file.path);
      if (document) return document.diff;
      const draft = draftOf(file);
      return draft ? workingDiff({ [file.path]: draft }) : '';
    }
    : undefined;

  /** What the selected drafts change, for the commit message; a pending document is named by its file. */
  const panelDescribeChanges = remote
    ? (files: FileChange[]) => {
      const notes: NoteChangeFacts[] = [], changedDocuments: string[] = [];
      for (const file of files) {
        const draft = draftOf(file);
        if (draft) notes.push(noteChangeFacts(draft.note, draft.base, draft.deleted));
        else changedDocuments.push(file.path);
      }
      return { notes, documents: changedDocuments };
    }
    : undefined;

  return { commitRequest, isCommitOpen, setIsCommitOpen, openCommitModal, panelRemoteChanges, panelGetPreview, panelDescribeChanges };
}
