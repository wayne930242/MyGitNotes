import { useState } from 'react';
import { type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import { isOutlinePath } from '@mygitnotes/core/outline';
import type { NoteItem } from '../lib/types.js';
import { useNoteList } from '../lib/use-note-queries.js';
import { useTranslation } from '../lib/i18n/index.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { Select } from './Select.js';
import { Button } from './Button.js';

export function AddToOutlineDialog({ source, busy, error, onChoose, onClose }: { source: NoteItem; busy: boolean; error: string; onChoose: (destination: NoteRef | null) => Promise<void>; onClose: () => void; }) {
  const { t } = useTranslation();
  const result = useNoteList({ notebookId: source.notebookId, kind: 'outline', showHidden: true });
  // Query placeholders from another notebook are not selectable destinations.
  const notes = [...result.uncommitted, ...result.notes].filter(note => note.notebookId === source.notebookId && isOutlinePath(note.path));
  const [selected, setSelected] = useState('');
  const destination = notes.find(note => noteRefKey(note) === selected);
  return (
    <WorkspaceDialog title={t('outline.add')} onClose={onClose}>
      <div className='space-y-4'>
        <div>
          <p className='text-xs font-semibold text-muted'>{t('outline.preview')}</p>
          <p>{source.title}</p>
          <p className='text-sm text-muted break-all'>{source.notebookId}{' · '}{source.path}</p>
        </div>
        <label className='block text-sm'>
          <span className='block mb-1.5'>{t('outline.destination')}</span>
          <Select aria-label={t('outline.destination')} value={selected} onValueChange={setSelected} disabled={busy || result.loading} options={[{ value: '', label: t('outline.destination') }, ...notes.map(note => ({ value: noteRefKey(note), label: `${note.title} · ${note.path}` }))]} className='w-full' />
        </label>
        {!result.loading && !notes.length && !result.error && <p className='text-sm text-muted'>{t('outline.empty')}</p>}
        {result.hasMore && <Button disabled={result.loadingMore || busy} onClick={result.loadMore}>{t('outline.loadMore')}</Button>}
        {(error || result.error) && <p role='alert' className='text-sm text-danger'>{error || result.error}</p>}
        <div className='flex flex-wrap justify-end gap-2'>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={busy} onClick={() => void onChoose(null)}>{t('outline.new')}</Button>
          <Button variant='primary' disabled={busy || result.loading || Boolean(result.error) || !destination} onClick={() => destination && void onChoose(destination)}>{t('outline.insert')}</Button>
        </div>
      </div>
    </WorkspaceDialog>
  );
}
