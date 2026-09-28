import { Maximize2 } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
export function NoteZoomButton({ onClick, iconClassName = 'w-3.5 h-3.5' }: { onClick: () => void; iconClassName?: string; }) {
  const { t } = useTranslation();
  return (
    <button type='button' onClick={onClick} title={t('focus.zoomNote')} aria-label={t('focus.zoomNote')} className='ui-icon-button'>
      <Maximize2 className={iconClassName} />
    </button>
  );
}
