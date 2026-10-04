import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownToLine, X } from 'lucide-react';
import { GitSyncError, syncGitWorkspace } from '../lib/api.js';
import { useTranslation } from '../lib/i18n/index.js';

interface Toast {
  message: string;
  failed: boolean;
}

const SUCCESS_TOAST_MS = 3000;

/** Pulls the home worktree's main from its upstream without pushing, stashing uncommitted changes around it; a failure stays in a toast until dismissed. */
export function GitPullButton({ onPulled }: { onPulled: () => Promise<void> | void; }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>();

  useEffect(() => {
    if (!toast || toast.failed) return;
    const timer = window.setTimeout(() => setToast(undefined), SUCCESS_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const pull = async () => {
    setBusy(true);
    setToast(undefined);
    try {
      const { pulled } = await syncGitWorkspace(undefined, undefined, true);
      setToast({ message: pulled ? t('sidebar.pulled', { count: pulled }) : t('sidebar.pullUpToDate'), failed: false });
      if (pulled) await onPulled();
    } catch (failure) {
      setToast({ message: t('sidebar.pullFailed', { message: (failure as Error).message }), failed: true });
      // The pull itself landed; only the stashed changes stayed behind, so the files on disk moved.
      if (failure instanceof GitSyncError && failure.code === 'STASH_CONFLICT') await onPulled();
    } finally {
      setBusy(false);
    }
  };

  const label = t(busy ? 'sidebar.pulling' : 'sidebar.pull');
  return (
    <>
      <button type='button' className='ui-icon-button git-pull-button' title={label} aria-label={label} aria-busy={busy} disabled={busy} onClick={() => void pull()}>
        <ArrowDownToLine size={15} className={busy ? 'animate-pulse' : ''} />
      </button>
      {toast && createPortal(
        // Sits above the sidebar footer so the toast never covers the pull button itself.
        <div className='fixed bottom-24 left-4 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200'>
          <div role={toast.failed ? 'alert' : 'status'} className={`bg-surface/95 backdrop-blur-md px-4 py-3 rounded-xl shadow-xl border border-line/80 flex items-center gap-3 text-xs max-w-sm ${toast.failed ? 'text-danger' : 'text-fg'}`}>
            <span className='break-words min-w-0'>{toast.message}</span>
            <button type='button' aria-label={t('common.close')} onClick={() => setToast(undefined)} className='text-muted hover:text-fg p-1 rounded hover:bg-fg/10 transition shrink-0'>
              <X className='w-3.5 h-3.5' />
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
