import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { FolderItem, NotebookConfig } from './types.js';

export interface FilterControls {
  value: NoteFilters;
  neighbors: boolean;
  notebooks: NotebookConfig[];
  folders: FolderItem[];
  tags: string[];
  statuses: string[];
  /** Matching notes, or null while the count is still being answered. */
  count: number | null;
  onChange: (patch: Partial<NoteFilters> & { neighbors?: boolean }) => void;
  onNotebookChange: (id: string) => void;
  onClear: () => void;
}

