import { useTranslation } from '../../lib/i18n/index.js';
import type { NoteDocumentPanelState } from './useNoteDocumentPanel.js';

/** The keyboard leader menu: the next key opens find, or the outline of a Markdown note. */
export function NoteEditorLeader({ docPanel, isMarkdown }: { docPanel: NoteDocumentPanelState; isMarkdown: boolean; }) {
  const { t } = useTranslation();
  return (
    <div className='note-editor-leader' role='dialog' aria-modal='false' aria-label={t('editor.noteCommands')}>
      <div>
        <strong>{t('editor.noteCommands')}</strong>
        <small>{t('editor.leaderHint')}</small>
      </div>
      <button type='button' onClick={docPanel.openFind}>
        <kbd>F</kbd>
        <span>{t('editor.findInNote')}</span>
      </button>
      {isMarkdown && (
        <button type='button' onClick={docPanel.openOutline}>
          <kbd>/</kbd>
          <span>{t('editor.outline')}</span>
        </button>
      )}
    </div>
  );
}
