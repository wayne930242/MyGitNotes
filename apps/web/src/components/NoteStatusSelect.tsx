import { Select } from './Select.js';
import { useTranslation } from '../lib/i18n/index.js';

function statusColor(status: string) {
  switch (status.toLowerCase()) {
    case 'done': return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case 'working': case 'doing': case 'in-progress': return 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800';
    case 'todo': return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    case 'inbox': return 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800';
    default: return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700';
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
        className={`cursor-pointer disabled:cursor-default min-h-6 px-2.5 py-0.5 text-xs rounded-md border font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 ${statusColor(status)}`}
        title={label}
      />
    </div>
  );
}
