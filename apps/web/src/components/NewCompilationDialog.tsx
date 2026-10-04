import type { CompilationRow } from '@mygitnotes/core/compilation';
import type { FolderItem, NotebookConfig } from '../lib/types.js';
import { CompilationAddRow } from './CompilationDialogs.js';
import { useCompilationAssets } from './useCompilationItemOpen.js';

/** The dialog that starts a compilation: its name, kind of source and arrangement. */
export function NewCompilationDialog({ notebooks, folders, notebookId, onAdd, onClose }: { notebooks: NotebookConfig[]; folders: FolderItem[]; notebookId: string; onAdd: (row: CompilationRow) => void; onClose: () => void; }) {
  const { assets } = useCompilationAssets(notebooks, notebookId);
  return <CompilationAddRow notebooks={notebooks} assets={assets} folders={folders} selectedNotebookId={notebookId} onAdd={onAdd} onClose={onClose} />;
}
