import { NoteMoveButton } from './NoteMoveButton.js';
import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Clock, FileText, GalleryHorizontalEnd, Trash2 } from 'lucide-react';
import { isCompilationPath } from '@mygitnotes/core/compilation';
import { NoteTagActions, NoteTags } from './NoteTags.js';
import { NoteStatusSelect } from './NoteStatusSelect.js';
import { Select } from './Select.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { noteUpdatedTime, SortField, SortOrder } from '../lib/note-sort.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useDeleteConfirm } from '../lib/use-delete-confirm.js';
import { NOTE_DRAG_TYPE, type NoteBrowseFocusMode } from '../lib/note-drag.js';
import { HighlightText } from './HighlightText.js';
import { NotesEmptyState } from './NotesEmptyState.js';
import { NoteSelectBox } from './NoteSelectBox.js';
import { NoteZoomButton } from './NoteZoomButton.js';
import { useNoteTouchSelection } from '../lib/use-note-touch-selection.js';

interface ListViewProps {
  notes: NoteListItem[];
  /** Staged drafts the server cannot return yet; listed above the committed rows. */
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
  onUpdateNoteStatus: (note: NoteListItem, newStatus: string) => void;
  onNewNote: () => void;
  sortField?: SortField;
  sortOrder?: SortOrder;
  onSortChange?: (field: SortField, order?: SortOrder) => void;
  showMobileSort?: boolean;
  tagActions?: NoteTagActions;
  /** Present while a Focus is displayed: rows get a zoom button and can be dragged into a pane. */
  focusMode?: NoteBrowseFocusMode;
  /** Narrow layout for a docked browse panel: single-row layout, no header, other columns hidden. */
  compact?: boolean;
  /** An entry listed as the first row, such as the folder index in the flat view. */
  leading?: React.ReactNode;
  /** Active search text: highlights matches in the title and shows a matched-content snippet. */
  highlightQuery?: string;
  /** `noteRefKey`s of the notes selected for bulk actions; a checkbox only appears on rows while this is non-empty. */
  selectedKeys?: Set<string>;
  /** Modifier-click (or the checkbox, once shown) toggles a row's membership; a plain click still opens it. */
  onToggleSelect?: (note: NoteListItem) => void;
}

interface NoteRowActions {
  open: (note: NoteListItem) => void;
  remove: (note: NoteListItem) => void;
  move: (note: NoteListItem) => void;
  status: (note: NoteListItem, status: string) => void;
  zoom: (note: NoteListItem) => void;
  toggleSelect: (note: NoteListItem) => void;
}

