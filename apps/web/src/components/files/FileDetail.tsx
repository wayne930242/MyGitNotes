import { lazy, Suspense } from 'react';
import { Button } from '../Button.js';
import { Code2, Download, Eye, FolderInput, Pencil, Trash2, X } from 'lucide-react';
import { Preview } from '../FilePreview.js';
import type { useFileManager } from './useFileManager.js';
import { FileMetadata } from './FileMetadata.js';
import { LoadingStatus } from '../LoadingStatus.js';
const FileSourceEditor = lazy(() => import('../FileSourceEditor.js').then(module => ({ default: module.FileSourceEditor })));
export function FileDetail({ model }: { model: ReturnType<typeof useFileManager>; }) {
  const { notebookId, mode, onOpenIndex, onInsert, t, listing, directory, selected, detail, detailOpen, toggleDetails, openSelected, content, setContent, sourceView, setSourceView, busy, reading, mutable, dirty, selectedEntry, run, save, navigate, openOperation, rawUrl } = model;
  if (!selectedEntry) return null;
  return (
    <section className='file-detail' aria-label={t('files.details')}>
      <div className='file-detail-heading'>
        <div className='file-detail-title'>
          <strong>{selectedEntry.name}</strong>
          <button type='button' className='ui-icon-button' aria-label={t('files.close')} title={t('files.close')} disabled={busy} onClick={() => void navigate(directory)}>
            <X size={18} />
          </button>
        </div>
      </div>
      <div className='file-actions'>
        <button type='button' className='ui-button' disabled={busy} onClick={() => void openSelected()}>{t('files.open')}</button>
        {mutable && (
          <>
            <button type='button' className='ui-button' disabled={busy} onClick={() => void openOperation('rename')}>
              <Pencil size={15} />
              {t('files.rename')}
            </button>
            <button type='button' className='ui-button' disabled={busy} onClick={() => void openOperation('move')}>
              <FolderInput size={15} />
              {t('files.move')}
            </button>
            <button type='button' className='ui-button ui-button-danger' disabled={busy} onClick={() => void openOperation(selectedEntry.directory ? 'remove-directory' : 'delete')}>
              <Trash2 size={15} />
              {t('common.delete')}
            </button>
            {selectedEntry.directory && <button type='button' className='ui-button' disabled={busy || reading} onClick={() => void openOperation('metadata')}>{t('files.metadata')}</button>}
            {selectedEntry.directory && onOpenIndex && (
              <button
                type='button'
                className='ui-button'
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    if (await model.prepareLeave()) await run(() => onOpenIndex(selected, notebookId));
                  })()}
              >
                {t('files.index')}
              </button>
            )}
          </>
        )}
        {!selectedEntry.directory && (
          <a className='ui-icon-button' href={rawUrl + '&download=1'} download aria-label={t('files.download')} title={t('files.download')}>
            <Download size={18} />
          </a>
        )}
        {mode === 'pick-image' && onInsert && selectedEntry.presentation === 'image' && <Button type='button' variant='primary' disabled={busy || reading || !detail?.hash} onClick={() => detail?.hash && onInsert(`![${selectedEntry.name.replace(/[\\[\]]/g, '\\$&')}](/raw-assets/by-hash/${detail.hash})`)}>{t('files.insert')}</Button>}
      </div>
      <button type='button' className='ui-button file-details-toggle' aria-expanded={detailOpen} disabled={busy} onClick={() => void toggleDetails()}>{t('files.details')}</button>
      <div hidden={!detailOpen}>
        <FileMetadata entry={selectedEntry} />
        {reading && <LoadingStatus>{t('files.loading')}</LoadingStatus>}
        {!selectedEntry.directory && detail && (
          <>
            {selectedEntry.presentation !== 'file' && typeof detail.content === 'string' && (
              <button
                type='button'
                className='ui-button'
                onClick={() => setSourceView(!sourceView)}
              >
                {sourceView ? <Eye size={15} /> : <Code2 size={15} />}
                {sourceView ? t('files.preview') : t('files.source')}
              </button>
            )}
            {typeof detail.content === 'string' && (selectedEntry.presentation === 'file' || sourceView)
              ? (
                <>
                  <div className='file-save-bar'>
                    <span role='status'>{dirty ? t('files.unsaved') : t('files.saved')}</span>
                    {mutable && (
                      <Button
                        type='button'
                        variant='primary'
                        disabled={busy || !dirty}
                        onClick={() => void save()}
                      >
                        {t('common.save')}
                      </Button>
                    )}
                  </div>
                  <Suspense fallback={<LoadingStatus>{t('files.loading')}</LoadingStatus>}>
                    <FileSourceEditor key={detail.path} path={detail.path} content={content} readOnly={!mutable || busy} label={t('files.sourceContent')} onChange={setContent} />
                  </Suspense>
                </>
              )
              : <Preview key={selected + listing?.revision} entry={selectedEntry} url={rawUrl} />}
          </>
        )}
      </div>
    </section>
  );
}
