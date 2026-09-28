import { type NoteListItem } from '@mygitnotes/core/note-query';
import { planTagAdd, planTagDelete } from '@mygitnotes/core/tag-ops';
import { useState } from 'react';
import { applyTagEntries, PartialTagChangeError } from '../lib/tag-changes.js';
import { repositoryOf } from '../lib/workspace-repositories.js';
import { fetchFiles, type FileResult, mutateFile } from '../lib/files-api.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { useTagOperations } from '../lib/use-tag-operations.js';
import type { WorkspaceState } from './workspace-state.js';
import { baseName } from '../lib/paths.js';

interface Params {
  selectedNotes: NoteListItem[];
  clearSelection: () => void;
  onUpdateNoteStatus: (note: NoteListItem, newStatus: string) => Promise<boolean>;
  beforeFileChange: () => Promise<void>;
  onFilesChanged: (result: FileResult) => Promise<void>;
  repositories: WorkspaceState['repositories'];
  remote: boolean;
  canWrite: boolean;
  t: I18nContextValue['t'];
  invalidateNotes: () => void;
  setRepositoryRevision: WorkspaceState['setRepositoryRevision'];
  setActionError: WorkspaceState['setActionError'];
  tagOperations: ReturnType<typeof useTagOperations>;
  config: WorkspaceState['config'];
}

/** Bulk set-status, add/remove-tag, and move-to-folder for the selected browse notes. Each writes
 * through the exact same APIs a single-note edit uses (`onUpdateNoteStatus`, `/api/tags/apply`,
 * `/api/files`), just looped or batched across the selection, so both local and remote workspaces
 * work without any new endpoint. */
export function useBulkNoteActions({ selectedNotes, clearSelection, onUpdateNoteStatus, beforeFileChange, onFilesChanged, repositories, remote, canWrite, t, invalidateNotes, setRepositoryRevision, setActionError, tagOperations, config }: Params) {
  const [bulkBusy, setBulkBusy] = useState(false);

  const runBulkStatus = async (status: string) => {
    if (!canWrite || bulkBusy || selectedNotes.length === 0) return;
    setActionError('');
    setBulkBusy(true);
    try {
      for (const note of selectedNotes) {
        if (!(await onUpdateNoteStatus(note, status))) return;
      }
      clearSelection();
    } finally {
      setBulkBusy(false);
    }
  };

  const runBulkTag = async (kind: 'add' | 'remove', tag: string) => {
    if (!canWrite || bulkBusy || selectedNotes.length === 0 || !tag.trim()) return;
    setActionError('');
    setBulkBusy(true);
    try {
      const plan = kind === 'add' ? planTagAdd(selectedNotes, tag) : planTagDelete(selectedNotes, tag);
      if (plan.affected.length === 0) return;
      const entries = plan.affected.map(({ path, notebookId, nextTags }) => ({ path, notebookId, tags: nextTags }));
      const label = { key: kind === 'add' ? 'bulk.tagAddedLabel' as const : 'bulk.tagRemovedLabel' as const, params: { tag, count: plan.affected.length } };
      try {
        await applyTagEntries(repositories, entries, t(label.key, label.params), (repository, revision) => {
          if (remote && revision) setRepositoryRevision(repository.id, revision);
        });
      } catch (error) {
        // Repositories committed before the failure keep their change, so their part stays undoable.
        if (error instanceof PartialTagChangeError) tagOperations.record(kind, label, { ...plan, affected: plan.affected.filter(entry => error.committed.includes(repositoryOf(repositories, entry.notebookId)?.id ?? '')) });
        throw error;
      } finally {
        if (!remote) invalidateNotes();
      }
      tagOperations.record(kind, label, plan);
      clearSelection();
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const runBulkMove = async (notebookId: string, destinationFolder: string | null) => {
    if (!canWrite || bulkBusy || selectedNotes.length === 0) return;
    const notebook = config?.notebooks.find(nb => nb.id === notebookId);
    if (!notebook) return;
    setActionError('');
    setBulkBusy(true);
    let changed: FileResult | undefined;
    let operationError: Error | undefined;
    try {
      await beforeFileChange();
      const root = notebook.root.replace(/\/$/, '');
      const targetDir = destinationFolder ? `${root}/${destinationFolder}` : root;
      let currentRevision = (await fetchFiles(notebookId)).revision;
      for (const note of selectedNotes) {
        const destination = `${targetDir}/${baseName(note.path)}`;
        if (destination === note.path) continue;
        const result = await mutateFile({ kind: 'move', notebookId, path: note.path, destination }, currentRevision);
        currentRevision = result.revision;
        changed = changed ? { ...result, pathMap: { ...changed.pathMap, ...result.pathMap }, deletedPaths: [...changed.deletedPaths, ...result.deletedPaths] } : result;
      }
    } catch (error) {
      operationError = error as Error;
    }
    try {
      if (changed) await onFilesChanged(changed);
    } catch (error) {
      operationError = operationError ? new Error(`${operationError.message}; ${(error as Error).message}`) : error as Error;
    } finally {
      setBulkBusy(false);
    }
    if (operationError) setActionError(operationError.message);
    else clearSelection();
  };

  return { bulkBusy, runBulkStatus, runBulkTag, runBulkMove };
}
