import { File, Folder } from 'lucide-react';
import type { useFileManager } from './useFileManager.js';

export function FileListing({ model }: { model: ReturnType<typeof useFileManager>; }) {
  const { t, selected, busy, current, navigate, selectEntry } = model;
  return (
    <div className='file-list' aria-label={t('files.list')}>
      <div className='file-list-columns' aria-hidden='true'>
        <span>{t('files.name')}</span>
        <span>{t('files.type')}</span>
        <span>{t('files.size')}</span>
      </div>
      {current.map(entry => (
        <div key={entry.path} className={`file-row ${selected === entry.path ? 'is-selected' : ''}`}>
          <button
            type='button'
            disabled={busy}
            className='file-row-name'
            title={entry.path}
            aria-label={`${t('files.select')}: ${entry.name}`}
            aria-pressed={selected === entry.path}
            onClick={() => void selectEntry(entry.path)}
            onDoubleClick={() => void navigate(entry.path, !entry.directory)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void navigate(entry.path, !entry.directory);
              }
            }}
          >
            <span className='file-entry-name'>
              {entry.directory ? <Folder size={18} /> : <File size={18} />}
              <span>{entry.name}</span>
            </span>
            <small>{entry.directory ? t('files.directory') : entry.name.split('.').length > 1 ? entry.name.split('.').at(-1)?.toUpperCase() : t('files.unknownType')}</small>
            <small>{entry.directory ? '—' : `${(entry.size / 1024).toFixed(1)} KB`}</small>
          </button>
        </div>
      ))}
      {!current.length && <p className='file-empty'>{t('files.empty')}</p>}
    </div>
  );
}
