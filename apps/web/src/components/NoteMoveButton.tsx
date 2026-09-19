import { FolderInput } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
export function NoteMoveButton({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean; }) {
  const { t } = useTranslation();
  return (
    <button
      type='button'
      className='ui-icon-button'
      title={t('files.moveNote')}
      aria-label={t('files.moveNote')}
      disabled={disabled}
      onClick={event => {
        event.stopPropagation();
        onClick();
      }}
    >
      <FolderInput size={16} />
    </button>
  );
}
