import { readWorkingNotes } from '../lib/working-notes.js';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateNoteQueries, NOTE_QUERY_KEY, noteLookupOptions, setNoteQueryScope, useNoteQueryScope, useStaleNoteQueries } from '../lib/use-note-queries.js';
import type { NoteItem } from '../lib/types.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  sourceId: WorkspaceState['sourceId'];
  revision: WorkspaceState['revision'];
  activeWorkingNotes: WorkspaceState['activeWorkingNotes'];
  remote: WorkspaceState['remote'];
  refreshWorkspace: WorkspaceState['refreshWorkspace'];
  workingScope: WorkspaceState['workingScope'];
  t: I18nContextValue['t'];
}

export function useWorkspaceNotes({ sourceId, revision, activeWorkingNotes, remote, refreshWorkspace, workingScope, t }: Params) {
  // Every note query is answered for this source and revision; staged drafts are overlaid on top.
  const queryClient = useQueryClient();
  useLayoutEffect(() => {
    setNoteQueryScope({ sourceId, revision, drafts: activeWorkingNotes });
  }, [sourceId, revision, activeWorkingNotes]);
  const queryScope = useNoteQueryScope();
  const invalidateNotes = () => {
    void invalidateNoteQueries(queryClient);
  };
  // Staged drafts are overlaid on remote answers; only local saves change what the note queries return.
  const refreshNotes = async () => {
    if (!remote) await invalidateNoteQueries(queryClient);
  };
  // The server answers from the branch head: a rejected revision or cursor means this client is
  // behind, so the workspace is refreshed and every list restarts from its first page.
  const [staleNotice, setStaleNotice] = useState('');
  useStaleNoteQueries(message => {
    setStaleNotice(message);
    void refreshWorkspace().then(() => queryClient.resetQueries({ queryKey: NOTE_QUERY_KEY }));
  });
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Route and source transitions reset transient UI and load the newly selected document. */
    setStaleNotice('');
    /* eslint-enable react/set-state-in-effect */
  }, [revision]);
  /** The committed note behind a path, ignoring any staged draft, for use as a merge base. */
  const readCommittedNote = async (path: string): Promise<NoteItem> => {
    const result = await queryClient.fetchQuery(noteLookupOptions(queryScope, [path], true));
    const note = result.notes.find(item => item.path === path);
    if (!note || typeof note.content !== 'string') throw new Error(t('notes.readFailed', { path }));
    return note as NoteItem;
  };
  /** The note a change must be applied to: the staged draft when there is one, else the committed note. */
  const readNoteForChange = async (path: string): Promise<NoteItem> => {
    const pending = remote ? readWorkingNotes(workingScope)[path] : undefined;
    return pending ? pending.note : readCommittedNote(path);
  };

  return { queryClient, queryScope, invalidateNotes, refreshNotes, staleNotice, readCommittedNote, readNoteForChange };
}
