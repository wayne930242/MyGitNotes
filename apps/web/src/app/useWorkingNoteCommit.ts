import { readWorkingNotes, type WorkingNote, type WorkingNotes } from '../lib/working-notes.js';
import { mergeNote, sameValue } from '../lib/merge-note.js';
import { ApiError, commitRemoteNotes, fetchWorkspace, readNotes } from '../lib/api.js';
import { draftScope, type WorkspaceRepository } from '../lib/workspace-repositories.js';
import type { NoteItem } from '../lib/types.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  documents: WorkspaceState['documents'];
  sourceId: WorkspaceState['sourceId'];
  t: I18nContextValue['t'];
  stageWorkingNote: WorkspaceState['stageWorkingNote'];
  clearCommittedDrafts: WorkspaceState['clearCommittedDrafts'];
  setRepositoryRevision: WorkspaceState['setRepositoryRevision'];
}

type PreparedDocument = ReturnType<WorkspaceState['documents'][number]['prepareCommit']>;
interface CommitGroup {
  repository: WorkspaceRepository;
  entries: WorkingNote[];
  documents: PreparedDocument[];
}

/** Commits selected drafts one repository at a time, one commit each, stopping at the first repository that fails. */
export function useWorkingNoteCommit({ documents, sourceId, t, stageWorkingNote, clearCommittedDrafts, setRepositoryRevision }: Params) {
  /** One repository's drafts, merged onto its latest revision and committed as one commit. */
  const commitGroup = async ({ repository, entries, documents: sentDocuments }: CommitGroup, message: string) => {
    if (!repository.write) throw new Error('Sign in with write access to this workspace before committing.');
    const scope = draftScope(repository);
    const expected = repository.revision;
    const sent: WorkingNotes = {};
    let reviewRequired = false;
    const existingPaths = entries.filter(entry => entry.base).map(entry => entry.note.path);
    const latestNotes = existingPaths.length ? await readNotes(repository.id, existingPaths, expected) : [];
    const latestByPath = new Map(latestNotes.map(note => [note.path, note]));
    for (const entry of entries) {
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
      if (!sameValue(readWorkingNotes(scope)[entry.note.path], entry)) throw new Error('Local draft changed during review. Retry Commit.');
      stageWorkingNote(prepared.note, prepared.base);
      const persisted = readWorkingNotes(scope)[entry.note.path];
      if (persisted) sent[entry.note.path] = persisted;
    }
    if (reviewRequired) throw new Error(t('changes.reviewRequired'));
    if (!Object.keys(sent).length && !sentDocuments.length) return;
    const result = await commitRemoteNotes(repository.id, Object.values(sent).map(entry => ({ path: entry.note.path, content: entry.note.content, metadata: entry.note.metadata, createOnly: !entry.base })), expected, message, sentDocuments.map(({ path, page, base }) => ({ path, page, base })));
    for (const document of sentDocuments) document.committed(result.revision);
    clearCommittedDrafts(repository, sent);
    setRepositoryRevision(repository.id, result.revision);
  };

  const commitWorkingNotes = async (files: string[], message: string) => {
    const sentDocuments = documents.filter(document => files.includes(document.file)).map(document => document.prepareCommit());
    const workspace = await fetchWorkspace(true);
    if (workspace.home !== sourceId) throw new Error('Sign in with write access to this workspace before committing.');
    const repositories = workspace.repositories.filter(repository => !repository.unavailable);
    const groups = new Map<string, CommitGroup>();
    const groupOf = (repository: WorkspaceRepository) => {
      const group = groups.get(repository.id) ?? { repository, entries: [], documents: [] };
      groups.set(repository.id, group);
      return group;
    };
    for (const file of files.filter(file => !sentDocuments.some(document => document.path === file))) {
      const found = repositories.map(repository => ({ repository, entry: readWorkingNotes(draftScope(repository))[file] })).find(item => item.entry);
      if (!found) throw new Error('Pending files changed. Review the selection again.');
      groupOf(found.repository).entries.push(found.entry);
    }
    // Workspace documents live in the home repository.
    if (sentDocuments.length) {
      const home = repositories.find(repository => repository.id === workspace.home);
      if (!home) throw new Error('Sign in with write access to this workspace before committing.');
      groupOf(home).documents.push(...sentDocuments);
    }
    const committed: string[] = [];
    for (const group of groups.values()) {
      try {
        await commitGroup(group, message);
      } catch (error) {
        if (!committed.length) throw error;
        throw new Error(t('changes.partialCommit', { repositories: committed.join(', '), error: (error as Error).message }));
      }
      committed.push(group.repository.repository || group.repository.id);
    }
  };

  return { commitWorkingNotes };
}
