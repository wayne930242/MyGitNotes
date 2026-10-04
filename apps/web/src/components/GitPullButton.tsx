import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownToLine, X } from 'lucide-react';
import { GitSyncError, syncGitWorkspace } from '../lib/api.js';
import { copyToClipboard } from '../lib/clipboard.js';
import { useTranslation } from '../lib/i18n/index.js';
import { type PullFailure, pullFailurePrompt } from '../lib/pull-failure-prompt.js';
import { Button } from './Button.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';

const SUCCESS_TOAST_MS = 3000;

/**
 * Pulls the home worktree's main from its upstream without pushing, stashing uncommitted changes around it.
 * Success shows a short toast; a failure opens a dialog with a prompt the user can hand to a local coding agent.
 */
export function GitPullButton({ onPulled, repoRoot }: { onPulled: () => Promise<void> | void; repoRoot: string; }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState<PullFailure>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), SUCCESS_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const pull = async () => {
    setBusy(true);
    setNotice('');
    try {
      const { pulled } = await syncGitWorkspace(undefined, undefined, true);
      setNotice(pulled ? t('sidebar.pulled', { count: pulled }) : t('sidebar.pullUpToDate'));
      if (pulled) await onPulled();
    } catch (error) {
      const sync = error instanceof GitSyncError ? error : undefined;
      setCopied(false);
      setFailure({ code: sync?.code ?? 'FAILED', message: (error as Error).message, files: sync?.files ?? [] });
      // The pull itself landed; only the stashed changes stayed behind, so the files on disk moved.
      if (sync?.code === 'STASH_CONFLICT') await onPulled();
    } finally {
      setBusy(false);
    }
  };

  const prompt = failure ? pullFailurePrompt(failure, repoRoot) : '';
  const label = t(busy ? 'sidebar.pulling' : 'sidebar.pull');
  return (
    <>
      <button type='button' className='ui-icon-button git-pull-button' title={label} aria-label={label} aria-busy={busy} disabled={busy} onClick={() => void pull()}>
        <ArrowDownToLine size={15} className={busy ? 'animate-pulse' : ''} />
      </button>
      {notice && createPortal(
        // Sits above the sidebar footer so the toast never covers the pull button itself.
        <div className='fixed bottom-24 left-4 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200'>
          <div role='status' className='bg-surface/95 backdrop-blur-md px-4 py-3 rounded-xl shadow-xl border border-line/80 flex items-center gap-3 text-xs max-w-sm text-fg'>
            <span className='break-words min-w-0'>{notice}</span>
            <button type='button' aria-label={t('common.close')} onClick={() => setNotice('')} className='text-muted hover:text-fg p-1 rounded hover:bg-fg/10 transition shrink-0'>
              <X className='w-3.5 h-3.5' />
            </button>
          </div>
        </div>,
        document.body,
      )}
      {failure && (
        <WorkspaceDialog title={t('sidebar.pullFailedTitle')} onClose={() => setFailure(undefined)} className='git-pull-dialog'>
          <p role='alert' className='changes-error'>{failure.message}</p>
          {failure.files.length > 0 && <ul className='changes-file-list'>{failure.files.map(file => <li key={file} className='changes-file-label' title={file}>{file}</li>)}</ul>}
          <p className='changes-help'>{t('sidebar.pullPromptHint')}</p>
          <textarea className='git-pull-prompt' readOnly rows={8} value={prompt} aria-label={t('sidebar.pullPromptHint')} />
          <div className='workspace-dialog-actions'>
            <Button onClick={() => setFailure(undefined)}>{t('common.close')}</Button>
            <Button variant='primary' onClick={async event => setCopied(await copyToClipboard(prompt, event.currentTarget.closest('dialog')?.querySelector('textarea')))}>{t(copied ? 'common.copied' : 'sidebar.pullCopyPrompt')}</Button>
          </div>
        </WorkspaceDialog>
      )}
    </>
  );
}
