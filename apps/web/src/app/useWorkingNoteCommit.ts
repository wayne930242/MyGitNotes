import { clearCommittedNotes, readWorkingNotes, type WorkingNotes } from '../lib/working-notes.js';
import { mergeNote, sameValue } from '../lib/merge-note.js';
import { ApiError, commitRemoteNotes, fetchWorkspace, readNotes } from '../lib/api.js';
import type { NoteItem } from '../lib/types.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  workingScope: WorkspaceState['workingScope'];
  documents: WorkspaceState['documents'];
  sourceId: WorkspaceState['sourceId'];
  t: I18nContextValue['t'];
  stageWorkingNote: WorkspaceState['stageWorkingNote'];
  setWorkingNotes: WorkspaceState['setWorkingNotes'];
  setRevision: WorkspaceState['setRevision'];
}

export function useWorkingNoteCommit({ workingScope, documents, sourceId, t, stageWorkingNote, setWorkingNotes, setRevision }: Params) {
  const commitWorkingNotes = async (files: string[], message: string) => {
    const pending = readWorkingNotes(workingScope);
    const sentDocuments = documents.filter(document => files.includes(document.file)).map(document => document.prepareCommit());
    const selected = files.filter(file => !sentDocuments.some(document => document.path === file)).map(file => pending[file]).filter(Boolean);
    if (selected.length + sentDocuments.length !== files.length) throw new Error('Pending files changed. Review the selection again.');
    const workspace = await fetchWorkspace(true);
    if (!workspace.capabilities.write || workspace.source.identity !== sourceId) throw new Error('Sign in with write access to this workspace before committing.');
    const expected = workspace.revision!;
    const sent: WorkingNotes = {};
    let reviewRequired = false;
    const existingPaths = selected.filter(entry => entry.base).map(entry => entry.note.path);
    const latestNotes = existingPaths.length ? await readNotes(existingPaths, expected) : [];
    const latestByPath = new Map(latestNotes.map(note => [note.path, note]));
    for (const entry of selected) {
      if (entry.blocked) throw new Error(`${entry.note.path}: ${entry.blocked}`);
      let prepared = entry;
      if (entry.base) {
        let latest: NoteItem;
        try {
          latest = latestByPath.get(entry.note.path)!;
          if (!latest) throw new ApiError('Note moved or deleted remotely.', 404);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            const blocked = 'Moved or deleted remotely. Open the note and refresh after it is restored.';
            stageWorkingNote(entry.note, entry.base, blocked);
          }
          throw error;
        }
        if (latest.revision !== expected) throw new Error('Remote changed during review. Retry Commit to check the latest revision.');
        const merged = mergeNote(entry.base, entry.note, latest);
        if (merged.conflict) {
          const blocked = 'Remote changes conflict with this draft. Open the note and Refresh remote version.';
          stageWorkingNote(entry.note, entry.base, blocked);
          throw new Error(`${entry.note.path}: ${blocked}`);
        }
        if (!sameValue(merged.draft, { content: entry.note.content, metadata: entry.note.metadata })) reviewRequired = true;
        prepared = { base: latest, note: { ...entry.note, ...merged.draft, revision: latest.revision } };
      }
      // Compare again after network reads so another tab's newer draft survives.
      if (!sameValue(readWorkingNotes(workingScope)[entry.note.path], entry)) throw new Error('Local draft changed during review. Retry Commit.');
      stageWorkingNote(prepared.note, prepared.base);
      const persisted = readWorkingNotes(workingScope)[entry.note.path];
      if (persisted) sent[entry.note.path] = persisted;
    }
    if (reviewRequired) throw new Error(t('changes.reviewRequired'));
    if (!Object.keys(sent).length && !sentDocuments.length) return;
    const result = await commitRemoteNotes(Object.values(sent).map(entry => ({ path: entry.note.path, content: entry.note.content, metadata: entry.note.metadata, createOnly: !entry.base })), expected, message, sentDocuments.map(({ path, page, base }) => ({ path, page, base })));
    for (const document of sentDocuments) document.committed(result.revision);
    setWorkingNotes(clearCommittedNotes(workingScope, sent));
    setRevision(result.revision);
  };

  return { commitWorkingNotes };
}
