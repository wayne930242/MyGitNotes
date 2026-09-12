import React, { useState } from 'react';
import { Plus, Tag, ArrowLeft, ArrowRight, Trash2, GripVertical } from 'lucide-react';
import { NoteItem } from '../lib/types.js';

interface KanbanViewProps {
  notes: NoteItem[];
  statuses: string[];
  readOnly?: boolean;
  canDelete?: boolean;
  onOpenNote: (note: NoteItem) => void;
  onUpdateNoteStatus: (note: NoteItem, newStatus: string) => void;
  onDeleteNote: (note: NoteItem) => void;
  onNewNoteWithStatus: (status: string) => void;
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
}) => {
  const [draggedNotePath, setDraggedNotePath] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  const columns = statuses.map(status => ({
    id: status,
    title: status,
    color: status === 'done' ? 'bg-emerald-500'
      : status === 'working' || status === 'doing' ? 'bg-sky-500'
      : status === 'archived' ? 'bg-slate-400' : 'bg-purple-500',
  }));

  const unassignedNotes = notes.filter((n) => !n.status);

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
    <div className="flex gap-5 overflow-x-auto pt-3 px-2 pb-6 h-full items-start select-none">
      {columns.map((col, index) => {
        const colNotes = notes.filter(
          (n) => n.status === col.id
        );
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
              borderColor: isColumnDragOver ? 'var(--color-primary)' : 'var(--color-border)',
              boxShadow: isColumnDragOver
                ? '0 0 0 2px var(--color-primary), 0 8px 20px -4px var(--color-primary-light)'
                : undefined,
            }}
          >
            {/* Column Header */}
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${col.id === 'inbox' ? '' : col.color}`}
                  style={col.id === 'inbox' ? { backgroundColor: 'var(--color-primary)' } : undefined}
                />
                <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                  {col.title}
                </h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400 font-medium">
                  {colNotes.length}
                </span>
              </div>

              {!readOnly && (<button
                onClick={() => onNewNoteWithStatus(col.id)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition"
                title={`Add note to ${col.title}`}
              >
                <Plus className="w-4 h-4" />
              </button>)}
            </div>

            {/* Note Cards List (Trello-like Drag Target Area) */}
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
                  Drop note into {col.title}
                </div>
              )}

              {colNotes.length === 0 && !isColumnDragOver ? (
                <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                  {readOnly ? 'No notes' : 'Drag notes here or click +'}
                </div>
              ) : (
                colNotes.map((note) => {
                  const isBeingDragged = draggedNotePath === note.path;

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
                        <div className="font-medium text-slate-900 dark:text-slate-100 text-sm line-clamp-2 transition group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
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

                      {/* Card Actions: Move left/right + Trash (Edit removed) */}
                      <div
                        className="flex items-center justify-between pt-2 border-t text-slate-400 text-xs"
                        style={{ borderColor: 'var(--color-border)' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-1">
                          {!readOnly && index > 0 && (
                            <button
                              onClick={() => onUpdateNoteStatus(note, columns[index - 1].id)}
                              title={`Move to ${columns[index - 1].title}`}
                              className="p-1 hover:text-indigo-600 dark:hover:text-indigo-400 rounded hover:bg-black/5 dark:hover:bg-white/10 transition"
                            >
                              <ArrowLeft className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!readOnly && index < columns.length - 1 && (
                            <button
                              onClick={() => onUpdateNoteStatus(note, columns[index + 1].id)}
                              title={`Move to ${columns[index + 1].title}`}
                              className="p-1 hover:text-indigo-600 dark:hover:text-indigo-400 rounded hover:bg-black/5 dark:hover:bg-white/10 transition"
                            >
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-1 opacity-40 hover:opacity-100 group-hover:opacity-100 transition">
                          {!readOnly && canDelete && (<button
                            onClick={() => onDeleteNote(note)}
                            title="Delete note (can be restored before commit)"
                            className="p-1 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>)}
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
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">No Status</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400 font-medium">
                {unassignedNotes.length}
              </span>
            </div>
          </div>

          <div className="overflow-y-auto space-y-2.5 flex-1 pr-0.5">
            {unassignedNotes.map((note) => (
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
  );
};
