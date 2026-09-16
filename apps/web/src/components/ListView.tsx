import { NoteMoveButton } from './NoteMoveButton.js';
import { Button } from './Button.js';
import React, { useLayoutEffect, useMemo, useRef } from 'react';
import {
  FileText,
  Tag,
  Clock,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react';
import { NoteStatusSelect } from './NoteStatusSelect.js';
import { Select } from './Select.js';
import { NoteItem } from '../lib/types.js';
import { SortField, SortOrder } from '../lib/note-sort.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useDeleteConfirm } from '../lib/use-delete-confirm.js';

interface ListViewProps {
  notes: NoteItem[];
  hasFolderEntries?: boolean;
  statuses: string[];
  readOnly?: boolean;
  canDelete?: boolean;
  confirmDelete?: boolean;
  onOpenNote: (note: NoteItem) => void;
  onDeleteNote: (note: NoteItem) => void;
  onMoveNote?: (note: NoteItem) => void;
  onUpdateNoteStatus: (note: NoteItem, newStatus: string) => void;
  onNewNote: () => void;
  sortField?: SortField;
  sortOrder?: SortOrder;
  onSortChange?: (field: SortField, order?: SortOrder) => void;
  showMobileSort?: boolean;
}

interface NoteRowActions {
  open: (note: NoteItem) => void;
  remove: (note: NoteItem) => void;
  move: (note: NoteItem) => void;
  status: (note: NoteItem, status: string) => void;
}

const NoteRow = React.memo(function NoteRow({ note, statuses, readOnly, canDelete, isPendingDelete, actions, dates }: {
  note: NoteItem; statuses: string[]; readOnly: boolean; canDelete: boolean; isPendingDelete: boolean;
  actions: NoteRowActions; dates: { short: Intl.DateTimeFormat; full: Intl.DateTimeFormat };
}) {
  const { t } = useTranslation();
  const formattedDate = note.mtime ? dates.short.format(note.mtime) : '—';
  return (
    <tr
      onClick={() => actions.open(note)}
      className="hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer group"
    >
      <td className="py-3 px-4">
        <div className="flex items-center gap-2.5">
          <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
          <div>
            <div className="font-medium text-slate-900 dark:text-slate-100 transition">
              {note.title}
            </div>
            <div className="text-xs text-slate-400 dark:text-slate-500 font-mono">
              {note.path}
            </div>
          </div>
        </div>
      </td>

      {/* In-Table Selectable Status */}
      <td className="py-3 px-4">
        <NoteStatusSelect
          statuses={statuses}
          status={note.status}
          readOnly={readOnly}
          label={t('notes.statusFor', { title: note.title })}
          onChange={(status) => actions.status(note, status)}
        />
      </td>

      <td className="py-3 px-4">
        <div className="flex flex-wrap gap-1">
          {note.tags.length > 0 ? (
            note.tags.map((tTag) => (
              <span
                key={tTag}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded text-xs"
              >
                <Tag className="w-2.5 h-2.5 text-slate-400" />
                {tTag}
              </span>
            ))
          ) : (
            <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
          )}
        </div>
      </td>

      <td className="py-3 px-4 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <time dateTime={note.mtime ? new Date(note.mtime).toISOString() : undefined}
            title={note.mtime ? dates.full.format(note.mtime) : undefined}>{formattedDate}</time>
        </div>
      </td>

      {/* Actions Column */}
      <td className="py-3 px-4 text-right">
        <div
          className="flex items-center justify-end opacity-40 hover:opacity-100 group-hover:opacity-100 transition"
          onClick={(e) => e.stopPropagation()}
        >
          {!readOnly && <NoteMoveButton onClick={() => actions.move(note)} />}
          {!readOnly && canDelete && (
            <button
              type="button"
              onClick={() => actions.remove(note)}
              title={isPendingDelete ? t('notes.confirmDelete') : t('notes.delete')}
              className={isPendingDelete
                ? 'p-1.5 text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition'
                : 'p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition'}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});

export const ListView: React.FC<ListViewProps> = ({
  notes,
  hasFolderEntries = false,
  statuses,
  readOnly = false,
  canDelete = true,
  confirmDelete = false,
  onOpenNote,
  onDeleteNote,
  onMoveNote,
  onUpdateNoteStatus,
  onNewNote,
  sortField = 'updated',
  sortOrder = 'desc',
  onSortChange,
  showMobileSort = false,
}) => {
  const { t, language } = useTranslation();
  // Rows retain stable actions while invoking the latest committed callbacks.
  const handlers = useRef({ onOpenNote, onDeleteNote, onUpdateNoteStatus, onMoveNote });
  useLayoutEffect(() => { handlers.current = { onOpenNote, onDeleteNote, onUpdateNoteStatus, onMoveNote }; });
  const notesRef = useRef(notes);
  useLayoutEffect(() => { notesRef.current = notes; });
  const { pendingDeletePath, requestDelete } = useDeleteConfirm(confirmDelete, path => {
    const note = notesRef.current.find(n => n.path === path);
    if (note) handlers.current.onDeleteNote(note);
  });
  const actions = useMemo<NoteRowActions>(() => ({
    open: note => handlers.current.onOpenNote(note),
    remove: note => requestDelete(note.path),
    move: note => handlers.current.onMoveNote?.(note),
    status: (note, status) => handlers.current.onUpdateNoteStatus(note, status),
  }), [requestDelete]);
  const dates = useMemo(() => ({
    short: new Intl.DateTimeFormat(language, { month: '2-digit', day: '2-digit', hour12: false, hour: '2-digit', minute: '2-digit' }),
    full: new Intl.DateTimeFormat(language, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }),
  }), [language]);

  const isEmpty = notes.length === 0 && !hasFolderEntries;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center px-4">
        <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
          <FileText className="w-6 h-6" />
        </div>
        <h3 className="text-base font-medium text-slate-800 dark:text-slate-200 mb-1">
          {t('notes.emptyTitle')}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-4">
          {t('notes.emptyDescription')}
        </p>
        {!readOnly && (
          <Button variant="primary"
            onClick={onNewNote}
>
            <Plus className="w-4 h-4" />
            {t('notes.createNote')}
          </Button>
        )}
      </div>
    );
  }

  const renderSortHeader = (field: SortField, label: string, className = '') => {
    const isActive = sortField === field;

    return (
      <th className={`py-3 px-4 select-none ${className}`}>
        {onSortChange ? (
          <button
            type="button"
            onClick={() => onSortChange(field)}
            className="group inline-flex items-center gap-1 text-xs uppercase font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition"
          >
            <span>{label}</span>
            {isActive ? (
              sortOrder === 'asc' ? (
                <ArrowUp className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              ) : (
                <ArrowDown className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              )
            ) : (
              <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition text-slate-400" />
            )}
          </button>
        ) : (
          <span>{label}</span>
        )}
      </th>
    );
  };

  return (
    <>
    {showMobileSort && notes.length > 0 && onSortChange && <div className="note-list-mobile-sort mobile-only items-center gap-2 mb-4">
      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
      <Select
        aria-label={t('sort.select')}
        value={`${sortField}:${sortOrder}`}
        onValueChange={value => {
          const [field, order] = value.split(':') as [SortField, SortOrder];
          onSortChange(field, order);
        }}
        options={[
          { value: 'updated:desc', label: t('sort.updatedDesc') },
          { value: 'updated:asc', label: t('sort.updatedAsc') },
          { value: 'created:desc', label: t('sort.createdDesc') },
          { value: 'created:asc', label: t('sort.createdAsc') },
          { value: 'title:asc', label: t('sort.titleAsc') },
          { value: 'title:desc', label: t('sort.titleDesc') },
          { value: 'status:asc', label: t('sort.status') },
        ]}
      />
    </div>}
    {notes.length > 0 && <div
      className="note-list rounded-xl border shadow-xs overflow-hidden transition-colors"
      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead
            className="bg-black/5 dark:bg-white/5 border-b text-xs uppercase font-semibold text-slate-500 dark:text-slate-400"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <tr>
              {renderSortHeader('title', t('notes.title'))}
              {renderSortHeader('status', t('notes.status'), 'w-36')}
              <th className="py-3 px-4">{t('notes.tags')}</th>
              {renderSortHeader('updated', t('notes.modified'), 'w-36')}
              <th className="py-3 px-4 w-16 text-right">{t('notes.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {/* Notes row rendering */}
            {notes.map(note => <NoteRow key={note.path} note={note} statuses={statuses}
              readOnly={readOnly} canDelete={canDelete} isPendingDelete={pendingDeletePath === note.path} actions={actions} dates={dates} />)}
          </tbody>
        </table>
      </div>
    </div>}
    </>
  );
};
