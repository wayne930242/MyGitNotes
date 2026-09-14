import { GripVertical } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';

export function ReorderToggle({ active, onToggle, disabled = false }: { active: boolean; onToggle: () => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return <button type="button" className="ui-icon-button reorder-toggle" title={t('reorder.toggle')} aria-label={t('reorder.toggle')} aria-pressed={active} disabled={disabled} onClick={onToggle}>
    <GripVertical size={18} aria-hidden="true" />
  </button>;
}
