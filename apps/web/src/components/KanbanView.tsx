import { NoteMoveButton } from './NoteMoveButton.js';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Clock, GripVertical, Kanban as KanbanIcon, Maximize2, Plus, Tag, Trash2 } from 'lucide-react';
import type { NoteListItem, NoteQuery } from '@mygitnotes/core/note-query';
import { noteUpdatedTime, SortField, SortOrder } from '../lib/note-sort.js';
import { Select } from './Select.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useAltWheelHorizontalScroll } from '../lib/use-alt-wheel-horizontal-scroll.js';
import { useDeleteConfirm } from '../lib/use-delete-confirm.js';
import { useNoteList } from '../lib/use-note-queries.js';
import { NoteListSentinel } from './NoteListSentinel.js';
import { NOTE_DRAG_TYPE, type NoteBrowseFocusMode } from '../lib/note-drag.js';

interface KanbanViewProps {
  /** The board's filter; each column adds its own status condition and pages on its own. */
  query: Partial<NoteQuery>;
  /** The folder index, which the board shows in the toolbar instead of as a card. */
  hiddenNote?: NoteListItem;
  /** An entry at the start of the board's header row, such as the folder index. */
  leading?: React.ReactNode;
  statuses: string[];
  readOnly?: boolean;
  canDelete?: boolean;
  confirmDelete?: boolean;
  onOpenNote: (note: NoteListItem) => void;
  onUpdateNoteStatus: (note: NoteListItem, newStatus: string) => void;
  onDeleteNote: (note: NoteListItem) => void;
  onMoveNote?: (note: NoteListItem) => void;
  onNewNoteWithStatus: (status: string) => void;
  sortField?: SortField;
  sortOrder?: SortOrder;
  onSortChange?: (field: SortField, order?: SortOrder) => void;
  /** Present while a Focus is displayed: cards get a zoom button and can be dragged into a pane. */
  focusMode?: NoteBrowseFocusMode;
}

interface Column {
  id: string;
  title: string;
  color: string;
}

interface BoardContext {
  columns: Column[];
  readOnly: boolean;
  canDelete: boolean;
  confirmDelete: boolean;
  onOpenNote: (note: NoteListItem) => void;
  onUpdateNoteStatus: (note: NoteListItem, newStatus: string) => void;
  onDeleteNote: (note: NoteListItem) => void;
  onMoveNote?: (note: NoteListItem) => void;
  onNewNoteWithStatus: (status: string) => void;
  dragged: NoteListItem | null;
  setDragged: (note: NoteListItem | null) => void;
  dragOverColumnId: string | null;
  setDragOverColumnId: (id: string | null) => void;
  onTotal: (columnId: string, total: number) => void;
  focusMode?: NoteBrowseFocusMode;
}

function useColumnDrag(board: BoardContext, columnId: string) {
  return {
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      if (board.readOnly) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (board.dragOverColumnId !== columnId) board.setDragOverColumnId(columnId);
    },
    onDragLeave: (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) board.setDragOverColumnId(null);
    },
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      if (board.readOnly) return;
      event.preventDefault();
      board.setDragOverColumnId(null);
      const notePath = event.dataTransfer.getData('text/plain');
      const note = board.dragged;
      board.setDragged(null);
      if (!note || (notePath && notePath !== note.path)) return;
      if ((note.status || '') !== columnId) board.onUpdateNoteStatus(note, columnId);
    },
  };
}

