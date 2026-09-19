import { Select } from './Select.js';
import { useTranslation } from '../lib/i18n/index.js';

function statusColor(status: string) {
  switch (status.toLowerCase()) {
    case 'done': return 'bg-success-soft text-success border-success/40';
    case 'working': case 'doing': case 'in-progress': return 'bg-info-soft text-info border-info/40';
    case 'todo': return 'bg-warning-soft text-warning border-warning/40';
    case 'inbox': return 'bg-primary-soft text-primary-hover border-primary';
    default: return 'bg-sidebar text-muted border-line';
  }
}

export function NoteStatusSelect({ status = '', statuses, readOnly, onChange, label }: { status?: string; statuses: string[]; readOnly: boolean; onChange: (status: string) => void; label: string }) {
  const { t } = useTranslation();

  return (
    <div className="relative inline-flex items-center shrink-0 min-w-0 max-w-48" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <Select
        aria-label={label}
        disabled={readOnly}
        value={status}
        onValueChange={onChange}
        options={['', ...statuses, ...(status && !statuses.includes(status) ? [status] : [])].map(value => ({ value, label: value || t('notes.noStatus') }))}
        className={`cursor-pointer disabled:cursor-default min-h-6 px-2.5 py-0.5 text-xs rounded-md border font-medium focus:outline-none focus:ring-1 focus:ring-primary ${status ? statusColor(status) : 'status-empty'}`}
        title={label}
      />
    </div>
  );
}
