import type { QueryClient } from '@tanstack/react-query';
import { invertTagOperationPlan, planTagDelete, planTagMerge, planTagRename } from '@mygitnotes/core/tag-ops';
import { type TagOperationKind, type TagOperationLabel, useTagOperations } from '../lib/use-tag-operations.js';
import { applyTagEntries, PartialTagChangeError } from '../lib/tag-changes.js';
import { repositoryOf, type WorkspaceRepository } from '../lib/workspace-repositories.js';
import { noteLookupOptions, notePathsOptions, type NoteQueryScope } from '../lib/use-note-queries.js';
import type { I18nContextValue } from '../lib/i18n/index.js';

interface UseTagWorkspaceOperationsParams {
  queryClient: QueryClient;
  queryScope: NoteQueryScope;
  repositories: WorkspaceRepository[];
  remote: boolean;
  canWrite: boolean;
  t: I18nContextValue['t'];
  invalidateNotes: () => void;
  setRepositoryRevision: (id: string, revision: string) => void;
  setActionError: (message: string) => void;
}

/** Tag management: rename/merge/delete across the whole workspace, one commit per repository,
 * with a session-lifetime undo (kept in `tagOperations.history` until page reload). */
export function useTagWorkspaceOperations({ queryClient, queryScope, repositories, remote, canWrite, t, invalidateNotes, setRepositoryRevision, setActionError }: UseTagWorkspaceOperationsParams) {
  const tagOperations = useTagOperations();
  const readNotePaths = async (query: Parameters<typeof notePathsOptions>[1]): Promise<string[]> => (await queryClient.fetchQuery(notePathsOptions(queryScope, query))).paths;
  /** Every note carrying `tag`, in every notebook, hidden ones included: the exact set the server will rewrite. */
  const notesWithTag = async (tag: string) => {
    const paths = await readNotePaths({ notebookId: 'all', tags: [tag], showHidden: true });
    if (!paths.length) return [];
    const result = await queryClient.fetchQuery(noteLookupOptions(queryScope, paths, false));
    return result.notes;
  };
  const previewTagUsage = async (tag: string): Promise<number> => (await readNotePaths({ notebookId: 'all', tags: [tag], showHidden: true })).length;
  const applyEntries = (entries: { path: string; notebookId: string; tags: string[]; }[], message: string) =>
    applyTagEntries(repositories, entries, message, (repository, revision) => {
      if (remote && revision) setRepositoryRevision(repository.id, revision);
    });
  const runTagOperation = async (kind: TagOperationKind, plan: ReturnType<typeof planTagDelete>, label: TagOperationLabel) => {
    if (plan.affected.length === 0) throw new Error(t('sidebar.tagNoNotesAffected'));
    const entries = plan.affected.map(({ path, notebookId, nextTags }) => ({ path, notebookId, tags: nextTags }));
    try {
      await applyEntries(entries, t(label.key, label.params));
    } catch (error) {
      // Repositories committed before the failure keep their change, so their part stays undoable.
      if (error instanceof PartialTagChangeError) tagOperations.record(kind, label, { ...plan, affected: plan.affected.filter(entry => error.committed.includes(repositoryOf(repositories, entry.notebookId)?.id ?? '')) });
      throw error;
    } finally {
      if (!remote) invalidateNotes();
    }
    tagOperations.record(kind, label, plan);
  };
  const handleRenameTag = async (from: string, to: string) => {
    if (!canWrite) throw new Error(t('folder.readOnly'));
    const plan = planTagRename(await notesWithTag(from), from, to);
    await runTagOperation('rename', plan, { key: 'sidebar.tagRenamedLabel', params: { from, to, count: plan.affected.length } });
  };
  const handleMergeTag = async (from: string, into: string) => {
    if (!canWrite) throw new Error(t('folder.readOnly'));
    const plan = planTagMerge(await notesWithTag(from), from, into);
    await runTagOperation('merge', plan, { key: 'sidebar.tagMergedLabel', params: { from, to: into, count: plan.affected.length } });
  };
  const handleDeleteTag = async (tag: string) => {
    if (!canWrite) throw new Error(t('folder.readOnly'));
    const plan = planTagDelete(await notesWithTag(tag), tag);
    await runTagOperation('delete', plan, { key: 'sidebar.tagDeletedLabel', params: { tag, count: plan.affected.length } });
  };
  const handleUndoTagOperation = async (id: string) => {
    const record = tagOperations.history.find(entry => entry.id === id);
    if (!record) return;
    try {
      const inverted = invertTagOperationPlan(record.plan);
      const existing = (await queryClient.fetchQuery(noteLookupOptions(queryScope, inverted.affected.map(entry => entry.path), false))).notes;
      const validEntries = inverted.affected.filter(entry => existing.some(note => note.path === entry.path && note.notebookId === entry.notebookId));
      if (validEntries.length === 0) {
        tagOperations.dismiss(id);
        return;
      }
      const entries = validEntries.map(({ path, notebookId, nextTags }) => ({ path, notebookId, tags: nextTags }));
      try {
        await applyEntries(entries, `${t('common.undo')}: ${t(record.label.key, record.label.params)}`);
      } finally {
        if (!remote) invalidateNotes();
      }
      tagOperations.dismiss(id);
    } catch (error) {
      // Keep the record so the user can retry; a silently vanished undo with no feedback
      // would leave them unable to tell whether the undo happened.
      setActionError((error as Error).message);
    }
  };
  return { tagOperations, previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag, handleUndoTagOperation };
}
