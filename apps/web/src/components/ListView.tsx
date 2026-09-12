import React from 'react';
import { FileText, Tag, Clock, Trash2, Plus } from 'lucide-react';
import { NoteStatusSelect } from './NoteStatusSelect.js';
import { NoteItem } from '../lib/types.js';

interface ListViewProps {
  notes: NoteItem[];
  statuses: string[];
  readOnly?: boolean;
  canDelete?: boolean;
  onOpenNote: (note: NoteItem) => void;
  onDeleteNote: (note: NoteItem) => void;
  onUpdateNoteStatus: (note: NoteItem, newStatus: string) => void;
  onNewNote: () => void;
}

export const ListView: React.FC<ListViewProps> = ({
  notes,
  statuses,
  readOnly = false,
  canDelete = true,
  onOpenNote,
  onDeleteNote,
  onUpdateNoteStatus,
  onNewNote,
}) => {
  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center px-4">
        <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
          <FileText className="w-6 h-6" />
        </div>
        <h3 className="text-base font-medium text-slate-800 dark:text-slate-200 mb-1">No notes found</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-4">
          No notes match your current filters, or this notebook is empty.
        </p>
        {!readOnly && (<button
          onClick={onNewNote}
          style={{ backgroundColor: 'var(--color-primary)' }}
          className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg shadow-sm transition hover:opacity-90 active:scale-95"
        >
          <Plus className="w-4 h-4" />
          Create Note
        </button>)}
      </div>
    );
  }


  return (
    <div
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
              <th className="py-3 px-4">Title</th>
              <th className="py-3 px-4 w-36">Status</th>
              <th className="py-3 px-4">Tags</th>
              <th className="py-3 px-4 w-36">Modified</th>
              <th className="py-3 px-4 w-16 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {notes.map((note) => {
              const formattedDate = note.mtime
                ? new Date(note.mtime).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '—';

              return (
                <tr
                  key={note.path}
                  onClick={() => onOpenNote(note)}
                  className="hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer group"
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                      <div>
                        <div className="font-medium text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
                          {note.title}
                        </div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 font-mono">
                          {note.path}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* In-Table Selectable Status (Requirement 3) */}
                  <td className="py-3 px-4">
                    <NoteStatusSelect statuses={statuses} status={note.status} readOnly={readOnly} label={`Status for ${note.title}`} onChange={status => onUpdateNoteStatus(note, status)} />
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1">
                      {note.tags.length > 0 ? (
                        note.tags.map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded text-xs"
                          >
                            <Tag className="w-2.5 h-2.5 text-slate-400" />
                            {t}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </div>
                  </td>

                  <td className="py-3 px-4 text-xs text-slate-500 dark:text-slate-400 flex-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{formattedDate}</span>
                    </div>
                  </td>

                  {/* Actions Column: Edit removed, only Trash remains (Requirement 1) */}
                  <td className="py-3 px-4 text-right">
                    <div
                      className="flex items-center justify-end opacity-40 hover:opacity-100 group-hover:opacity-100 transition"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!readOnly && canDelete && (<button
                        onClick={() => onDeleteNote(note)}
                        title="Delete note (can be restored before commit)"
                        className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