const NoteRow = React.memo(function NoteRow({ note, statuses, readOnly, canDelete, isPendingDelete, actions, dates, tagActions, showZoom, canDrag, highlightQuery = '', selected, selectionActive }: { note: NoteListItem; tagActions?: NoteTagActions; statuses: string[]; readOnly: boolean; canDelete: boolean; isPendingDelete: boolean; actions: NoteRowActions; dates: { short: Intl.DateTimeFormat; full: Intl.DateTimeFormat; }; showZoom?: boolean; canDrag?: boolean; highlightQuery?: string; selected: boolean; selectionActive: boolean; }) {
  const { t } = useTranslation();
  const touchSelection = useNoteTouchSelection(actions.toggleSelect);
  const updated = noteUpdatedTime(note);
  const formattedDate = updated ? dates.short.format(updated) : '—';
  return (
    <tr
      {...touchSelection.itemProps(note, actions.open)}
      title={selectionActive ? undefined : t('notes.multiSelectHint')}
      draggable={canDrag}
      onDragStart={canDrag
        ? (event) => {
          event.dataTransfer.setData(NOTE_DRAG_TYPE, note.path);
          event.dataTransfer.setData('text/plain', note.path);
          event.dataTransfer.effectAllowed = 'copyMove';
        }
        : undefined}
      className='hover:bg-fg/5 transition cursor-pointer group'
    >
      <td className='py-3 px-4'>
        <div className='flex items-center gap-2.5'>
          {selectionActive && <NoteSelectBox title={note.title} checked={selected} onToggle={() => actions.toggleSelect(note)} />}
          {isCompilationPath(note.path) ? <GalleryHorizontalEnd className='w-4 h-4 text-primary shrink-0' aria-hidden='true' /> : <FileText className='w-4 h-4 text-primary shrink-0' />}
          <div>
            <div className='font-medium text-fg transition flex items-center gap-1.5'>
              <span>
                <HighlightText text={note.title} query={highlightQuery} />
              </span>
              {note.path.endsWith('.mdx') && <span className='text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded bg-warning-soft text-warning border border-warning/40 leading-none'>MDX</span>}
            </div>
            <div className='text-xs text-muted font-mono'>{note.path}</div>
            {note.matchSnippet && (
              <div className='text-xs text-muted mt-0.5 line-clamp-2'>
                <HighlightText text={note.matchSnippet} query={highlightQuery} />
              </div>
            )}
          </div>
        </div>
      </td>
      {/* In-Table Selectable Status */}
      <td className='py-3 px-4'>
        <NoteStatusSelect statuses={statuses} status={note.status} readOnly={readOnly} label={t('notes.statusFor', { title: note.title })} onChange={(status) => actions.status(note, status)} />
      </td>
      <td className='py-3 px-4'>{note.tags.length > 0 ? <NoteTags tags={note.tags} chipClassName='px-2 py-0.5 text-xs' tagActions={tagActions} /> : <span className='text-xs text-muted'>—</span>}</td>
      <td className='py-3 px-4 text-xs text-muted whitespace-nowrap tabular-nums'>
        <div className='flex items-center gap-1.5'>
          <Clock className='w-3.5 h-3.5 text-muted shrink-0' />
          <time dateTime={updated ? new Date(updated).toISOString() : undefined} title={updated ? dates.full.format(updated) : undefined}>{formattedDate}</time>
        </div>
      </td>
      {/* Actions Column */}
      <td className='py-3 px-4 text-right'>
        <div className='flex items-center justify-end opacity-40 hover:opacity-100 group-hover:opacity-100 transition' onClick={(e) => e.stopPropagation()}>
          {showZoom && <NoteZoomButton onClick={() => actions.zoom(note)} iconClassName='w-4 h-4' />}
          {!readOnly && <NoteMoveButton onClick={() => actions.move(note)} />}
          {!readOnly && canDelete && (
            <button
              type='button'
              onClick={() => actions.remove(note)}
              title={isPendingDelete ? t('notes.confirmDelete') : t('notes.delete')}
              className={isPendingDelete ? 'p-1.5 text-on-danger bg-danger hover:bg-danger/90 rounded-lg transition' : 'p-1.5 text-muted hover:text-danger hover:bg-danger-soft rounded-lg transition'}
            >
              <Trash2 className='w-4 h-4' />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});

export const ListView: React.FC<ListViewProps> = ({ notes, uncommitted = [], hasFolderEntries = false, loading = false, statuses, readOnly = false, canDelete = true, confirmDelete = false, onOpenNote, onDeleteNote, onMoveNote, onUpdateNoteStatus, onNewNote, sortField = 'updated', sortOrder = 'desc', onSortChange, showMobileSort = false, tagActions, focusMode, compact = false, leading, highlightQuery = '', selectedKeys, onToggleSelect }) => {
  const { t, language } = useTranslation();
  // Rows retain stable actions while invoking the latest committed callbacks.
  const handlers = useRef({ onOpenNote, onDeleteNote, onUpdateNoteStatus, onMoveNote, focusMode, onToggleSelect });
  useLayoutEffect(() => {
    handlers.current = { onOpenNote, onDeleteNote, onUpdateNoteStatus, onMoveNote, focusMode, onToggleSelect };
  });
  const notesRef = useRef(notes);
  useLayoutEffect(() => {
    notesRef.current = [...uncommitted, ...notes];
  });
  const { pendingDeletePath, requestDelete } = useDeleteConfirm(confirmDelete, path => {
    const note = notesRef.current.find(n => noteRefKey(n) === path);
    if (note) handlers.current.onDeleteNote(note);
  });
  const actions = useMemo<NoteRowActions>(() => ({ open: note => handlers.current.onOpenNote(note), remove: note => requestDelete(noteRefKey(note)), move: note => handlers.current.onMoveNote?.(note), status: (note, status) => handlers.current.onUpdateNoteStatus(note, status), zoom: note => handlers.current.focusMode?.onZoomNote(note), toggleSelect: note => handlers.current.onToggleSelect?.(note) }), [requestDelete]);
  const dates = useMemo(() => ({ short: new Intl.DateTimeFormat(language, { month: '2-digit', day: '2-digit', hour12: false, hour: '2-digit', minute: '2-digit' }), full: new Intl.DateTimeFormat(language, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }) }), [language]);

  const isEmpty = !loading && notes.length === 0 && uncommitted.length === 0 && !hasFolderEntries;

  if (isEmpty) {
    return <NotesEmptyState readOnly={readOnly} onNewNote={onNewNote} />;
  }

  const renderSortHeader = (field: SortField, label: string, className = '') => {
    const isActive = sortField === field;

    return (
      <th className={`py-3 px-4 select-none ${className}`}>
        {onSortChange
          ? (
            <button type='button' onClick={() => onSortChange(field)} className='group inline-flex items-center gap-1 text-xs uppercase font-semibold text-muted hover:text-fg transition'>
              <span>{label}</span>
              {isActive ? (sortOrder === 'asc' ? <ArrowUp className='w-3.5 h-3.5 text-primary' /> : <ArrowDown className='w-3.5 h-3.5 text-primary' />) : <ArrowUpDown className='w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition text-muted' />}
            </button>
          )
          : <span>{label}</span>}
      </th>
    );
  };

  return (
    <>
      {showMobileSort && notes.length > 0 && onSortChange && (
        <div className='note-list-mobile-sort mobile-only items-center gap-2 mb-4'>
          <ArrowUpDown className='w-3.5 h-3.5 text-muted shrink-0' aria-hidden='true' />
          <Select
            aria-label={t('sort.select')}
            value={`${sortField}:${sortOrder}`}
            onValueChange={value => {
              const [field, order] = value.split(':') as [SortField, SortOrder];
              onSortChange(field, order);
            }}
            options={[{ value: 'updated:desc', label: t('sort.updatedDesc') }, { value: 'updated:asc', label: t('sort.updatedAsc') }, { value: 'created:desc', label: t('sort.createdDesc') }, { value: 'created:asc', label: t('sort.createdAsc') }, { value: 'title:asc', label: t('sort.titleAsc') }, { value: 'title:desc', label: t('sort.titleDesc') }, { value: 'status:asc', label: t('sort.status') }]}
          />
        </div>
      )}
      {(notes.length > 0 || uncommitted.length > 0 || leading) && (
        <div className='note-list rounded-xl border shadow-xs overflow-hidden transition-colors' data-compact={compact ? 'true' : undefined} style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className='overflow-x-auto'>
            <table className='w-full text-left text-sm'>
              <thead className='bg-fg/5 border-b text-xs uppercase font-semibold text-muted' style={{ borderColor: 'var(--color-border)' }}>
                <tr>
                  {renderSortHeader('title', t('notes.title'))}
                  {renderSortHeader('status', t('notes.status'), 'w-36')}
                  <th className='py-3 px-4'>{t('notes.tags')}</th>
                  {renderSortHeader('updated', t('notes.modified'), 'w-36')}
                  <th className='py-3 px-4 w-16 text-right'>{t('notes.actions')}</th>
                </tr>
              </thead>
              {uncommitted.length > 0 && (
                <tbody className='divide-y note-list-uncommitted' style={{ borderColor: 'var(--color-border)' }}>
                  <tr>
                    <th colSpan={5} scope='colgroup' className='py-2 px-4 text-left text-xs uppercase font-semibold text-warning'>{t('notes.uncommitted')}</th>
                  </tr>
                  {uncommitted.map(note => <NoteRow key={noteRefKey(note)} note={note} statuses={statuses} readOnly={readOnly} canDelete={canDelete} isPendingDelete={pendingDeletePath === noteRefKey(note)} actions={actions} dates={dates} tagActions={tagActions} showZoom={!!focusMode} canDrag={!!focusMode?.canDrag(note)} highlightQuery={highlightQuery} selected={false} selectionActive={false} />)}
                </tbody>
              )}
              <tbody className='divide-y' style={{ borderColor: 'var(--color-border)' }}>
                {leading && (
                  <tr className='note-list-leading hover:bg-fg/5 transition'>
                    <td colSpan={5} className='py-3 px-4'>{leading}</td>
                  </tr>
                )}
                {/* Notes row rendering */}
                {notes.map(note => <NoteRow key={noteRefKey(note)} note={note} statuses={statuses} readOnly={readOnly} canDelete={canDelete} isPendingDelete={pendingDeletePath === noteRefKey(note)} actions={actions} dates={dates} tagActions={tagActions} showZoom={!!focusMode} canDrag={!!focusMode?.canDrag(note)} highlightQuery={highlightQuery} selected={selectedKeys?.has(noteRefKey(note)) ?? false} selectionActive={Boolean(selectedKeys?.size)} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
};
