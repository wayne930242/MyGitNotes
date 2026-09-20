import { WorkspaceDialog } from '../WorkspaceDialog.js';
import type { useGraphController } from './useGraphController.js';
export function GraphSaveDialog({ model }: { model: ReturnType<typeof useGraphController>; }) {
  const { t, saveOpen, setSaveOpen, name, setName, saveLane } = model;

  return (
    <>
      {saveOpen && (
        <WorkspaceDialog
          title={t('graph.saveLane')}
          onClose={() => setSaveOpen(false)}
        >
          <input className='ui-control' autoFocus aria-label={t('screen.rowName')} value={name} onChange={event => setName(event.target.value)} maxLength={100} />
          <div className='workspace-dialog-actions'>
            <button className='ui-button' disabled={!name.trim()} onClick={saveLane}>{t('graph.saveLane')}</button>
          </div>
        </WorkspaceDialog>
      )}
    </>
  );
}
