import type { ChangeRequest } from '../lib/types.js';
import { WorkspaceTab } from '../lib/routes.js';
import { workingDiff } from '../lib/working-notes.js';
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
  canWrite: WorkspaceState['canWrite'];
}

export function useChangeDialog({ activeTab, agentSystemRef, remote, documents, setActionError, activeWorkingNotes, pendingDocuments, canWrite }: Params) {
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

  const panelRemoteChanges = remote ? [...Object.values(activeWorkingNotes).map(entry => ({ path: entry.note.path, kind: entry.blocked ? 'conflict' as const : entry.base ? 'modified' as const : 'added' as const, tracked: Boolean(entry.base), revision: JSON.stringify(entry), available: canWrite && !entry.blocked, staged: false, unstaged: true })), ...pendingDocuments.map(document => ({ path: document.file, kind: 'modified' as const, tracked: true, revision: document.diff, available: canWrite && !document.error, staged: false, unstaged: true }))] : undefined;
  const panelGetPreview = remote ? (file: string) => documents.find(document => document.file === file)?.diff ?? (activeWorkingNotes[file] ? workingDiff({ [file]: activeWorkingNotes[file] }) : '') : undefined;

  return { commitRequest, isCommitOpen, setIsCommitOpen, openCommitModal, panelRemoteChanges, panelGetPreview };
}
