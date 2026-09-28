import { useLayoutEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateNoteQueries, noteLookupOptions, resetStaleNoteQueries, setNoteQueryScope, useNoteQueryScope, useStaleNoteQueries } from '../lib/use-note-queries.js';
import { notebookRepositories, revisionSet } from '../lib/workspace-repositories.js';
import type { NoteItem } from '../lib/types.js';
import type { NoteRef } from '@mygitnotes/core/note-query';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  sourceId: WorkspaceState['sourceId'];
  repositories: WorkspaceState['repositories'];
  activeWorkingNotes: WorkspaceState['activeWorkingNotes'];
  remote: WorkspaceState['remote'];
  refreshWorkspace: WorkspaceState['refreshWorkspace'];
  readDraft: WorkspaceState['readDraft'];
  t: I18nContextValue['t'];
}

export function useWorkspaceNotes({ sourceId, repositories, activeWorkingNotes, remote, refreshWorkspace, readDraft, t }: Params) {
  // Every note query is answered for the revisions of the repositories it reads; staged drafts are overlaid on top.
  const queryClient = useQueryClient();
  const revisions = useMemo(() => revisionSet(repositories), [repositories]);
  const notebooks = useMemo(() => notebookRepositories(repositories), [repositories]);
  useLayoutEffect(() => {
    setNoteQueryScope({ sourceId, revisions, repositories: notebooks, drafts: activeWorkingNotes });
  }, [sourceId, revisions, notebooks, activeWorkingNotes]);
  const queryScope = useNoteQueryScope();
  const invalidateNotes = () => {
    void invalidateNoteQueries(queryClient);
  };
  // Staged drafts are overlaid on remote answers; only local saves change what the note queries return.
  const refreshNotes = async () => {
    if (!remote) await invalidateNoteQueries(queryClient);
  };
  // The server answers from each branch head: a rejected revision or cursor means this client is
  // behind, so the workspace is refreshed and the lists reading a stale repository restart from their first page.
  const [staleNotice, setStaleNotice] = useState('');
  useStaleNoteQueries((message, stale) => {
    setStaleNotice(message);
    void refreshWorkspace(true).then(() => resetStaleNoteQueries(queryClient, stale));
  });
  const revisionKey = JSON.stringify(revisions);
  const [previousRevisions, setPreviousRevisions] = useState(revisionKey);
  if (previousRevisions !== revisionKey) {
    setPreviousRevisions(revisionKey);
    setStaleNotice('');
  }
  /** The committed note, ignoring any staged draft, for use as a merge base. */
  const readCommittedNote = async (ref: NoteRef): Promise<NoteItem> => {
    const result = await queryClient.fetchQuery(noteLookupOptions(queryScope, [ref], true));
    const note = result.notes[0];
    if (!note || typeof note.content !== 'string') throw new Error(t('notes.readFailed', { path: ref.path }));
    return note as NoteItem;
  };
  /** The note a change must be applied to: the staged draft when there is one, else the committed note. */
  const readNoteForChange = async (ref: NoteRef): Promise<NoteItem> => {
    const pending = remote ? readDraft(ref.notebookId, ref.path) : undefined;
    return pending ? pending.note : readCommittedNote(ref);
  };

  return { queryClient, queryScope, invalidateNotes, refreshNotes, staleNotice, readCommittedNote, readNoteForChange };
}
