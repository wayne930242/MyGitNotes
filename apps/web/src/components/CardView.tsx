import { NoteMoveButton } from './NoteMoveButton.js';
import React from 'react';
import { Clock, Trash2 } from 'lucide-react';
import { NoteTagActions, NoteTags } from './NoteTags.js';
import { NoteStatusSelect } from './NoteStatusSelect.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { useTranslation } from '../lib/i18n/index.js';
import { noteUpdatedTime } from '../lib/note-sort.js';
import { useDeleteConfirm } from '../lib/use-delete-confirm.js';
import { NOTE_DRAG_TYPE, type NoteBrowseFocusMode } from '../lib/note-drag.js';
import { HighlightText } from './HighlightText.js';
import { type BrowseKind, NotesEmptyState } from './NotesEmptyState.js';
import { NoteSelectBox } from './NoteSelectBox.js';
import { NoteZoomButton } from './NoteZoomButton.js';
import { useNoteTouchSelection } from '../lib/use-note-touch-selection.js';

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
  /** What the list shows, so its empty state offers to create the same kind. */
  newKind?: BrowseKind;
  onUpdateNoteStatus: (note: NoteListItem, status: string) => void;
  tagActions?: NoteTagActions;
  /** Present while a Focus is displayed: cards get a zoom button and can be dragged into a pane. */
  focusMode?: NoteBrowseFocusMode;
  /** Single horizontally scrolling row, for a docked top panel too short for the grid. */
  strip?: boolean;
  /** Active search text: highlights matches in the title, and swaps the excerpt for a matched-content snippet when present. */
  highlightQuery?: string;
  /** `noteRefKey`s of the notes selected for bulk actions; a checkbox only appears on cards while this is non-empty. */
  selectedKeys?: Set<string>;
  /** Modifier-click (or the checkbox, once shown) toggles a card's membership; a plain click still opens it. */
  onToggleSelect?: (note: NoteListItem) => void;
}

export const CardView: React.FC<CardViewProps> = ({ notes, uncommitted = [], hasFolderEntries = false, loading = false, statuses, readOnly = false, canDelete = true, confirmDelete = false, onOpenNote, onDeleteNote, onMoveNote, onNewNote, newKind, onUpdateNoteStatus, tagActions, focusMode, strip = false, highlightQuery = '', selectedKeys, onToggleSelect }) => {
  const { t } = useTranslation();
  const touchSelection = useNoteTouchSelection(onToggleSelect);
  const { pendingDeletePath, requestDelete } = useDeleteConfirm(confirmDelete, path => {
    const note = [...uncommitted, ...notes].find(n => noteRefKey(n) === path);
    if (note) onDeleteNote(note);
  });

  const isEmpty = !loading && notes.length === 0 && uncommitted.length === 0 && !hasFolderEntries;

  if (isEmpty) {
    return <NotesEmptyState readOnly={readOnly} kind={newKind} onNewNote={onNewNote} />;
  }

  const getExcerpt = (content: string) => {
    const clean = content.replace(/^#+\s+.+$/gm, '').replace(/[*_`]/g, '').replace(/!\[.*?\]\(.*?\)/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').trim();
    return clean.slice(0, 140) + (clean.length > 140 ? '...' : '');
  };

  const renderCard = (note: NoteListItem, draft = false) => {
    const updated = noteUpdatedTime(note);
    const formattedDate = updated ? new Date(updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
    const canDrag = !!focusMode?.canDrag(note);
    const excerpt = note.matchSnippet || getExcerpt(note.content || '');
    const selectionActive = !draft && Boolean(selectedKeys?.size);
    const selected = !draft && (selectedKeys?.has(noteRefKey(note)) ?? false);

    return (
      <div
        key={noteRefKey(note)}
        {...touchSelection.itemProps(note, onOpenNote, !draft)}
        title={draft || selectionActive ? undefined : t('notes.multiSelectHint')}
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
            <h3 className='font-semibold text-fg text-base line-clamp-1 transition flex items-center gap-1.5 min-w-0'>
              {selectionActive && <NoteSelectBox title={note.title} checked={selected} onToggle={() => onToggleSelect?.(note)} />}
              <span className='truncate'>
                <HighlightText text={note.title} query={highlightQuery} />
              </span>
              {note.path.endsWith('.mdx') && <span className='shrink-0 text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded bg-warning-soft text-warning border border-warning/40 leading-none'>MDX</span>}
            </h3>
            <NoteStatusSelect statuses={statuses} status={note.status} readOnly={readOnly} label={t('notes.statusFor', { title: note.title })} onChange={(status) => onUpdateNoteStatus(note, status)} />
          </div>
          <p className='text-xs text-muted line-clamp-3 mb-4 leading-relaxed'>{excerpt ? <HighlightText text={excerpt} query={highlightQuery} /> : <span className='italic text-muted'>{t('notes.noContent')}</span>}</p>
        </div>
        <div className='note-card-footer pt-3 border-t flex items-center justify-between gap-2 text-xs text-muted' style={{ borderColor: 'var(--color-border)' }}>
          <NoteTags tags={note.tags.slice(0, 2)} chipClassName='px-1.5 py-0.5 text-[11px]' tagActions={tagActions} className='note-card-tags max-w-[65%] min-w-0'>{note.tags.length > 2 && <span className='text-[10px] text-muted self-center'>+{note.tags.length - 2}</span>}</NoteTags>
          <div className='flex items-center gap-2'>
            <span className='flex items-center gap-1 text-[11px]'>
              <Clock className='w-3 h-3' />
              {formattedDate}
            </span>
            <div className='flex items-center gap-1' onClick={(e) => e.stopPropagation()}>
              {focusMode && <NoteZoomButton onClick={() => focusMode.onZoomNote(note)} />}
              {!readOnly && onMoveNote && <NoteMoveButton onClick={() => onMoveNote(note)} />}
              {!readOnly && canDelete && (
                <button
                  type='button'
                  onClick={() => requestDelete(noteRefKey(note))}
                  title={pendingDeletePath === noteRefKey(note) ? t('notes.confirmDelete') : t('notes.delete')}
                  className={pendingDeletePath === noteRefKey(note) ? 'p-1 text-on-danger bg-danger hover:bg-danger/90 transition rounded' : 'p-1 text-muted hover:text-danger transition rounded'}
                >
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
          <div className={gridClassName}>{uncommitted.map(note => renderCard(note, true))}</div>
        </section>
      )}
      <div className={gridClassName}>{/* Note Cards */}{notes.map(note => renderCard(note))}</div>
    </>
  );
};
