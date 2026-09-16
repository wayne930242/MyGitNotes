import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { GitStatus } from '../lib/types.js';
import { GitSyncError, syncGitWorkspace } from '../lib/api.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';

interface Conflict { files: string[]; unresolved: boolean }

/** Pull --rebase and push for a local workspace; conflicts are aborted and offered as explicit choices. */
export function GitSyncSection({ gitStatus, onSynced }: { gitStatus: GitStatus | null; onSynced: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [conflict, setConflict] = useState<Conflict>();
  const upstream = gitStatus?.upstream;
  const dirty = Boolean(gitStatus?.staged.length || gitStatus?.modified.length);

  const sync = async (strategy?: 'remote' | 'local') => {
    setBusy(true); setNotice(''); setError(''); setConflict(undefined);
    try {
      const result = await syncGitWorkspace(strategy);
      const summary = result.pulled || result.pushed ? t('panel.syncDone', { pulled: result.pulled, pushed: result.pushed }) : t('panel.syncUpToDate');
      setNotice(result.backup ? `${summary} ${t('panel.syncBackup', { ref: result.backup })}` : summary);
    } catch (failure) {
      if (failure instanceof GitSyncError && (failure.code === 'CONFLICT' || failure.code === 'UNRESOLVED')) {
        setConflict({ files: failure.files, unresolved: failure.code === 'UNRESOLVED' });
      } else setError((failure as Error).message);
    } finally {
      setBusy(false);
      onSynced();
    }
  };

  return (
    <section className="todo-group git-sync" aria-label={t('panel.sync')}>
      <h4>{t('panel.sync')}</h4>
      {upstream
        ? <p className="git-sync-status" title={t('panel.syncStatusHint')}>{t('panel.syncStatus', { upstream, ahead: gitStatus?.ahead ?? 0, behind: gitStatus?.behind ?? 0 })}</p>
        : <p className="changes-help">{t('panel.syncNoUpstream')}</p>}
      {upstream && dirty && <p className="changes-help">{t('panel.syncDirty')}</p>}
      <Button className="git-sync-button" disabled={busy || !upstream || dirty} onClick={() => void sync()}>
        <RefreshCw aria-hidden="true" size={14} className={busy ? 'animate-spin' : ''} />
        <span>{t(busy ? 'panel.syncing' : 'panel.syncNow')}</span>
      </Button>
      {conflict && (
        <div className="changes-confirm git-sync-conflict" role="alert">
          <p>{t(conflict.unresolved ? 'panel.syncUnresolved' : 'panel.syncConflict')}</p>
          <ul className="changes-file-list">{conflict.files.map(file => <li key={file} className="changes-file-label" title={file}>{file}</li>)}</ul>
          {!conflict.unresolved && <>
            <Button disabled={busy} onClick={() => void sync('remote')}>{t('panel.syncUseRemote')}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void sync('local')}>{t('panel.syncUseLocal')}</Button>
          </>}
          <Button disabled={busy} onClick={() => { setConflict(undefined); setNotice(t('panel.syncManualHint')); }}>{t('panel.syncManual')}</Button>
        </div>
      )}
      {error && <p role="alert" className="changes-error">{error}</p>}
      {notice && <p role="status" className="changes-help">{notice}</p>}
    </section>
  );
}
