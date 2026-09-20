import { NoteMoveButton } from './NoteMoveButton.js';
import { Button } from './Button.js';
import React from 'react';
import { Clock, FileText, Maximize2, Plus, Trash2 } from 'lucide-react';
import { NoteTagActions, NoteTags } from './NoteTags.js';
import { NoteStatusSelect } from './NoteStatusSelect.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { useTranslation } from '../lib/i18n/index.js';
import { noteUpdatedTime } from '../lib/note-sort.js';
import { useDeleteConfirm } from '../lib/use-delete-confirm.js';
import { NOTE_DRAG_TYPE, type NoteBrowseFocusMode } from '../lib/note-drag.js';

interface CardViewProps {
  notes: NoteListItem[];
  /** Staged drafts the server cannot return yet; shown above the committed cards. */
  uncommitted?: NoteListItem[];
  hasFolderEntries?: boolean;
  /** The first page is still in flight, so nothing is known to be missing yet. */
  loading?: boolean;
  statuses: string[];
  readOnly?: boolean;
  canDelete?: boolean;
  confirmDelete?: boolean;
  onOpenNote: (note: NoteListItem) => void;
  onDeleteNote: (note: NoteListItem) => void;
  onMoveNote?: (note: NoteListItem) => void;
  onNewNote: () => void;
  onUpdateNoteStatus: (note: NoteListItem, status: string) => void;
  tagActions?: NoteTagActions;
  /** Present while a Focus is displayed: cards get a zoom button and can be dragged into a pane. */
  focusMode?: NoteBrowseFocusMode;
  /** Single horizontally scrolling row, for a docked top panel too short for the grid. */
  strip?: boolean;
}

export const CardView: React.FC<CardViewProps> = ({ notes, uncommitted = [], hasFolderEntries = false, loading = false, statuses, readOnly = false, canDelete = true, confirmDelete = false, onOpenNote, onDeleteNote, onMoveNote, onNewNote, onUpdateNoteStatus, tagActions, focusMode, strip = false }) => {
  const { t } = useTranslation();
  const { pendingDeletePath, requestDelete } = useDeleteConfirm(confirmDelete, path => {
    const note = [...uncommitted, ...notes].find(n => n.path === path);
    if (note) onDeleteNote(note);
  });

  const isEmpty = !loading && notes.length === 0 && uncommitted.length === 0 && !hasFolderEntries;

  if (isEmpty) {
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

  const getExcerpt = (content: string) => {
    const clean = content.replace(/^#+\s+.+$/gm, '').replace(/[*_`]/g, '').replace(/!\[.*?\]\(.*?\)/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').trim();
    return clean.slice(0, 140) + (clean.length > 140 ? '...' : '');
  };

  const renderCard = (note: NoteListItem) => {
    const updated = noteUpdatedTime(note);
    const formattedDate = updated ? new Date(updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
    const canDrag = !!focusMode?.canDrag(note);

    return (
      <div
        key={note.path}
        onClick={() => onOpenNote(note)}
        draggable={canDrag}
        onDragStart={canDrag
          ? (event) => {
            event.dataTransfer.setData(NOTE_DRAG_TYPE, note.path);
            event.dataTransfer.setData('text/plain', note.path);
            event.dataTransfer.effectAllowed = 'copyMove';
          }
          : undefined}
        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        className={`rounded-xl border hover:border-primary p-5 flex flex-col justify-between shadow-xs hover:shadow-md transition cursor-pointer group${strip ? ' note-card-strip-item' : ''}`}
      >
        <div>
          <div className='flex items-start justify-between gap-2 mb-2'>
            <h3 className='font-semibold text-fg text-base line-clamp-1 transition flex items-center gap-1.5'>
              <span className='truncate'>{note.title}</span>
              {note.path.endsWith('.mdx') && <span className='shrink-0 text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded bg-warning-soft text-warning border border-warning/40 leading-none'>MDX</span>}
            </h3>
            <NoteStatusSelect statuses={statuses} status={note.status} readOnly={readOnly} label={t('notes.statusFor', { title: note.title })} onChange={(status) => onUpdateNoteStatus(note, status)} />
          </div>
          <p className='text-xs text-muted line-clamp-3 mb-4 leading-relaxed'>{getExcerpt(note.content || '') || <span className='italic text-muted'>{t('notes.noContent')}</span>}</p>
        </div>
        <div className='note-card-footer pt-3 border-t flex items-center justify-between gap-2 text-xs text-muted' style={{ borderColor: 'var(--color-border)' }}>
          <NoteTags tags={note.tags.slice(0, 2)} chipClassName='px-1.5 py-0.5 text-[11px]' tagActions={tagActions} className='note-card-tags max-w-[65%] min-w-0'>{note.tags.length > 2 && <span className='text-[10px] text-muted self-center'>+{note.tags.length - 2}</span>}</NoteTags>
          <div className='flex items-center gap-2'>
            <span className='flex items-center gap-1 text-[11px]'>
              <Clock className='w-3 h-3' />
              {formattedDate}
            </span>
            <div className='flex items-center gap-1' onClick={(e) => e.stopPropagation()}>
              {focusMode && (
                <button
                  type='button'
                  onClick={() => focusMode.onZoomNote(note)}
                  title={t('focus.zoomNote')}
                  aria-label={t('focus.zoomNote')}
                  className='ui-icon-button'
                >
                  <Maximize2 className='w-3.5 h-3.5' />
                </button>
              )}
              {!readOnly && onMoveNote && <NoteMoveButton onClick={() => onMoveNote(note)} />}
              {!readOnly && canDelete && (
                <button type='button' onClick={() => requestDelete(note.path)} title={pendingDeletePath === note.path ? t('notes.confirmDelete') : t('notes.delete')} className={pendingDeletePath === note.path ? 'p-1 text-on-danger bg-danger hover:bg-danger/90 transition rounded' : 'p-1 text-muted hover:text-danger transition rounded'}>
                  <Trash2 className='w-3.5 h-3.5' />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const gridClassName = strip ? 'note-card-strip' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4';

  return (
    <>
      {uncommitted.length > 0 && (
        <section className='note-card-uncommitted mb-4'>
          <h3 className='mb-2 text-xs uppercase font-semibold text-warning'>{t('notes.uncommitted')}</h3>
          <div className={gridClassName}>{uncommitted.map(renderCard)}</div>
        </section>
      )}
      <div className={gridClassName}>{/* Note Cards */}{notes.map(renderCard)}</div>
    </>
  );
};
