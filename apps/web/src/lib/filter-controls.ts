import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { FolderItem, NotebookConfig } from './types.js';

export interface FilterControls {
  /** `value.notebookId` is the query scope: `'all'` while `allNotebooks` is on. */
  value: NoteFilters;
  neighbors: boolean;
  notebooks: NotebookConfig[];
  folders: FolderItem[];
  tags: string[];
  statuses: string[];
  /** Matching notes, or null while the count is still being answered. */
  count: number | null;
  onChange: (patch: Partial<NoteFilters> & { neighbors?: boolean; }) => void;
  allNotebooks: boolean;
  onAllNotebooksChange: (value: boolean) => void;
  onClear: () => void;
}
