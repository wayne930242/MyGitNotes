import { BookOpen, CornerLeftUp, File, Folder, Pencil } from 'lucide-react';
import type { useFileManager } from './useFileManager.js';
const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'));
export function FileListing({ model }: { model: ReturnType<typeof useFileManager>; }) {
  const { t, listing: maybeListing, directory, selected, busy, mutable, current, navigate, notebookTitle } = model;
  const listing = maybeListing!;

  return (
    <>
      <div className='file-list' aria-label={t('files.list')}>
        {directory !== listing.root && (
          <div className='file-row file-navigation-row'>
            <button
              type='button'
              className='file-row-name'
              aria-label={t('files.root')}
              title={t('files.root')}
              disabled={busy}
              onClick={() => void navigate(listing.root)}
            >
              <BookOpen size={18} />
              <span>{notebookTitle}</span>
            </button>
          </div>
        )}
        {directory !== listing.root && (
          <div className='file-row file-navigation-row'>
            <button type='button' className='file-row-name' aria-label={t('files.up')} title={t('files.up')} disabled={busy} onClick={() => void navigate(parentOf(directory))}>
              <CornerLeftUp size={18} />
              <span>..</span>
            </button>
          </div>
        )}
        {current.map(entry => (
          <div key={entry.path} className={`file-row ${selected === entry.path ? 'is-selected' : ''}`}>
            <button type='button' disabled={busy} className='file-row-name' title={entry.path} aria-label={`${entry.directory ? t('files.openFolder') : t('files.select')}: ${entry.name}`} onClick={() => void navigate(entry.path, !entry.directory)}>
              {entry.directory ? <Folder size={18} /> : <File size={18} />}
              <span>{entry.name}</span>
              <small>{entry.directory ? t('files.directory') : `${(entry.size / 1024).toFixed(1)} KB`}</small>
            </button>
            {entry.directory && mutable && (
              <button type='button' className='ui-icon-button' disabled={busy} aria-label={`${t('files.metadata')}: ${entry.name}`} title={t('files.metadata')} onClick={() => void navigate(entry.path, true)}>
                <Pencil size={15} />
              </button>
            )}
          </div>
        ))}
        {!current.length && <p className='file-empty'>{t('files.empty')}</p>}
      </div>
    </>
  );
}
