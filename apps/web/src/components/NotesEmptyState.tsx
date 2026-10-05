import { FileText, GalleryHorizontalEnd, ListTree, Plus } from 'lucide-react';
import { Button } from './Button.js';
import { useTranslation } from '../lib/i18n/index.js';
/** What a browse view lists, and so what its empty state offers to create. */
export type BrowseKind = 'note' | 'outline' | 'compilation';

const CREATE = { note: { label: 'notes.createNote', Icon: Plus }, outline: { label: 'outline.create', Icon: ListTree }, compilation: { label: 'compilation.create', Icon: GalleryHorizontalEnd } } as const;

/** Shown by a browse view when the current filter matches no notes or folders. */
export function NotesEmptyState({ readOnly, kind = 'note', onNewNote }: { readOnly: boolean; kind?: BrowseKind; onNewNote: () => void; }) {
  const { t } = useTranslation();
  const { label, Icon } = CREATE[kind];
  return (
    <div className='flex flex-col items-center justify-center h-96 text-center px-4'>
      <div className='w-12 h-12 rounded-full bg-sidebar flex items-center justify-center text-muted mb-3'>
        <FileText className='w-6 h-6' />
      </div>
      <h3 className='text-base font-medium text-fg mb-1'>{t('notes.emptyTitle')}</h3>
      <p className='text-sm text-muted max-w-sm mb-4'>{t('notes.emptyDescription')}</p>
      {!readOnly && (
        <Button variant='primary' onClick={onNewNote}>
          <Icon className='w-4 h-4' />
          {t(label)}
        </Button>
      )}
    </div>
  );
}
