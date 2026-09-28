import { FileText, Plus } from 'lucide-react';
import { Button } from './Button.js';
import { useTranslation } from '../lib/i18n/index.js';
/** Shown by a browse view when the current filter matches no notes or folders. */
export function NotesEmptyState({ readOnly, onNewNote }: { readOnly: boolean; onNewNote: () => void; }) {
  const { t } = useTranslation();
  return (
    <div className='flex flex-col items-center justify-center h-96 text-center px-4'>
      <div className='w-12 h-12 rounded-full bg-sidebar flex items-center justify-center text-muted mb-3'>
        <FileText className='w-6 h-6' />
      </div>
      <h3 className='text-base font-medium text-fg mb-1'>{t('notes.emptyTitle')}</h3>
      <p className='text-sm text-muted max-w-sm mb-4'>{t('notes.emptyDescription')}</p>
      {!readOnly && (
        <Button variant='primary' onClick={onNewNote}>
          <Plus className='w-4 h-4' />
          {t('notes.createNote')}
        </Button>
      )}
    </div>
  );
}
