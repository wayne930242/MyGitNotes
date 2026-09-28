import { useTranslation } from '../lib/i18n/index.js';
/** Bulk-selection checkbox on a browse item; its click stays off the item's own open handler. */
export function NoteSelectBox({ title, checked, onToggle, className = '' }: { title: string; checked: boolean; onToggle: () => void; className?: string; }) {
  const { t } = useTranslation();
  return <input type='checkbox' checked={checked} onChange={onToggle} onClick={event => event.stopPropagation()} aria-label={t('notes.selectFor', { title })} className={`w-4 h-4 shrink-0 accent-primary${className ? ` ${className}` : ''}`} />;
}
