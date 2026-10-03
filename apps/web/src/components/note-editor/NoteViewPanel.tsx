import { NOTE_CONTENT_WIDTHS, NOTE_FONT_SIZES, type NoteContentWidth, useNoteViewPreferences, writeNoteViewPreferences } from '../../lib/editor-preferences.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { PALETTE_FAMILIES } from '../../lib/palettes.js';
import { setThemeChoice, type ThemeMode } from '../../lib/themes.js';
import { useThemeChoice } from '../../app/useTheme.js';
import { Select } from '../Select.js';

const WIDTH_LABELS = { standard: 'editor.widthStandard', wide: 'editor.widthWide', full: 'editor.widthFull' } as const;
const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];

/** The document panel's view section: theme and body text size everywhere, page width on desktop only. */
export function NoteViewPanel() {
  const { t } = useTranslation();
  const { fontSize, contentWidth } = useNoteViewPreferences();
  const theme = useThemeChoice();
  return (
    <section className='note-view-panel note-panel-scroll' aria-label={t('editor.viewSettings')}>
      <fieldset className='note-view-group'>
        <legend>{t('editor.theme')}</legend>
        <div className='note-view-theme'>
          <Select aria-label={t('settings.theme')} value={theme.familyId} onValueChange={familyId => setThemeChoice({ ...theme, familyId })} options={PALETTE_FAMILIES.map(family => ({ value: family.id, label: family.name }))} />
          <Select aria-label={t('theme.mode')} value={theme.mode} onValueChange={mode => setThemeChoice({ ...theme, mode: mode as ThemeMode })} options={THEME_MODES.map(mode => ({ value: mode, label: t(`theme.${mode}`) }))} />
        </div>
      </fieldset>
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
