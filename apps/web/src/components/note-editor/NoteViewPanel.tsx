import { NOTE_CONTENT_WIDTHS, NOTE_FONT_SIZES, type NoteContentWidth, useNoteViewPreferences, writeNoteViewPreferences } from '../../lib/editor-preferences.js';
import { useTranslation } from '../../lib/i18n/index.js';

const WIDTH_LABELS = { standard: 'editor.widthStandard', wide: 'editor.widthWide', full: 'editor.widthFull' } as const;

/** The document panel's view section: body text size everywhere, page width on desktop only. */
export function NoteViewPanel() {
  const { t } = useTranslation();
  const { fontSize, contentWidth } = useNoteViewPreferences();
  return (
    <section className='note-view-panel note-panel-scroll' aria-label={t('editor.viewSettings')}>
      <fieldset className='note-view-group'>
        <legend>{t('editor.fontSize')}</legend>
        <div className='note-view-options'>{NOTE_FONT_SIZES.map(size => <button key={size} type='button' aria-pressed={fontSize === size} title={`${size}px`} onClick={() => writeNoteViewPreferences({ fontSize: size })}>{t(`editor.fontSize${size}`)}</button>)}</div>
      </fieldset>
      <fieldset className='note-view-group note-view-width'>
        <legend>{t('editor.pageWidth')}</legend>
        <div className='note-view-options'>{(Object.keys(NOTE_CONTENT_WIDTHS) as NoteContentWidth[]).map(width => <button key={width} type='button' aria-pressed={contentWidth === width} onClick={() => writeNoteViewPreferences({ contentWidth: width })}>{t(WIDTH_LABELS[width])}</button>)}</div>
      </fieldset>
      <p className='note-view-hint'>{t('editor.viewHint')}</p>
    </section>
  );
}
