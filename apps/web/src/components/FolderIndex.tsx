import { useMemo } from 'react';
import { FileText } from 'lucide-react';
import type { NoteItem } from '../lib/types.js';
import { renderNote } from '../lib/markdown.js';
import { useTranslation } from '../lib/i18n/index.js';

export function FolderIndex({ note, onOpenNote }: {
  note: NoteItem;
  onOpenNote: (note: NoteItem) => void;
}) {
  const { t } = useTranslation();
  const html = useMemo(() => renderNote(note.content, note.path), [note.content, note.path]);
  return <section className="folder-index" data-folder-index aria-label={t('folder.index')}>
    <div className="folder-index-header">
      <span><FileText aria-hidden="true" />{t('folder.index')}</span>
      <button type="button" className="ui-button" onClick={() => onOpenNote(note)}>{t('folder.openIndex')}</button>
    </div>
    {note.content.trim()
      ? <div className="prose-custom folder-index-content" data-markdown-view dangerouslySetInnerHTML={{ __html: html }} />
      : <p className="folder-index-empty">{t('notes.noContent')}</p>}
  </section>;
}