function KanbanCard({ note, board, index }: { note: NoteListItem; board: BoardContext; index: number; }) {
  const { t } = useTranslation();
  const { pendingDeletePath, requestDelete } = useDeleteConfirm(board.confirmDelete, () => board.onDeleteNote(note));
  const isBeingDragged = board.dragged?.path === note.path;
  const canDragForFocus = !!board.focusMode?.canDrag(note);
  const updated = noteUpdatedTime(note);
  const formattedDate = updated ? new Date(updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
  return (
    <div
      data-notepath={note.path}
      draggable={!board.readOnly || canDragForFocus}
      onDragStart={event => {
        if (board.readOnly && !canDragForFocus) return;
        event.dataTransfer.setData('text/plain', note.path);
        if (board.focusMode) event.dataTransfer.setData(NOTE_DRAG_TYPE, note.path);
        event.dataTransfer.effectAllowed = board.readOnly ? 'copy' : 'move';
        board.setDragged(note);
      }}
      onDragEnd={() => {
        board.setDragged(null);
        board.setDragOverColumnId(null);
      }}
      onClick={() => board.onOpenNote(note)}
      className={`p-3 rounded-lg border transition-all cursor-grab active:cursor-grabbing group shadow-xs ${isBeingDragged ? 'opacity-40 scale-[0.98] border-primary shadow-inner' : 'hover:shadow-sm hover:border-muted'}`}
      style={{ backgroundColor: 'var(--color-surface)', borderColor: isBeingDragged ? 'var(--color-primary)' : 'var(--color-border)' }}
    >
      <div className='flex items-start justify-between gap-1 mb-1.5'>
        <div className='font-medium text-fg text-sm line-clamp-2 transition'>{note.title}</div>
        <GripVertical className='w-3.5 h-3.5 text-muted shrink-0 opacity-0 group-hover:opacity-100 transition' />
      </div>
      {note.tags.length > 0 && (
        <div className='flex flex-wrap gap-1 mb-2.5'>
          {note.tags.map((tag) => (
            <span key={tag} className='inline-flex items-center gap-1 px-1.5 py-0.5 bg-fg/5 text-muted rounded text-[10px]'>
              <Tag className='w-2 h-2 text-muted' />
              {tag}
            </span>
          ))}
        </div>
      )}
      {/* Card Actions & Timestamp */}
      <div className='flex items-center justify-between pt-2 border-t text-muted text-xs' style={{ borderColor: 'var(--color-border)' }} onClick={(e) => e.stopPropagation()}>
        <div className='flex items-center gap-1.5 text-muted'>
          <span className='flex items-center gap-1 text-[11px]'>
            <Clock className='w-3 h-3 text-muted' />
            {formattedDate}
          </span>
        </div>
        <div className='flex items-center gap-1'>
          {board.focusMode && (
            <button
              type='button'
              onClick={() => board.focusMode?.onZoomNote(note)}
              title={t('focus.zoomNote')}
              aria-label={t('focus.zoomNote')}
              className='ui-icon-button'
            >
              <Maximize2 className='w-3.5 h-3.5' />
            </button>
          )}
          {!board.readOnly && board.onMoveNote && <NoteMoveButton onClick={() => board.onMoveNote?.(note)} />}
          {!board.readOnly && index > 0 && (
            <button type='button' onClick={() => board.onUpdateNoteStatus(note, board.columns[index - 1].id)} title={t('kanban.moveTo', { title: board.columns[index - 1].title })} className='p-1 hover:text-primary rounded hover:bg-fg/5 transition'>
              <ArrowLeft className='w-3.5 h-3.5' />
            </button>
          )}
          {!board.readOnly && index >= 0 && index < board.columns.length - 1 && (
            <button type='button' onClick={() => board.onUpdateNoteStatus(note, board.columns[index + 1].id)} title={t('kanban.moveTo', { title: board.columns[index + 1].title })} className='p-1 hover:text-primary rounded hover:bg-fg/5 transition'>
              <ArrowRight className='w-3.5 h-3.5' />
            </button>
          )}
          {!board.readOnly && board.canDelete && (
            <button type='button' onClick={() => requestDelete(note.path)} title={pendingDeletePath === note.path ? t('notes.confirmDelete') : t('notes.delete')} className={pendingDeletePath === note.path ? 'p-1 text-on-danger bg-danger hover:bg-danger/90 rounded transition' : 'p-1 hover:text-danger rounded hover:bg-danger-soft transition opacity-40 hover:opacity-100'}>
              <Trash2 className='w-3.5 h-3.5' />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const columnSortOptionValues = [{ value: 'updated:desc', label: 'kanban.newest' }, { value: 'updated:asc', label: 'kanban.oldest' }, { value: 'title:asc', label: 'kanban.titleAsc' }, { value: 'title:desc', label: 'kanban.titleDesc' }, { value: 'created:desc', label: 'kanban.createdNewest' }] as const;

function KanbanColumn({ col, index, board, query, hiddenNote, sort, onSort }: { col: Column; index: number; board: BoardContext; query: Partial<NoteQuery>; hiddenNote?: NoteListItem; sort: { field: SortField; order: SortOrder; }; onSort: (value: { field: SortField; order: SortOrder; }) => void; }) {
  const { t } = useTranslation();
  const hide = hiddenNote && (hiddenNote.status || '') === col.id ? hiddenNote.path : undefined;
  // A status filter keeps every column on the board but only its own column holds notes.
  const result = useNoteList(query.status && query.status !== col.id ? null : { ...query, status: col.id, sort: sort.field, order: sort.order }, { hide });
  const drag = useColumnDrag(board, col.id);
  const isColumnDragOver = board.dragOverColumnId === col.id;
  const report = board.onTotal;
  useEffect(() => {
    report(col.id, result.total);
  }, [report, col.id, result.total]);
  const notes = [...result.uncommitted, ...result.notes];

  return (
    <div data-status-column={col.id} onDragOver={drag.onDragOver} onDragLeave={drag.onDragLeave} onDrop={drag.onDrop} className={`w-80 rounded-xl p-3 flex flex-col max-h-full shrink-0 border transition-colors shadow-xs ${isColumnDragOver ? '' : 'border-line/80'}`} style={{ backgroundColor: isColumnDragOver ? 'var(--color-primary-light)' : 'var(--color-surface)', borderColor: isColumnDragOver ? 'var(--color-primary)' : 'var(--color-border)', boxShadow: isColumnDragOver ? '0 0 0 2px var(--color-primary), 0 8px 20px -4px var(--color-primary-light)' : undefined }}>
      {/* Column Header */}
      <div className='flex items-center justify-between mb-3 px-1'>
        <div className='flex items-center gap-2 min-w-0'>
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${col.id === 'inbox' ? '' : col.color}`} style={col.id === 'inbox' ? { backgroundColor: 'var(--color-primary)' } : undefined} />
          <h3 className='font-semibold text-fg text-sm truncate'>{col.title}</h3>
          <span className='text-xs px-2 py-0.5 rounded-full bg-fg/5 text-muted font-medium shrink-0'>{result.total}</span>
        </div>
        <div className='flex items-center gap-1.5 shrink-0'>
          {/* Column Sort Selector */}
          <Select
            aria-label={`${t('kanban.columnSort')} ${col.title}`}
            value={`${sort.field}:${sort.order}`}
            onValueChange={(val) => {
              const [field, order] = val.split(':') as [SortField, SortOrder];
              onSort({ field, order });
            }}
            options={columnSortOptionValues.map(option => ({ value: option.value, label: t(option.label) }))}
            className='min-h-7 px-1.5 py-1 text-[11px] font-medium'
          />
          {!board.readOnly && (
            <button type='button' onClick={() => board.onNewNoteWithStatus(col.id)} className='p-1 text-muted hover:text-fg hover:bg-fg/5 rounded-md transition' title={t('kanban.addNoteTo', { title: col.title })}>
              <Plus className='w-4 h-4' />
            </button>
          )}
        </div>
      </div>
      {/* Note Cards List (Drag Target Area) */}
      <div className='overflow-y-auto space-y-2.5 flex-1 pr-0.5 min-h-[80px]'>
        {/* Drop Target Guide Indicator */}
        {isColumnDragOver && board.dragged && <div className='border-2 border-dashed rounded-lg p-3 text-center text-xs font-semibold animate-pulse transition my-1' style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', backgroundColor: 'var(--color-primary-light)' }}>{t('kanban.dropNoteInto', { title: col.title })}</div>}
        {result.error && <p role='alert' className='text-xs text-danger'>{result.error}</p>}
        {result.loading && <p role='status' className='text-xs text-muted'>{t('notes.loading')}</p>}
        {!result.loading && notes.length === 0 && !isColumnDragOver ? <div className='py-8 text-center text-xs text-muted border border-dashed border-line rounded-lg'>{board.readOnly ? t('kanban.noNotes') : t('kanban.dragNotesHere')}</div> : (notes.map(note => <KanbanCard key={note.path} note={note} board={board} index={index} />))}
        <NoteListSentinel hasMore={result.hasMore} loading={result.loadingMore} error={result.error} onLoadMore={result.loadMore} />
      </div>
    </div>
  );
}

/** Notes the board's filter matches that carry no status; the server answers this column too. */
function KanbanUnassignedColumn({ board, query, hiddenNote, sort }: { board: BoardContext; query: Partial<NoteQuery>; hiddenNote?: NoteListItem; sort: { field: SortField; order: SortOrder; }; }) {
  const { t } = useTranslation();
  const hide = hiddenNote && !hiddenNote.status ? hiddenNote.path : undefined;
  const result = useNoteList(query.status ? null : { ...query, withoutStatus: true, sort: sort.field, order: sort.order }, { hide });
  const notes = [...result.uncommitted, ...result.notes];
  const drag = useColumnDrag(board, '');
  const report = board.onTotal;
  useEffect(() => {
    report('', result.total);
  }, [report, result.total]);
  if (!result.loading && !result.total && !notes.length) return null;
  return (
    <div onDragOver={drag.onDragOver} onDragLeave={drag.onDragLeave} onDrop={drag.onDrop} className='w-80 rounded-xl p-3 flex flex-col max-h-full shrink-0 border border-dashed shadow-xs' style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className='flex items-center justify-between mb-3 px-1'>
        <div className='flex items-center gap-2'>
          <span className='w-2.5 h-2.5 rounded-full bg-muted' />
          <h3 className='font-medium text-sm' style={{ color: 'var(--color-muted)' }}>{t('kanban.noStatus')}</h3>
          <span className='text-xs px-2 py-0.5 rounded-full bg-fg/5 text-muted font-medium'>{result.total}</span>
        </div>
      </div>
      <div className='overflow-y-auto space-y-2.5 flex-1 pr-0.5'>
        {result.loading && <p role='status' className='text-xs text-muted'>{t('notes.loading')}</p>}
        {notes.map((note) => {
          const canDragForFocus = !!board.focusMode?.canDrag(note);
          return (
            <div
              key={note.path}
              draggable={!board.readOnly || canDragForFocus}
              onDragStart={event => {
                if (board.readOnly && !canDragForFocus) return;
                event.dataTransfer.setData('text/plain', note.path);
                if (board.focusMode) event.dataTransfer.setData(NOTE_DRAG_TYPE, note.path);
                event.dataTransfer.effectAllowed = board.readOnly ? 'copy' : 'move';
                board.setDragged(note);
              }}
              onDragEnd={() => {
                board.setDragged(null);
                board.setDragOverColumnId(null);
              }}
              onClick={() => board.onOpenNote(note)}
              className='p-3 rounded-lg border hover:shadow-xs transition cursor-grab active:cursor-grabbing'
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <div className='font-medium text-fg text-sm mb-1 line-clamp-2'>{note.title}</div>
              {(board.focusMode || (!board.readOnly && board.onMoveNote)) && (
                <div className='flex justify-end items-center gap-1' onClick={event => event.stopPropagation()}>
                  {board.focusMode && (
                    <button
                      type='button'
                      onClick={() => board.focusMode?.onZoomNote(note)}
                      title={t('focus.zoomNote')}
                      aria-label={t('focus.zoomNote')}
                      className='ui-icon-button'
                    >
                      <Maximize2 className='w-3.5 h-3.5' />
                    </button>
                  )}
                  {!board.readOnly && board.onMoveNote && <NoteMoveButton onClick={() => board.onMoveNote?.(note)} />}
                </div>
              )}
            </div>
          );
        })}
        <NoteListSentinel hasMore={result.hasMore} loading={result.loadingMore} error={result.error} onLoadMore={result.loadMore} />
      </div>
    </div>
  );
}

export const KanbanView: React.FC<KanbanViewProps> = ({ query, hiddenNote, leading, statuses, readOnly = false, canDelete = true, confirmDelete = false, onOpenNote, onUpdateNoteStatus, onDeleteNote, onMoveNote, onNewNoteWithStatus, sortField = 'updated', sortOrder = 'desc', onSortChange, focusMode }) => {
  const { t } = useTranslation();
  const [dragged, setDragged] = useState<NoteListItem | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const columnsRef = useRef<HTMLDivElement>(null);
  useAltWheelHorizontalScroll(columnsRef, columnsRef);

  // Per-column sort override state
  const [columnSorts, setColumnSorts] = useState<Record<string, { field: SortField; order: SortOrder; }>>({});

  const columns: Column[] = statuses.map((status) => ({ id: status, title: status, color: status === 'done' ? 'bg-success' : status === 'working' || status === 'doing' ? 'bg-info' : status === 'archived' ? 'bg-muted' : 'bg-accent-6' }));

  // Board sort key: inside Kanban, 'status' defaults to 'updated'
  const effectiveBoardSortField = sortField === 'status' ? 'updated' : sortField;
  const boardSortKey = `${effectiveBoardSortField}:${sortOrder}`;

  const boardSortOptions = [{ value: 'updated:desc', label: t('sort.updatedDesc') }, { value: 'updated:asc', label: t('sort.updatedAsc') }, { value: 'created:desc', label: t('sort.createdDesc') }, { value: 'created:asc', label: t('sort.createdAsc') }, { value: 'title:asc', label: t('sort.titleAsc') }, { value: 'title:desc', label: t('sort.titleDesc') }];

  const board: BoardContext = { columns, readOnly, canDelete, confirmDelete, onOpenNote, onUpdateNoteStatus, onDeleteNote, onMoveNote, onNewNoteWithStatus, dragged, setDragged, dragOverColumnId, setDragOverColumnId, focusMode, onTotal: (columnId, total) => setTotals(previous => (previous[columnId] === total ? previous : { ...previous, [columnId]: total })) };
  // Only the columns on the board count, so a status that disappeared leaves no stale total.
  const boardTotal = [...columns.map(col => col.id), ''].reduce((sum, id) => sum + (totals[id] || 0), 0);

  return (
    <div className='flex flex-col h-full select-none'>
      {/* Kanban Top Toolbar */}
      <div className='flex items-center justify-between px-2 mb-3 flex-wrap gap-2 text-xs shrink-0'>
        <div className='kanban-leading flex items-center gap-3 min-w-0'>
          {leading}
          <div className='flex items-center gap-2 text-muted font-medium'>
            <KanbanIcon className='w-4 h-4 text-primary shrink-0' />
            <span>{t('kanban.columns', { count: columns.length })}</span>
            <span>·</span>
            <span>{t('kanban.notes', { count: boardTotal })}</span>
          </div>
        </div>
        {onSortChange && (
          <div className='flex items-center gap-2'>
            <span className='text-muted font-medium whitespace-nowrap'>{t('kanban.sortBy')}</span>
            <Select
              aria-label={t('kanban.sortBy')}
              value={boardSortKey}
              onValueChange={(val) => {
                const [f, o] = val.split(':') as [SortField, SortOrder];
                setColumnSorts({});
                onSortChange(f, o);
              }}
              options={boardSortOptions}
              className='font-medium'
            />
          </div>
        )}
      </div>
      {/* Kanban Columns List */}
      <div ref={columnsRef} data-kanban-columns='' className='flex gap-5 overflow-x-auto pt-1 px-1 pb-6 flex-1 items-start'>
        {columns.map((col, index) => <KanbanColumn key={col.id} col={col} index={index} board={board} query={query} hiddenNote={hiddenNote} sort={columnSorts[col.id] || { field: effectiveBoardSortField, order: sortOrder }} onSort={value => setColumnSorts(previous => ({ ...previous, [col.id]: value }))} />)}
        <KanbanUnassignedColumn board={board} query={query} hiddenNote={hiddenNote} sort={{ field: effectiveBoardSortField, order: sortOrder }} />
      </div>
    </div>
  );
};
