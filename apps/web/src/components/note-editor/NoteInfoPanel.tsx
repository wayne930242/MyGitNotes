import type { NoteRef } from '@mygitnotes/core/note-query';
import { useTranslation } from '../../lib/i18n/index.js';
import { useNoteLocation } from '../../lib/note-location.js';

/** The document panel's info section: the note's notebook, repository, branch, path and whether it can be edited. */
export function NoteInfoPanel({ note }: { note: NoteRef; }) {
  const { t } = useTranslation();
  const location = useNoteLocation(note);
  if (!location) return null;
  const rows: [string, string][] = [[t('editor.infoNotebook'), location.notebook], [t('editor.infoRepository'), location.repository], [t('editor.infoBranch'), location.branch], [t('editor.infoPath'), location.path]];
  return (
    <section className='note-info-panel note-panel-scroll' aria-label={t('editor.info')}>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || '—'}</dd>
          </div>
        ))}
        <div>
          <dt>{t('editor.infoWrite')}</dt>
          <dd>{location.readOnly ? t(`editor.infoReadOnly.${location.readOnly}`) : t('editor.infoWritable')}</dd>
        </div>
      </dl>
    </section>
  );
}
