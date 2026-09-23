import { type NoteListItem } from '@mygitnotes/core/note-query';
import { planTagAdd, planTagDelete } from '@mygitnotes/core/tag-ops';
import { useState } from 'react';
import { applyTagChange } from '../lib/api.js';
import { fetchFiles, mutateFile } from '../lib/files-api.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { useTagOperations } from '../lib/use-tag-operations.js';
import type { WorkspaceState } from './workspace-state.js';

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

interface Params {
  selectedNotes: NoteListItem[];
  clearSelection: () => void;
  onUpdateNoteStatus: (note: NoteListItem, newStatus: string) => Promise<void>;
  revision: string;
  remote: boolean;
  canWrite: boolean;
  t: I18nContextValue['t'];
  invalidateNotes: () => void;
  setRevision: WorkspaceState['setRevision'];
  setActionError: WorkspaceState['setActionError'];
  tagOperations: ReturnType<typeof useTagOperations>;
  config: WorkspaceState['config'];
}

/** Bulk set-status, add/remove-tag, and move-to-folder for the selected browse notes. Each writes
 * through the exact same APIs a single-note edit uses (`onUpdateNoteStatus`, `/api/tags/apply`,
 * `/api/files`), just looped or batched across the selection, so both local and remote workspaces
 * work without any new endpoint. */
export function useBulkNoteActions({ selectedNotes, clearSelection, onUpdateNoteStatus, revision, remote, canWrite, t, invalidateNotes, setRevision, setActionError, tagOperations, config }: Params) {
  const [bulkBusy, setBulkBusy] = useState(false);

  const runBulkStatus = async (status: string) => {
    if (!canWrite || bulkBusy || selectedNotes.length === 0) return;
    setActionError('');
    setBulkBusy(true);
    try {
      for (const note of selectedNotes) await onUpdateNoteStatus(note, status);
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
      const label = t(kind === 'add' ? 'bulk.tagAddedLabel' : 'bulk.tagRemovedLabel', { tag, count: plan.affected.length });
      const result = await applyTagChange(entries, revision, label);
      if (remote) setRevision(result.revision || revision);
      else invalidateNotes();
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
    try {
      const root = notebook.root.replace(/\/$/, '');
      const targetDir = destinationFolder ? `${root}/${destinationFolder}` : root;
      let currentRevision = (await fetchFiles(notebookId)).revision;
      for (const note of selectedNotes) {
        const destination = `${targetDir}/${basename(note.path)}`;
        if (destination === note.path) continue;
        const result = await mutateFile({ kind: 'move', notebookId, path: note.path, destination }, currentRevision);
        currentRevision = result.revision;
      }
      invalidateNotes();
      clearSelection();
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  return { bulkBusy, runBulkStatus, runBulkTag, runBulkMove };
}
