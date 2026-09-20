import type { NotebookConfig } from '../../lib/types.js';
import { type FileEntry, type FileResult } from '../../lib/files-api.js';
export interface FileManagerHandle {
  prepareLeave: () => Promise<boolean>;
  editMetadata: () => Promise<void>;
}
export interface FileManagerProps {
  notebookId: string;
  writable: boolean;
  initialPath?: string;
  movePath?: string;
  mode?: 'manage' | 'pick-image';
  layout?: 'page' | 'panel' | 'dialog';
  beforeChange?: () => Promise<void>;
  onChanged?: (result: FileResult) => Promise<void>;
  onOpenIndex?: (path: string, notebookId: string) => Promise<void>;
  onInsert?: (reference: string) => void;
  metadataContainer?: HTMLElement | null;
  onSelectionChange?: (entry: FileEntry | undefined) => void;
  onBusyChange?: (busy: boolean) => void;
  /** Notebooks shown as tree roots; `onNotebookChange` makes the other notebooks switchable. */
  notebooks?: Pick<NotebookConfig, 'id' | 'title'>[];
  onNotebookChange?: (notebookId: string) => void;
  /** Opens the workspace right panel that hosts `metadataContainer`; without it the manager shows its own info panel. */
  onShowMetadata?: () => void;
}
