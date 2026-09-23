import React, { useState } from 'react';
import { FolderInput, X } from 'lucide-react';
import { Button } from './Button.js';
import { Select } from './Select.js';
import { useTranslation } from '../lib/i18n/index.js';

interface BulkActionsToolbarProps {
  count: number;
  statuses: string[];
  availableTags: string[];
  busy: boolean;
  readOnly: boolean;
  /** False when the selection spans more than one notebook: there is no single folder tree to move into. */
  canMove: boolean;
  onSetStatus: (status: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onMove: () => void;
  onClear: () => void;
}

/** Shown only while at least one note is selected in a browse view; never rendered otherwise,
 * so it adds no chrome when the selection is empty. Selecting itself happens on the rows/cards
 * (modifier-click or, once active, their checkbox), matching FolderTree's and the graph's
 * multi-select convention. */
export const BulkActionsToolbar: React.FC<BulkActionsToolbarProps> = ({ count, statuses, availableTags, busy, readOnly, canMove, onSetStatus, onAddTag, onRemoveTag, onMove, onClear }) => {
  const { t } = useTranslation();
  const [tagInput, setTagInput] = useState('');

  const submitTag = (action: (tag: string) => void) => {
    const tag = tagInput.trim();
    if (!tag) return;
    action(tag);
    setTagInput('');
  };

  return (
    <div role='toolbar' aria-label={t('bulk.toolbarLabel')} className='bulk-actions-toolbar mb-3 rounded-xl border shadow-xs flex flex-wrap items-center gap-2 px-3 py-2 text-xs' style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <span className='font-semibold text-fg shrink-0'>{t('bulk.selectedCount', { count })}</span>
      {!readOnly && (
        <>
          <Select aria-label={t('bulk.setStatus')} value='' disabled={busy} onValueChange={onSetStatus} options={[{ value: '', label: t('bulk.setStatus') }, ...statuses.map(status => ({ value: status, label: status }))]} className='w-full sm:w-40 min-h-7 px-2 py-1 text-xs' />
          <div className='flex w-full flex-wrap items-center gap-1 sm:w-auto'>
            <input
              type='text'
              value={tagInput}
              disabled={busy}
              onChange={event => setTagInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault();
                  submitTag(onAddTag);
                }
              }}
              placeholder={t('bulk.tagPlaceholder')}
              aria-label={t('bulk.tagPlaceholder')}
              list='bulk-tag-suggestions'
              className='ui-control min-h-7 px-2 py-1 text-xs w-full sm:w-32'
            />
            <datalist id='bulk-tag-suggestions'>{availableTags.map(tag => <option key={tag} value={tag} />)}</datalist>
            <Button type='button' size='small' disabled={busy || !tagInput.trim()} onClick={() => submitTag(onAddTag)}>{t('bulk.addTag')}</Button>
            <Button type='button' size='small' disabled={busy || !tagInput.trim()} onClick={() => submitTag(onRemoveTag)}>{t('bulk.removeTag')}</Button>
          </div>
          <Button type='button' size='small' disabled={busy || !canMove} title={canMove ? undefined : t('bulk.moveRequiresSingleNotebook')} onClick={onMove}>
            <FolderInput className='w-3.5 h-3.5' />
            {t('bulk.moveToFolder')}
          </Button>
        </>
      )}
      <button type='button' onClick={onClear} disabled={busy} className='ml-auto text-muted hover:text-fg p-1 rounded hover:bg-fg/10 transition shrink-0' aria-label={t('bulk.clearSelection')} title={t('bulk.clearSelection')}>
        <X className='w-3.5 h-3.5' />
      </button>
    </div>
  );
};
