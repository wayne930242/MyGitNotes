import React, { useState } from 'react';
import {
  Plus,
  Tag,
  ArrowLeft,
  ArrowRight,
  Trash2,
  GripVertical,
  Clock,
  Kanban as KanbanIcon,
} from 'lucide-react';
import { NoteItem } from '../lib/types.js';
import { SortField, SortOrder, sortNotes } from '../lib/note-sort.js';
import { Select } from './Select.js';
import { useTranslation } from '../lib/i18n/index.js';

interface KanbanViewProps {
  notes: NoteItem[];
  statuses: string[];
  readOnly?: boolean;
  canDelete?: boolean;
  onOpenNote: (note: NoteItem) => void;
  onUpdateNoteStatus: (note: NoteItem, newStatus: string) => void;
  onDeleteNote: (note: NoteItem) => void;
  onNewNoteWithStatus: (status: string) => void;
  sortField?: SortField;
  sortOrder?: SortOrder;
  onSortChange?: (field: SortField, order?: SortOrder) => void;
}

export const KanbanView: React.FC<KanbanViewProps> = ({
  notes,
  statuses,
  readOnly = false,
  canDelete = true,
  onOpenNote,
  onUpdateNoteStatus,
  onDeleteNote,
  onNewNoteWithStatus,
  sortField = 'updated',
  sortOrder = 'desc',
  onSortChange,
}) => {
  const { t } = useTranslation();
  const [draggedNotePath, setDraggedNotePath] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  // Per-column sort override state
  const [columnSorts, setColumnSorts] = useState<
    Record<string, { field: SortField; order: SortOrder }>
  >({});

  const columns = statuses.map((status) => ({
    id: status,
    title: status,
    color:
      status === 'done'
        ? 'bg-emerald-500'
        : status === 'working' || status === 'doing'
        ? 'bg-sky-500'
        : status === 'archived'
        ? 'bg-slate-400'
        : 'bg-purple-500',
  }));

  const unassignedNotes = notes.filter((n) => !n.status);

  // Board sort key: inside Kanban, 'status' defaults to 'updated'
  const effectiveBoardSortField = sortField === 'status' ? 'updated' : sortField;
  const boardSortKey = `${effectiveBoardSortField}:${sortOrder}`;

  const boardSortOptions = [
    { value: 'updated:desc', label: t('sort.updatedDesc') },
    { value: 'updated:asc', label: t('sort.updatedAsc') },
    { value: 'created:desc', label: t('sort.createdDesc') },
    { value: 'created:asc', label: t('sort.createdAsc') },
    { value: 'title:asc', label: t('sort.titleAsc') },
    { value: 'title:desc', label: t('sort.titleDesc') },
  ];

  const columnSortOptions = [
    { value: 'updated:desc', label: t('kanban.newest') },
    { value: 'updated:asc', label: t('kanban.oldest') },
    { value: 'title:asc', label: t('kanban.titleAsc') },
    { value: 'title:desc', label: t('kanban.titleDesc') },
    { value: 'created:desc', label: t('kanban.createdNewest') },
  ];

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, note: NoteItem) => {
    if (readOnly) return;
    e.dataTransfer.setData('text/plain', note.path);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedNotePath(note.path);
  };

  const handleDragEnd = () => {
    setDraggedNotePath(null);
    setDragOverColumnId(null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, columnId: string) => {
    if (readOnly) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumnId !== columnId) {
      setDragOverColumnId(columnId);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverColumnId(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetStatus: string) => {
    if (readOnly) return;
    e.preventDefault();
    setDragOverColumnId(null);
    const notePath = e.dataTransfer.getData('text/plain') || draggedNotePath;
    setDraggedNotePath(null);

    if (!notePath) return;
    const note = notes.find((n) => n.path === notePath);
    if (note && note.status !== targetStatus) {
      onUpdateNoteStatus(note, targetStatus);
    }
  };

  return (
    <div className="flex flex-col h-full select-none">
      {/* Kanban Top Toolbar */}
      <div className="flex items-center justify-between px-2 mb-3 flex-wrap gap-2 text-xs shrink-0">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-medium">
          <KanbanIcon className="w-4 h-4 text-indigo-500 shrink-0" />
          <span>{t('kanban.columns', { count: columns.length })}</span>
          <span>·</span>
          <span>{t('kanban.notes', { count: notes.length })}</span>
        </div>

        {onSortChange && (
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium whitespace-nowrap">{t('kanban.sortBy')}</span>
            <Select
              aria-label={t('kanban.sortBy')}
              value={boardSortKey}
              onValueChange={(val) => {
                const [f, o] = val.split(':') as [SortField, SortOrder];
                setColumnSorts({});
                onSortChange(f, o);
              }}
              options={boardSortOptions}
              className="font-medium"
            />
          </div>
        )}
      </div>

      {/* Kanban Columns List */}
      <div className="flex gap-5 overflow-x-auto pt-1 px-1 pb-6 flex-1 items-start">
        {columns.map((col, index) => {
          const rawColNotes = notes.filter((n) => n.status === col.id);
          const colSort = columnSorts[col.id] || {
            field: effectiveBoardSortField,
            order: sortOrder,
          };
          const colNotes = sortNotes(rawColNotes, colSort.field, colSort.order);
          const isColumnDragOver = dragOverColumnId === col.id;

          return (
            <div
              key={col.id}
              data-status-column={col.id}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.id)}
              className={`w-80 rounded-xl p-3 flex flex-col max-h-full shrink-0 border transition-colors shadow-xs ${
                isColumnDragOver ? '' : 'border-slate-200/80 dark:border-slate-800'
              }`}
              style={{
                backgroundColor: isColumnDragOver
                  ? 'var(--color-primary-light)'
                  : 'var(--color-surface)',
                borderColor: isColumnDragOver
                  ? 'var(--color-primary)'
                  : 'var(--color-border)',
                boxShadow: isColumnDragOver
                  ? '0 0 0 2px var(--color-primary), 0 8px 20px -4px var(--color-primary-light)'
                  : undefined,
              }}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      col.id === 'inbox' ? '' : col.color
                    }`}
                    style={
                      col.id === 'inbox'
                        ? { backgroundColor: 'var(--color-primary)' }
                        : undefined
                    }
                  />
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm truncate">
                    {col.title}
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400 font-medium shrink-0">
                    {colNotes.length}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Column Sort Selector */}
                  <Select
                    aria-label={`${t('kanban.columnSort')} ${col.title}`}
                    value={`${colSort.field}:${colSort.order}`}
                    onValueChange={(val) => {
                      const [f, o] = val.split(':') as [SortField, SortOrder];
                      setColumnSorts((prev) => ({
                        ...prev,
                        [col.id]: { field: f, order: o },
                      }));
                    }}
                    options={columnSortOptions}
                    className="min-h-7 px-1.5 py-1 text-[11px] font-medium"
                  />

                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => onNewNoteWithStatus(col.id)}
                      className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition"
                      title={t('kanban.addNoteTo', { title: col.title })}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Note Cards List (Drag Target Area) */}
              <div className="overflow-y-auto space-y-2.5 flex-1 pr-0.5 min-h-[80px]">
                {/* Drop Target Guide Indicator */}
                {isColumnDragOver && draggedNotePath && (
                  <div
                    className="border-2 border-dashed rounded-lg p-3 text-center text-xs font-semibold animate-pulse transition my-1"
                    style={{
                      borderColor: 'var(--color-primary)',
                      color: 'var(--color-primary)',
                      backgroundColor: 'var(--color-primary-light)',
                    }}
                  >
                    {t('kanban.dropNoteInto', { title: col.title })}
                  </div>
                )}

                {colNotes.length === 0 && !isColumnDragOver ? (
                  <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                    {readOnly ? t('kanban.noNotes') : t('kanban.dragNotesHere')}
                  </div>
                ) : (
                  colNotes.map((note) => {
                    const isBeingDragged = draggedNotePath === note.path;
                    const formattedDate = note.mtime
                      ? new Date(note.mtime).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })
                      : '—';

                    return (
                      <div
                        key={note.path}
                        data-notepath={note.path}
                        draggable={!readOnly}
                        onDragStart={(e) => handleDragStart(e, note)}
                        onDragEnd={handleDragEnd}
                        onClick={() => onOpenNote(note)}
                        className={`p-3 rounded-lg border transition-all cursor-grab active:cursor-grabbing group shadow-xs ${
                          isBeingDragged
                            ? 'opacity-40 scale-[0.98] border-indigo-400 dark:border-indigo-500 shadow-inner'
                            : 'hover:shadow-sm hover:border-slate-400'
                        }`}
                        style={{
                          backgroundColor: 'var(--color-surface)',
                          borderColor: isBeingDragged
                            ? 'var(--color-primary)'
                            : 'var(--color-border)',
                        }}
                      >
                        <div className="flex items-start justify-between gap-1 mb-1.5">
                          <div className="font-medium text-slate-900 dark:text-slate-100 text-sm line-clamp-2 transition">
                            {note.title}
                          </div>
                          <GripVertical className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0 opacity-0 group-hover:opacity-100 transition" />
                        </div>

                        {note.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2.5">
                            {note.tags.map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400 rounded text-[10px]"
                              >
                                <Tag className="w-2 h-2 text-slate-400" />
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Card Actions & Timestamp */}
                        <div
                          className="flex items-center justify-between pt-2 border-t text-slate-400 text-xs"
                          style={{ borderColor: 'var(--color-border)' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <span className="flex items-center gap-1 text-[11px]">
                              <Clock className="w-3 h-3 text-slate-400" />
                              {formattedDate}
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            {!readOnly && index > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateNoteStatus(note, columns[index - 1].id)
                                }
                                title={t('kanban.moveTo', { title: columns[index - 1].title })}
                                className="p-1 hover:text-indigo-600 dark:hover:text-indigo-400 rounded hover:bg-black/5 dark:hover:bg-white/10 transition"
                              >
                                <ArrowLeft className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {!readOnly && index < columns.length - 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateNoteStatus(note, columns[index + 1].id)
                                }
                                title={t('kanban.moveTo', { title: columns[index + 1].title })}
                                className="p-1 hover:text-indigo-600 dark:hover:text-indigo-400 rounded hover:bg-black/5 dark:hover:bg-white/10 transition"
                              >
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {!readOnly && canDelete && (
                              <button
                                type="button"
                                onClick={() => onDeleteNote(note)}
                                title={t('notes.delete')}
                                className="p-1 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition opacity-40 hover:opacity-100"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}

        {/* Unassigned / No Status Column */}
        {unassignedNotes.length > 0 && (
          <div
            onDragOver={(e) => handleDragOver(e, '')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, '')}
            className="w-80 rounded-xl p-3 flex flex-col max-h-full shrink-0 border border-dashed shadow-xs"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
            }}
          >
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                  {t('kanban.noStatus')}
                </h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400 font-medium">
                  {unassignedNotes.length}
                </span>
              </div>
            </div>

            <div className="overflow-y-auto space-y-2.5 flex-1 pr-0.5">
              {sortNotes(unassignedNotes, effectiveBoardSortField, sortOrder).map((note) => (
                <div
                  key={note.path}
                  draggable={!readOnly}
                  onDragStart={(e) => handleDragStart(e, note)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onOpenNote(note)}
                  className="p-3 rounded-lg border hover:shadow-xs transition cursor-grab active:cursor-grabbing"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                  }}
                >
                  <div className="font-medium text-slate-900 dark:text-slate-100 text-sm mb-1 line-clamp-2">
                    {note.title}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
