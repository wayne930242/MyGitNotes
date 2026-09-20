import { useRef, useState } from 'react';
import { useTranslation } from '../../lib/i18n/index.js';
import { WorkspaceDialog } from '../WorkspaceDialog.js';
import { FileManager } from './FileManagerView.js';
import type { FileManagerHandle, FileManagerProps } from './types.js';
export function FileManagerDialog({ onClose, notebookId: openedNotebookId, initialPath, ...props }: FileManagerProps & { onClose: () => void; }) {
  const { t } = useTranslation(), manager = useRef<FileManagerHandle>(null);
  const [notebookId, setNotebookId] = useState(openedNotebookId);
  return (
    <WorkspaceDialog
      title={t(props.mode === 'pick-image' ? 'files.chooseImage' : 'files.titleLabel')}
      className='file-manager-dialog'
      onClose={() =>
        void manager.current?.prepareLeave().then(ok => {
          if (ok) onClose();
        })}
    >
      <FileManager key={notebookId} ref={manager} layout={props.layout || 'dialog'} {...props} notebookId={notebookId} initialPath={notebookId === openedNotebookId ? initialPath : undefined} onNotebookChange={setNotebookId} />
    </WorkspaceDialog>
  );
}
