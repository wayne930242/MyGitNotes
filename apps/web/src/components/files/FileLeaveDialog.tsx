import { Button } from '../Button.js';
import { WorkspaceDialog } from '../WorkspaceDialog.js';
import type { useFileManager } from './useFileManager.js';
export function FileLeaveDialog({ model }: { model: ReturnType<typeof useFileManager>; }) {
  const { t, detail, setContent, busy, confirmLeave, save, finishLeave } = model;

  return (
    <>
      {confirmLeave && (
        <WorkspaceDialog
          title={t('files.unsaved')}
          onClose={() => finishLeave(false)}
        >
          <p>{t('files.leaveHint')}</p>
          <div className='workspace-dialog-actions'>
            <button type='button' className='ui-button' disabled={busy} onClick={() => finishLeave(false)}>{t('files.keepEditing')}</button>
            <button
              type='button'
              className='ui-button'
              disabled={busy}
              onClick={() => {
                setContent(detail?.content || '');
                finishLeave(true);
              }}
            >
              {t('files.discard')}
            </button>
            <Button
              type='button'
              variant='primary'
              disabled={busy}
              onClick={() =>
                void save().then(ok => {
                  if (ok) finishLeave(true);
                })}
            >
              {t('common.save')}
            </Button>
          </div>
        </WorkspaceDialog>
      )}
    </>
  );
}
