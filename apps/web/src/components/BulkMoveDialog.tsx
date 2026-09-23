import React, { useState } from 'react';
import { FolderTree } from './FolderTree.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { Button } from './Button.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { FolderItem, NotebookConfig } from '../lib/types.js';

interface BulkMoveDialogProps {
  notebook: NotebookConfig;
  folders: FolderItem[];
  count: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (destinationFolder: string | null) => void;
}

/** Picks one destination folder, applied to every selected note (see useBulkNoteActions.runBulkMove,
 * which loops the same `/api/files` move a single-note move uses). Read-only FolderTree: this dialog
 * only chooses a target, it never manages folders. */
export const BulkMoveDialog: React.FC<BulkMoveDialogProps> = ({ notebook, folders, count, busy, onClose, onConfirm }) => {
  const { t } = useTranslation();
  const [destination, setDestination] = useState<string | null>(null);

  return (
    <WorkspaceDialog title={t('bulk.moveDialogTitle', { count })} onClose={onClose}>
      <FolderTree
        showRoot
        folders={folders}
        notebookId={notebook.id}
        selected={destination}
        onSelect={setDestination}
        writable={false}
        onManageFiles={() => {}}
        onChanged={async () => {}}
      />
      <div className='workspace-dialog-actions'>
        <Button type='button' onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button type='button' variant='primary' disabled={busy} onClick={() => onConfirm(destination)}>{t('bulk.moveConfirm')}</Button>
      </div>
    </WorkspaceDialog>
  );
};
