import { type ReactNode, useState } from 'react';
import { FolderGit2 } from 'lucide-react';
import { FolderTree } from './FolderTree.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { Button } from './Button.js';
import { Select } from './Select.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { FolderItem, NotebookConfig } from '../lib/types.js';

/** A notebook folder: `folder` is relative to the notebook root, null for the root itself. */
export interface FolderPick {
  notebookId: string;
  folder: string | null;
  /** The root of the notebook's repository instead of a folder; offered only with `allowRepository`. */
  repository?: true;
}

interface FolderPickerDialogProps {
  title: string;
  /** The notebooks the user may pick from; with one, no notebook selector is shown. */
  notebooks: NotebookConfig[];
  folders: FolderItem[];
  initial: FolderPick;
  confirmLabel: string;
  confirmVariant?: 'primary' | 'danger';
  busy: boolean;
  /** Offers the root of the notebook's repository, the whole project, above the notebook's folders. */
  allowRepository?: boolean;
  /** Shown between the tree and the actions, such as a warning or an option that goes with the pick. */
  children?: ReactNode;
  onClose: () => void;
  onConfirm: (pick: FolderPick) => void;
}

/**
 * Picks one notebook folder: the destination of moved notes (useNoteMove, useBulkNoteActions.runBulkMove)
 * or the folder the Pi agent runs in. Read-only FolderTree: this dialog only chooses, it never manages folders.
 */
export function FolderPickerDialog({ title, notebooks, folders, initial, confirmLabel, confirmVariant = 'primary', busy, allowRepository = false, children, onClose, onConfirm }: FolderPickerDialogProps) {
  const { t } = useTranslation();
  const [pick, setPick] = useState<FolderPick>(initial);

  return (
    <WorkspaceDialog title={title} onClose={onClose}>
      {notebooks.length > 1 && (
        <label className='folder-picker-notebook'>
          <span>{t('folderPicker.notebook')}</span>
          <Select aria-label={t('folderPicker.notebook')} value={pick.notebookId} disabled={busy} onValueChange={notebookId => setPick(current => current.repository ? { notebookId, folder: null, repository: true } : { notebookId, folder: null })} options={notebooks.map(notebook => ({ value: notebook.id, label: notebook.title }))} />
        </label>
      )}
      {allowRepository && (
        <button type='button' className='folder-picker-repository' aria-pressed={pick.repository === true} disabled={busy} onClick={() => setPick(current => ({ notebookId: current.notebookId, folder: null, repository: true }))}>
          <FolderGit2 aria-hidden='true' />
          <span>{t('folderPicker.repository')}</span>
        </button>
      )}
      <FolderTree showRoot folders={folders} notebookId={pick.notebookId} selected={pick.folder} {...pick.repository ? { selectedPaths: [], allFoldersSelected: false } : {}} onSelect={folder => setPick(current => ({ notebookId: current.notebookId, folder }))} writable={false} onManageFiles={() => {}} onChanged={async () => {}} />
      {children}
      <div className='workspace-dialog-actions'>
        <Button type='button' onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button type='button' variant={confirmVariant} disabled={busy} onClick={() => onConfirm(pick)}>{confirmLabel}</Button>
      </div>
    </WorkspaceDialog>
  );
}
