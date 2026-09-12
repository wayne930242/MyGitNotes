import React, { useState } from 'react';
import { GitCommit, AlertCircle, Trash2, RotateCcw, X } from 'lucide-react';
import { GitStatus, NoteItem } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';

interface FloatingCommitFooterProps {
  gitStatus: GitStatus | null;
  onOpenCommitModal: () => void;
  deletedNotes?: NoteItem[];
  onRestoreNote?: (note: NoteItem) => void;
}

export const FloatingCommitFooter: React.FC<FloatingCommitFooterProps> = ({
  gitStatus,
  onOpenCommitModal,
  deletedNotes = [],
  onRestoreNote,
}) => {
  const { t } = useTranslation();
  const [showTrashPopover, setShowTrashPopover] = useState(false);

  const modifiedCount = gitStatus?.modified.length || 0;
  const untrackedCount = gitStatus?.untracked.length || 0;
  const stagedCount = gitStatus?.staged.length || 0;
  const dirtyCount = modifiedCount + untrackedCount + stagedCount;

  if (dirtyCount === 0 && deletedNotes.length === 0) {
    return null;
  }

  return (
    <div className="commit-footer fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in fade-in slide-in-from-bottom-5 duration-200">
      <div className="relative bg-slate-900/95 dark:bg-slate-900/95 text-white backdrop-blur-md px-4 py-2 rounded-2xl shadow-2xl shadow-slate-950/40 border border-slate-700/80 flex items-center gap-3">
        {/* Compact Dirty Status Indicator (Requirement 2) */}
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          </span>

          <span className="font-semibold text-amber-300 text-xs flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{t('footer.dirtyCount', { count: dirtyCount })}</span>
          </span>
        </div>

        {/* Trash Popover Toggle for Uncommitted Deleted Notes (Requirement 2) */}
        {deletedNotes.length > 0 && onRestoreNote && (
          <>
            <div className="h-3.5 w-px bg-slate-700/80" />
            <button
              onClick={() => setShowTrashPopover(!showTrashPopover)}
              className="flex items-center gap-1 px-2.5 py-1 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-medium transition active:scale-95"
              title={t('footer.viewTrashTooltip')}
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>{t('footer.trash', { count: deletedNotes.length })}</span>
            </button>

            {/* Trash Popover */}
            {showTrashPopover && (
              <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-80 max-w-[calc(100vw-2rem)] bg-slate-900 text-white rounded-2xl p-3.5 shadow-2xl border border-slate-700/80 animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-300">
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t('footer.uncommittedTrash', { count: deletedNotes.length })}</span>
                  </div>
                  <button
                    onClick={() => setShowTrashPopover(false)}
                    className="p-1 text-slate-400 hover:text-white rounded-md transition"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="max-h-60 overflow-y-auto space-y-2">
                  {deletedNotes.map((dn) => (
                    <div
                      key={dn.path}
                      className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs"
                    >
                      <div className="truncate">
                        <div className="font-semibold text-slate-200 truncate">{dn.title}</div>
                        <div className="text-[10px] text-slate-400 font-mono truncate">{dn.path}</div>
                      </div>
                      <button
                        onClick={() => {
                          onRestoreNote(dn);
                          if (deletedNotes.length <= 1) setShowTrashPopover(false);
                        }}
                        className="flex items-center gap-1 px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-[11px] font-medium transition shrink-0"
                        title={t('footer.restoreNoteTooltip', { title: dn.title })}
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{t('footer.restore')}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="h-3.5 w-px bg-slate-700/80" />

        {/* Commit Action Button */}
        <button
          onClick={onOpenCommitModal}
          style={{ backgroundColor: 'var(--color-primary)' }}
          className="flex items-center gap-1.5 px-3 py-1 hover:opacity-90 text-white rounded-xl text-xs font-semibold shadow-md transition active:scale-95 shrink-0"
          title={t('footer.reviewDiffTooltip')}
        >
          <GitCommit className="w-3.5 h-3.5" />
          <span>{t('footer.commit')}</span>
        </button>
      </div>
    </div>
  );
};
