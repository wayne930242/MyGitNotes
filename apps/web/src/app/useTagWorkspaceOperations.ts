import type { QueryClient } from '@tanstack/react-query';
import { invertTagOperationPlan, planTagDelete, planTagMerge, planTagRename } from '@mygitnotes/core/tag-ops';
import { type TagOperationKind, useTagOperations } from '../lib/use-tag-operations.js';
import { applyTagChange } from '../lib/api.js';
import { noteLookupOptions, notePathsOptions, type NoteQueryScope } from '../lib/use-note-queries.js';
import type { I18nContextValue } from '../lib/i18n/index.js';

interface UseTagWorkspaceOperationsParams {
  queryClient: QueryClient;
  queryScope: NoteQueryScope;
  revision: string;
  remote: boolean;
  canWrite: boolean;
  t: I18nContextValue['t'];
  invalidateNotes: () => void;
  setRevision: (revision: string) => void;
  setActionError: (message: string) => void;
}

/** Tag management: rename/merge/delete across the whole workspace, each a single commit
 * with a session-lifetime undo (kept in `tagOperations.history` until page reload). */
export function useTagWorkspaceOperations({ queryClient, queryScope, revision, remote, canWrite, t, invalidateNotes, setRevision, setActionError }: UseTagWorkspaceOperationsParams) {
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
  const runTagOperation = async (kind: TagOperationKind, plan: ReturnType<typeof planTagDelete>, label: string) => {
    if (plan.affected.length === 0) throw new Error(t('sidebar.tagNoNotesAffected'));
    const entries = plan.affected.map(({ path, notebookId, nextTags }) => ({ path, notebookId, tags: nextTags }));
    const result = await applyTagChange(entries, revision, label);
    if (remote) setRevision(result.revision || revision);
    else invalidateNotes();
    tagOperations.record(kind, label, plan);
  };
  const handleRenameTag = async (from: string, to: string) => {
    if (!canWrite) throw new Error(t('folder.readOnly'));
    const plan = planTagRename(await notesWithTag(from), from, to);
    await runTagOperation('rename', plan, t('sidebar.tagRenamedLabel', { from, to, count: plan.affected.length }));
  };
  const handleMergeTag = async (from: string, into: string) => {
    if (!canWrite) throw new Error(t('folder.readOnly'));
    const plan = planTagMerge(await notesWithTag(from), from, into);
    await runTagOperation('merge', plan, t('sidebar.tagMergedLabel', { from, to: into, count: plan.affected.length }));
  };
  const handleDeleteTag = async (tag: string) => {
    if (!canWrite) throw new Error(t('folder.readOnly'));
    const plan = planTagDelete(await notesWithTag(tag), tag);
    await runTagOperation('delete', plan, t('sidebar.tagDeletedLabel', { tag, count: plan.affected.length }));
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
      const result = await applyTagChange(entries, revision, `${t('common.undo')}: ${record.label}`);
      if (remote) setRevision(result.revision || revision);
      else invalidateNotes();
      tagOperations.dismiss(id);
    } catch (error) {
      // Keep the record so the user can retry; a silently vanished undo with no feedback
      // would leave them unable to tell whether the undo happened.
      setActionError((error as Error).message);
    }
  };
  return { tagOperations, previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag, handleUndoTagOperation };
}
