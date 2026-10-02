import { useEffect, useState } from 'react';
import { GitCommit, RefreshCw, RotateCcw } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';

/** How long a first click keeps an action armed for its confirming second click. */
const ARM_MS = 3000;

/**
 * Refresh pulls the note's latest version at once. Commit and Restore appear for a dirty note only
 * and each runs on a second click while armed.
 */
export function NoteQuickActions({ onRefresh, onCommit, onRestore, disabled }: { onRefresh?: () => Promise<void>; onCommit?: () => Promise<void>; onRestore?: () => Promise<void>; disabled: boolean; }) {
  const { t } = useTranslation();
  const [armed, setArmed] = useState<'commit' | 'restore' | null>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  const press = (action: 'commit' | 'restore', run: () => Promise<void>) => {
    if (disabled) return;
    if (armed !== action) return setArmed(action);
    setArmed(null);
    void run();
  };
  return (
    <div className='note-quick-actions flex items-center gap-2'>
      {onRefresh && (
        <button
          type='button'
          className='note-quick-action'
          data-action='refresh'
          disabled={disabled}
          title={t('editor.quickRefreshHint')}
          onClick={() => !disabled && void onRefresh()}
        >
          <RefreshCw aria-hidden='true' />
          <span>{t('editor.quickRefresh')}</span>
        </button>
      )}
      {onRestore && (
        <button type='button' className='note-quick-action' data-action='restore' data-armed={armed === 'restore' || undefined} disabled={disabled} title={t('editor.quickRestoreHint')} onClick={() => press('restore', onRestore)}>
          <RotateCcw aria-hidden='true' />
          <span>{t(armed === 'restore' ? 'editor.confirmQuickRestore' : 'editor.quickRestore')}</span>
        </button>
      )}
      {onCommit && (
        <button type='button' className='note-quick-action' data-action='commit' data-armed={armed === 'commit' || undefined} disabled={disabled} title={t('editor.quickCommitHint')} onClick={() => press('commit', onCommit)}>
          <GitCommit aria-hidden='true' />
          <span>{t(armed === 'commit' ? 'editor.confirmQuickCommit' : 'editor.quickCommit')}</span>
        </button>
      )}
    </div>
  );
}
