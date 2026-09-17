import { FileText, ChevronRight } from 'lucide-react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { useTranslation } from '../lib/i18n/index.js';

export function FolderIndex({ note, onOpenNote }: {
  note: NoteListItem;
  onOpenNote: (note: NoteListItem) => void;
}) {
  const { t } = useTranslation();
  return <button type="button" className="folder-link folder-index" data-folder-index
    onClick={() => onOpenNote(note)}>
    <FileText aria-hidden="true" />
    <span className="folder-link-title">{t('folder.index')}</span>
    <ChevronRight aria-hidden="true" className="folder-link-arrow" />
  </button>;
}
