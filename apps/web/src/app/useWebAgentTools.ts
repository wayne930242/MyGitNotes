import { noteRefKey } from '@mygitnotes/core/note-query';
import { isNoteFile } from '@mygitnotes/core/note-file';
import { useCallback } from 'react';
import { getLocalDraft } from '../lib/storage.js';
import { noteExternalEdit } from '../lib/external-note-edits.js';
import { workingDiff, type WorkingNote } from '../lib/working-notes.js';
import { draftScope } from '../lib/workspace-repositories.js';
import type { NoteItem } from '../lib/types.js';
import type { WebToolHandler } from '../lib/pi-agent/session.js';
import type { WorkspaceState } from './workspace-state.js';
import type { useWorkspaceNotes } from './useWorkspaceNotes.js';

interface Params {
  config: WorkspaceState['config'];
  activeWorkingNotes: WorkspaceState['activeWorkingNotes'];
  repositoryFor: WorkspaceState['repositoryFor'];
  canWriteNotebook: WorkspaceState['canWriteNotebook'];
  revisionFor: WorkspaceState['revisionFor'];
  readDraft: WorkspaceState['readDraft'];
  updateDraft: WorkspaceState['updateDraft'];
  stageWorkingNote: WorkspaceState['stageWorkingNote'];
  findCommittedNote: ReturnType<typeof useWorkspaceNotes>['findCommittedNote'];
}

const text = (value: unknown, name: string) => {
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  return value;
};

/**
 * The agent's note tools for a remote workspace: reads see the person's working changes, and writes become
 * working changes of this page, which the person commits. Nothing here commits or reaches the repository host.
 */
export function useWebAgentTools({ config, activeWorkingNotes, repositoryFor, canWriteNotebook, revisionFor, readDraft, updateDraft, stageWorkingNote, findCommittedNote }: Params): WebToolHandler {
  return useCallback<WebToolHandler>(async (tool, args) => {
    /** The notebook a repository-relative path belongs to; `notebookId` tells repositories with the same path apart. */
    const locate = () => {
      const path = text(args.path, 'path');
      if (!isNoteFile(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`${path} is not a note path.`);
      const named = typeof args.notebookId === 'string' ? args.notebookId : undefined;
      const candidates = (config?.notebooks ?? []).filter(notebook => (!named || notebook.id === named) && path.startsWith(`${notebook.root}/`));
      if (!candidates.length) throw new Error(`${path} is not inside ${named ? `notebook ${named}` : 'any notebook'}.`);
      if (candidates.length > 1) throw new Error(`${path} is in several notebooks (${candidates.map(notebook => notebook.id).join(', ')}); name one as notebookId.`);
      return { path, notebookId: candidates[0].id };
    };
    /** Refuses a note whose editor holds typing that is not a working change yet, so the agent never overwrites it. */
    const assertNotEditing = (notebookId: string, path: string, draft: WorkingNote | undefined) => {
      const repository = repositoryFor(notebookId);
      const typing = repository && getLocalDraft(draftScope(repository), path);
      if (typing && !(draft && typing.content === draft.note.content)) throw new Error(`The person is editing ${path}; ask them to finish first.`);
    };
    const assertWritable = (notebookId: string) => {
      if (!canWriteNotebook(notebookId)) throw new Error('This notebook is read-only for the person.');
    };
    /** The note as the person sees it: their working change, else the committed note; null when neither exists. */
    const current = async (notebookId: string, path: string) => {
      const draft = readDraft(notebookId, path);
      if (draft?.deleted) throw new Error(`${path} is deleted in the person's working changes; it waits in their trash.`);
      if (draft) return { draft, note: draft.note, base: draft.base };
      const committed = await findCommittedNote({ notebookId, path });
      return { draft: undefined, note: committed, base: committed };
    };
    const describe = (note: NoteItem, source: 'working' | 'committed') => ({ path: note.path, notebookId: note.notebookId, source, metadata: note.metadata, content: note.content });
    /** Stages `content` and `metadata` for the note, created when it does not exist, and shows it in an open editor. */
    const stage = async (notebookId: string, path: string, content: string, metadata: Record<string, unknown> | undefined) => {
      assertWritable(notebookId);
      const draft = readDraft(notebookId, path);
      assertNotEditing(notebookId, path, draft);
      // A deleted note written again is a change of the committed note it deleted.
      const base = draft ? draft.base : await findCommittedNote({ notebookId, path });
      const original = draft && !draft.deleted ? draft.note : base;
      const merged = { ...original?.metadata, ...metadata };
      const note: NoteItem = original ? { ...original, content, metadata: merged, revision: base?.revision || original.revision } : { id: path, path, notebookId, title: path.split('/').pop() || path, content, metadata: merged, tags: [], revision: revisionFor(notebookId) };
      stageWorkingNote(note, base);
      noteExternalEdit(noteRefKey({ notebookId, path }));
      return { path, notebookId, source: 'working' as const, created: !base };
    };

    switch (tool) {
      case 'read_note': {
        const { path, notebookId } = locate();
        const { draft, note } = await current(notebookId, path);
        if (!note) throw new Error(`No note at ${path}.`);
        return describe(note, draft ? 'working' : 'committed');
      }
      case 'write_note': {
        const { path, notebookId } = locate();
        const metadata = args.metadata === undefined ? undefined : args.metadata;
        if (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))) throw new Error('metadata must be an object.');
        return stage(notebookId, path, text(args.content, 'content'), metadata as Record<string, unknown> | undefined);
      }
      case 'edit_note': {
        const { path, notebookId } = locate();
        const oldText = text(args.oldText, 'oldText'), newText = text(args.newText, 'newText');
        const { note } = await current(notebookId, path);
        if (!note) throw new Error(`No note at ${path}.`);
        const found = oldText ? note.content.split(oldText).length - 1 : 0;
        if (found !== 1) throw new Error(found ? `oldText occurs ${found} times in ${path}; include more context so it occurs once.` : `oldText does not occur in ${path}.`);
        return stage(notebookId, path, note.content.replace(oldText, () => newText), undefined);
      }
      case 'delete_note': {
        const { path, notebookId } = locate();
        assertWritable(notebookId);
        const draft = readDraft(notebookId, path);
        assertNotEditing(notebookId, path, draft);
        if (draft?.deleted) throw new Error(`${path} is already deleted; it waits in the person's trash.`);
        // A note that exists only as a working change has nothing to keep: its change goes.
        if (draft && !draft.base) {
          updateDraft(notebookId, path, null);
          return { path, notebookId, deleted: true, trashed: false };
        }
        const base = draft?.base ?? await findCommittedNote({ notebookId, path });
        if (!base) throw new Error(`No note at ${path}.`);
        stageWorkingNote(base, base, undefined, true);
        return { path, notebookId, deleted: true, trashed: true };
      }
      case 'list_changes':
        return { changes: Object.values(activeWorkingNotes).map(entry => ({ path: entry.note.path, notebookId: entry.note.notebookId, kind: entry.deleted ? 'deleted' : entry.base ? 'modified' : 'added', ...(entry.blocked ? { blocked: entry.blocked } : {}), diff: workingDiff({ [entry.note.path]: entry }) })) };
      default:
        throw new Error(`Unknown note tool ${tool}.`);
    }
  }, [config, activeWorkingNotes, repositoryFor, canWriteNotebook, revisionFor, readDraft, updateDraft, stageWorkingNote, findCommittedNote]);
}
