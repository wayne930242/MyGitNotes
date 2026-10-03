import { X } from 'lucide-react';
import { CrashRecoveryBanner } from '../CrashRecoveryBanner.js';
import { EditorNotice } from '../EditorNotice.js';
import { type TranslationKey, useTranslation } from '../../lib/i18n/index.js';
import type { NoteEditorSessionState } from './useNoteEditorSession.js';

/** The editor's notices: crash recovery, a save error, and the remote change or conflict notice. */
export function NoteEditorNotices({ session, notePath }: { session: NoteEditorSessionState; notePath: string; }) {
  const { t } = useTranslation();
  const { recoveredDraft, blocked } = session;
  return (
    <div className='editor-notices'>
      {/* Crash recovery banner if draft differs from disk */}
      {recoveredDraft && !blocked && <CrashRecoveryBanner draft={{ path: notePath, content: recoveredDraft.content, metadata: recoveredDraft.metadata, savedAt: recoveredDraft.savedAt }} onRestore={session.handleRestoreDraft} onDiscard={session.handleDiscardDraft} />}
      {session.saveError && <EditorNotice tone='error'>{t(session.saveError as TranslationKey, session.saveErrorParams)}</EditorNotice>}
      {(blocked || session.showRemoteNotice || session.showConflictDraftNotice) && (
        <EditorNotice
          actions={
            <>
              {blocked && <button disabled={session.isSaving} onClick={session.refreshRemote} className='font-semibold underline hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition'>{t('editor.refreshRemote')}</button>}
              {session.conflictDraft && <button onClick={session.downloadConflictDraft} className='underline hover:opacity-80 transition'>{t('editor.downloadPreservedDraft')}</button>}
              {!blocked && (
                <button type='button' aria-label={t('editor.dismissNotice')} title={t('editor.dismissNotice')} onClick={session.dismissNotice} className='ui-icon-button'>
                  <X aria-hidden='true' />
                </button>
              )}
            </>
          }
        >
          {session.showRemoteNotice ? t(session.remoteNotice as TranslationKey) : t('editor.localChangesPreserved')}
        </EditorNotice>
      )}
    </div>
  );
}
