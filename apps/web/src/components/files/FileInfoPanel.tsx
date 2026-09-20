import { X } from 'lucide-react';
import type { useFileManager } from './useFileManager.js';
import { FileMetadata } from './FileMetadata.js';
export function FileInfoPanel({ model }: { model: ReturnType<typeof useFileManager>; }) {
  const { onShowMetadata, t, busy, operation, setOperation, infoOpen, setInfoOpen, setInfoContainer, mutable, currentEntry, openOperation } = model;

  return (
    <>
      {infoOpen && !onShowMetadata && (
        <aside className='file-info-panel' aria-label={t('files.metadataLabel')}>
          <div className='file-info-heading'>
            <h2>{t('files.metadataLabel')}</h2>
            <button
              type='button'
              className='ui-icon-button'
              aria-label={t('common.close')}
              title={t('common.close')}
              disabled={busy}
              onClick={() => {
                setInfoOpen(false);
                if (operation === 'metadata') setOperation(undefined);
              }}
            >
              <X size={16} />
            </button>
          </div>
          {currentEntry && (
            <FileMetadata
              entry={currentEntry}
              onEdit={mutable && currentEntry.directory
                ? () => void openOperation('metadata')
                : undefined}
            />
          )}
          <div ref={setInfoContainer} />
        </aside>
      )}
    </>
  );
}
