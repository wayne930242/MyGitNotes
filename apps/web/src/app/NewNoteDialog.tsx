import { FileText } from 'lucide-react';
import type { NoteTemplate } from '@mygitnotes/core';
import { Select } from '../components/Select.js';
import { Button } from '../components/Button.js';
import type { I18nContextValue } from '../lib/i18n/index.js';

interface NewNoteDialogProps {
  t: I18nContextValue['t'];
  createError: string;
  kind?: 'note' | 'outline';
  creating?: boolean;
  newNoteTitle: string;
  onTitleChange: (value: string) => void;
  onSubmit: () => void;
  newNoteTemplates: NoteTemplate[];
  newNoteTemplateId: string;
  onTemplateChange: (templateId: string) => void;
  newNoteTags: string[];
  newNoteStatus: string;
  onStatusChange: (value: string) => void;
  newNoteStatuses: string[];
  onCancel: () => void;
}

/** The Create New Note modal: title, template and status pickers backed by `useNewNoteDialog`. A new note starts at the
 * notebook root, or in the folder its compilation lane draws from; its editor's Move action files it elsewhere. */
export function NewNoteDialog({ t, createError, kind = 'note', creating = false, newNoteTitle, onTitleChange, onSubmit, newNoteTemplates, newNoteTemplateId, onTemplateChange, newNoteTags, newNoteStatus, onStatusChange, newNoteStatuses, onCancel }: NewNoteDialogProps) {
  return (
    <div className='viewport-overlay fixed inset-0 z-50 bg-scrim/60 backdrop-blur-sm flex items-center justify-center p-4'>
      <div className='rounded-2xl shadow-2xl border w-full max-w-md max-h-full overflow-y-auto p-4 md:p-6' style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h3 className='font-semibold text-fg text-base mb-4 flex items-center gap-2'>
          <FileText className='w-5 h-5' style={{ color: 'var(--color-primary)' }} />
          {t(kind === 'outline' ? 'outline.create' : 'createNote.title')}
        </h3>
        {createError && <p id='create-note-error' role='alert' className='mb-3 text-sm text-danger'>{createError}</p>}
        <div className='space-y-4'>
          <div>
            <label className='block text-xs font-semibold text-fg uppercase tracking-wider mb-1.5'>{t('createNote.noteTitle')}</label>
            <input
              type='text'
              placeholder={t('createNote.placeholder')}
              aria-describedby='create-note-error'
              value={newNoteTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              className='w-full px-3 py-2 bg-fg/5 border border-line rounded-lg text-sm text-fg focus:outline-none'
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSubmit();
              }}
            />
          </div>
          {kind === 'note' && newNoteTemplates.length > 0 && (
            <div>
              <label className='block text-xs font-semibold text-fg uppercase tracking-wider mb-1.5'>{t('createNote.template')}</label>
              <Select aria-label={t('createNote.template')} value={newNoteTemplateId} onValueChange={onTemplateChange} options={[{ value: '', label: t('createNote.noTemplate') }, ...newNoteTemplates.map(tpl => ({ value: tpl.id, label: tpl.title }))]} className='w-full' />
            </div>
          )}
          {newNoteTags.length > 0 && (
            <div>
              <label className='block text-xs font-semibold text-fg uppercase tracking-wider mb-1.5'>{t('notes.tags')}</label>
              <div className='flex flex-wrap gap-1.5 py-1'>{newNoteTags.map(tag => <span key={tag} className='inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20'>#{tag}</span>)}</div>
            </div>
          )}
          <div>
            <label className='block text-xs font-semibold text-fg uppercase tracking-wider mb-1.5'>{t('createNote.initialStatus')}</label>
            <Select aria-label={t('createNote.initialStatus')} value={newNoteStatus} onValueChange={onStatusChange} options={newNoteStatuses.map(value => ({ value, label: value }))} className='w-full' />
          </div>
        </div>
        <div className='flex items-center justify-end gap-2 mt-6 pt-4 border-t border-line'>
          <button onClick={onCancel} className='px-4 py-2 text-xs font-medium text-muted hover:bg-fg/5 rounded-lg transition active:scale-95'>{t('common.cancel')}</button>
          <Button variant='primary' onClick={onSubmit} disabled={creating || !newNoteTitle.trim()}>{t('createNote.submit')}</Button>
        </div>
      </div>
    </div>
  );
}
