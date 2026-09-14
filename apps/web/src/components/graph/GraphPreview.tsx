import { useEffect, useMemo, useRef } from 'react';
import { Maximize2, X } from 'lucide-react';
import type { NoteItem } from '../../lib/types.js';
import { renderNote } from '../../lib/markdown.js';
import { useTranslation } from '../../lib/i18n/index.js';

export function GraphPreview({ note, notebookTitle, top, onClose, onClearHover, onOpenNote }: {
  note: NoteItem; notebookTitle?: string; top: number;
  onClose: () => void; onClearHover: () => void; onOpenNote: (note: NoteItem) => void;
}) {
  const { t } = useTranslation();
  const previewCloseRef = useRef<HTMLButtonElement>(null);
  const tableLabel = t('preview.scrollableTable');
  const previewHtml = useMemo(() => renderNote(note.content, note.path, tableLabel), [note.content, note.path, tableLabel]);
  useEffect(() => { previewCloseRef.current?.focus({ preventScroll: true }); }, [note.path]);
  return (
        <aside
          aria-label={t('graph.preview')}
          onMouseEnter={onClearHover}
          style={{ top: top, maxHeight: `max(0px, calc(100% - ${top + 16}px))` }}
          className="absolute left-4 z-20 flex w-80 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-xl shadow-slate-900/10 backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95"
          onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-[10px] text-slate-400">{t('graph.preview')}</p>
              <h2 className="text-sm font-medium leading-6 text-slate-800 dark:text-slate-100 break-words">{note.title}</h2>
            </div>
            <button ref={previewCloseRef} type="button" className="ui-icon-button shrink-0" aria-label={t('common.close')} onClick={() => onClose()}><X size={15} /></button>
          </header>
          <div className="min-h-0 overflow-y-auto px-4 py-3">
            <div className="prose-custom screen-markdown" data-markdown-view dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
            <span className="truncate text-[11px] text-slate-400">{notebookTitle}</span>
            <button type="button" className="ui-button shrink-0" onClick={() => onOpenNote(note)}><Maximize2 size={13} />{t('graph.openEditor')}</button>
          </footer>
        </aside>

  );
}
