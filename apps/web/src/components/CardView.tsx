import React from 'react';
import { FileText, Tag, Clock, Trash2, Plus, Folder, ChevronRight } from 'lucide-react';
import { NoteStatusSelect } from './NoteStatusSelect.js';
import { NoteItem } from '../lib/types.js';
import { SubfolderInfo } from '../lib/folder-tree.js';
import { useTranslation } from '../lib/i18n/index.js';

interface CardViewProps {
  notes: NoteItem[];
  subfolders?: SubfolderInfo[];
  statuses: string[];
  readOnly?: boolean;
  canDelete?: boolean;
  onOpenNote: (note: NoteItem) => void;
  onDeleteNote: (note: NoteItem) => void;
  onNewNote: () => void;
  onUpdateNoteStatus: (note: NoteItem, status: string) => void;
  onSelectFolder?: (folder: string | null) => void;
}

export const CardView: React.FC<CardViewProps> = ({
  notes,
  subfolders = [],
  statuses,
  readOnly = false,
  canDelete = true,
  onOpenNote,
  onDeleteNote,
  onNewNote,
  onUpdateNoteStatus,
  onSelectFolder,
}) => {
  const { t } = useTranslation();

  const isEmpty = notes.length === 0 && subfolders.length === 0;

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
          <button
            onClick={onNewNote}
            style={{ backgroundColor: 'var(--color-primary)' }}
            className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg shadow-sm transition hover:opacity-90 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            {t('notes.createNote')}
          </button>
        )}
      </div>
    );
  }

  const getExcerpt = (content: string) => {
    const clean = content
      .replace(/^#+\s+.+$/gm, '')
      .replace(/[*_`]/g, '')
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .trim();
    return clean.slice(0, 140) + (clean.length > 140 ? '...' : '');
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {/* Subfolder Cards */}
      {subfolders.map((folder) => (
        <div
          key={`card-subfolder-${folder.path}`}
          onClick={() => onSelectFolder?.(folder.path)}
          style={{
            backgroundColor: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
          }}
          className="rounded-xl border hover:border-indigo-400 dark:hover:border-indigo-500/80 p-5 flex flex-col justify-between shadow-xs hover:shadow-md hover:-translate-y-0.5 transition cursor-pointer group select-none relative overflow-hidden"
        >
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center transition shadow-xs"
                style={{
                  backgroundColor: 'var(--color-primary-light)',
                  color: 'var(--color-primary)',
                }}
              >
                <Folder className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400">
                {folder.noteCount} {folder.noteCount === 1 ? t('folder.noteCount', { count: 1 }) : t('folder.notesCount', { count: folder.noteCount })}
              </span>
            </div>

            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-base line-clamp-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
              {folder.title}
            </h3>

            <p className="text-xs text-slate-400 dark:text-slate-500 font-mono line-clamp-2 mt-1">
              {folder.path}
            </p>
          </div>

          <div
            className="pt-3 border-t mt-4 flex items-center justify-between text-xs text-slate-400"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('folder.folders')}
            </span>
            <div className="flex items-center gap-1 text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
              <span className="text-[11px] font-medium">Open</span>
              <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
            </div>
          </div>
        </div>
      ))}

      {/* Note Cards */}
      {notes.map((note) => {
        const formattedDate = note.mtime
          ? new Date(note.mtime).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })
          : '—';

        return (
          <div
            key={note.path}
            onClick={() => onOpenNote(note)}
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
            }}
            className="rounded-xl border hover:border-indigo-300 dark:hover:border-indigo-600/60 p-5 flex flex-col justify-between shadow-xs hover:shadow-md transition cursor-pointer group"
          >
            <div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-base line-clamp-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
                  {note.title}
                </h3>
                <NoteStatusSelect
                  statuses={statuses}
                  status={note.status}
                  readOnly={readOnly}
                  label={`Status for ${note.title}`}
                  onChange={(status) => onUpdateNoteStatus(note, status)}
                />
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-3 mb-4 leading-relaxed">
                {getExcerpt(note.content) || (
                  <span className="italic text-slate-300 dark:text-slate-600">
                    {t('notes.noContent')}
                  </span>
                )}
              </p>
            </div>

            <div
              className="pt-3 border-t flex items-center justify-between text-xs text-slate-400"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div className="flex flex-wrap gap-1 max-w-[65%] truncate">
                {note.tags.slice(0, 2).map((tTag) => (
                  <span
                    key={tTag}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded text-[11px]"
                  >
                    <Tag className="w-2.5 h-2.5 text-slate-400" />
                    {tTag}
                  </span>
                ))}
                {note.tags.length > 2 && (
                  <span className="text-[10px] text-slate-400 self-center">
                    +{note.tags.length - 2}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-[11px]">
                  <Clock className="w-3 h-3" />
                  {formattedDate}
                </span>
                <div
                  className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition"
                  onClick={(e) => e.stopPropagation()}
                >
                  {!readOnly && canDelete && (
                    <button
                      type="button"
                      onClick={() => onDeleteNote(note)}
                      title={t('notes.delete')}
                      className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
