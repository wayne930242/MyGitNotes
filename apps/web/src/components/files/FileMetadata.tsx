import { Pencil } from 'lucide-react';
import { type FileEntry } from '../../lib/files-api.js';
import { useTranslation } from '../../lib/i18n/index.js';
export function FileMetadata({ entry, onEdit }: { entry: FileEntry; onEdit?: () => void; }) {
  const { t } = useTranslation();
  return (
    <>
      <dl className='file-metadata'>
        <dt>{t('files.location')}</dt>
        <dd>
          <code>{entry.path}</code>
        </dd>
        <dt>{t('files.type')}</dt>
        <dd>{entry.directory ? t('files.directory') : entry.name.includes('.') ? entry.name.split('.').pop()?.toUpperCase() : t('files.unknownType')}</dd>
        {!entry.directory && (
          <>
            <dt>{t('files.size')}</dt>
            <dd>{entry.size.toLocaleString()}{' bytes'}</dd>
          </>
        )}
      </dl>
      {entry.directory && onEdit && (
        <button type='button' className='ui-button file-edit-metadata' onClick={onEdit}>
          <Pencil size={15} />
          {t('files.editDirectoryMetadata')}
        </button>
      )}
    </>
  );
}
