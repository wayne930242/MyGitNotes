import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { FolderItem, NotebookConfig } from './types.js';

export interface FilterControls {
  value: NoteFilters;
  neighbors: boolean;
  notebooks: NotebookConfig[];
  folders: FolderItem[];
  tags: string[];
  statuses: string[];
  count: number;
  onChange: (patch: Partial<NoteFilters> & { neighbors?: boolean }) => void;
  onNotebookChange: (id: string) => void;
  onClear: () => void;
}

