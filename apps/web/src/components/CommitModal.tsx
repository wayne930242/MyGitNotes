import { WorkspaceDialog } from './WorkspaceDialog.js';
import { Button } from './Button.js';
import { DiffPreview } from './DiffPreview.js';
import { EditorNotice } from './EditorNotice.js';
import { useEffect, useRef, useState } from 'react';
import { GitCommit, Minus, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import type { ChangeRequest, FileChange, GitStatus } from '../lib/types.js';
import { commitStagedChanges, fetchFileChanges, fetchFileDiff, generateSemanticCommit, manageFileChange } from '../lib/api.js';
import { useTranslation } from '../lib/i18n/index.js';

interface Props {
  isOpen: boolean;
  request?: ChangeRequest;
  writable: boolean;
  gitStatus: GitStatus | null;
  remoteChanges?: FileChange[];
  getPreview?: (file: string) => string;
  restoreFile?: (file: FileChange) => Promise<void>;
  commitFiles?: (files: string[], message: string) => Promise<void>;
  onChanged: () => Promise<void>;
  onCommitted: () => Promise<void>;
  onClose: () => void;
}
export const CommitModal = (props: Props) => props.isOpen ? <Changes {...props} /> : null;

function Changes({ request, writable, gitStatus, remoteChanges, getPreview, restoreFile, commitFiles, onChanged, onCommitted, onClose }: Props) {
  const { t } = useTranslation();
  const remote = Boolean(commitFiles);
  const selectionMode = request?.action === 'commit';
  const initialSelection = request?.paths || remoteChanges?.map(file => file.path) || [];
  const requestApplied = useRef(false);
  const [restoreFiles, setRestoreFiles] = useState<FileChange[]>();
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState('');
  const [localChanges, setChanges] = useState<FileChange[]>([]);
  const [included, setIncluded] = useState<string[]>(initialSelection);
  const changes = remoteChanges ? remoteChanges.map(file => ({ ...file, staged: included.includes(file.path), unstaged: !included.includes(file.path) })) : localChanges;
  const [active, setActive] = useState<{ path: string; side: 'working' | 'staged'; }>();
  const [diff, setDiff] = useState('');
  const [loading, setLoading] = useState(!remote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<FileChange>();
  const [message, setMessage] = useState(remote ? `docs(notes): update ${remoteChanges?.length || 0} notes` : '');
  const staged = changes.filter(file => selectionMode ? included.includes(file.path) : file.staged);
  const selected = changes.find(file => file.path === active?.path);
  const refresh = async () => {
    if (!remote) setChanges(await fetchFileChanges());
    await onChanged();
  };
  useEffect(() => {
    let cancelled = false;
    if (!remote) {
      void fetchFileChanges().then(files => {
        if (!cancelled) setChanges(files);
      }).catch(error => {
        if (!cancelled) setError(error.message);
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [remote]);
  const fileKey = changes.map(file => `${file.path}:${file.revision}:${file.staged}:${file.unstaged}`).join('|');
  /* eslint-disable react-hooks/exhaustive-deps -- Only file-key changes repair selection; including active or request would reapply initial selection during manual preview changes. */
  useEffect(() => {
    if (!changes.length) {
      /* eslint-disable react/set-state-in-effect -- File-list arrival repairs the selection before the separate diff effect; retaining this commit ordering preserves preview request timing. */
      setActive(undefined);
      /* eslint-enable react/set-state-in-effect */
      return;
    }
    if (!selected || !selectionMode && (active?.side === 'staged' && !selected.staged || active?.side === 'working' && !selected.unstaged)) {
      const file = selected || changes.find(file => file.path === request?.paths[0]) || changes[0];
      setActive({ path: file.path, side: selectionMode || file.unstaged ? 'working' : 'staged' });
    }
  }, [fileKey]);
  /* eslint-enable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (loading || requestApplied.current) return;
    requestApplied.current = true;
    /* eslint-disable react/set-state-in-effect -- The one-shot restore request is applied after the asynchronous file list finishes; applying it during render would precede that lifecycle checkpoint. */
    if (request?.action === 'restore') setRestoreFiles(changes.filter(file => request.paths.includes(file.path) && file.available));
    /* eslint-enable react/set-state-in-effect */
  }, [loading, fileKey, changes, request]);
  const remoteDiff = active && getPreview ? getPreview(active.path) : undefined;
  /* eslint-disable react-hooks/exhaustive-deps -- The diff request uses path, side, revision and availability primitives; observing the containing objects would refetch identical previews. */
  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react/set-state-in-effect -- Clear the previous preview when its cancellable diff request starts; preserve the loading and error lifecycle for local and remote changes. */
    setDiff('');
    /* eslint-enable react/set-state-in-effect */
    setDiffLoading(false);
    setDiffError('');
    if (!active || !selected?.available) return;
    if (remoteDiff !== undefined) {
      setDiff(remoteDiff);
      return;
    }
    setDiffLoading(true);
    void fetchFileDiff(active.path, selectionMode ? 'current' : active.side).then(value => {
      if (!cancelled) setDiff(value);
    }).catch(error => {
      if (!cancelled) setDiffError(error.message);
    }).finally(() => {
      if (!cancelled) setDiffLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [active?.path, active?.side, selected?.revision, selected?.available, remoteDiff, selectionMode]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const act = async (file: FileChange, action: 'stage' | 'unstage' | 'restore', confirmed = false) => {
    if (busy || !writable || !file.available) return;
    if (action === 'restore' && !confirmed) {
      setConfirm(file);
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (remote && action !== 'restore') setIncluded(previous => action === 'stage' ? [...new Set([...previous, file.path])] : previous.filter(path => path !== file.path));
      else {
        if (remote) await restoreFile?.(file);
        else {
          const result = await manageFileChange(file, action);
          if (result.backup) setNotice(t('changes.backup', { path: result.backup }));
        }
        await refresh();
      }
      setConfirm(undefined);
    } catch (error) {
      setError((error as Error).message);
      setConfirm(undefined);
      if (!remote) {
        try {
          setChanges(await fetchFileChanges());
        } catch { /* Keep the reviewed snapshot on read failure. */ }
      }
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (busy || !writable || !staged.length || !message.trim()) return;
    setBusy(true);
    setError('');
    try {
      if (commitFiles) await commitFiles(staged.map(file => file.path), message.trim());
      else await commitStagedChanges(staged, message.trim(), selectionMode);
      await onCommitted();
      onClose();
    } catch (error) {
      setError((error as Error).message);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      setMessage(remote ? `docs(notes): update ${staged.length} files` : await generateSemanticCommit((await Promise.all(staged.map(file => fetchFileDiff(file.path, selectionMode ? 'current' : 'staged')))).join('\n'), staged[0]?.path));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const restoreMany = async () => {
    if (!restoreFiles?.length || busy || !writable) return;
    setBusy(true);
    setError('');
    const backups: string[] = [];
    let restored = 0;
    try {
      for (const file of restoreFiles) {
        if (remote) await restoreFile?.(file);
        else {
          const result = await manageFileChange(file, 'restore');
          if (result.backup) backups.push(result.backup);
        }
        restored++;
      }
    } catch (error) {
      setError(`${t('changes.restoredCount', { count: restored })} ${(error as Error).message}`);
    } finally {
      setRestoreFiles(undefined);
      setNotice(backups.length ? backups.map(path => t('changes.backup', { path })).join('\n') : t('changes.restoredCount', { count: restored }));
      await refresh().catch(error => setError(error.message));
      setBusy(false);
    }
  };
  const group = (side: 'working' | 'staged') => (
    <section className='changes-group' aria-label={t(selectionMode ? 'panel.changesFiles' : side === 'working' ? 'changes.unstaged' : remote ? 'changes.included' : 'changes.staged')}>
      <h4>
        {t(selectionMode ? 'panel.changesFiles' : side === 'working' ? 'changes.unstaged' : remote ? 'changes.included' : 'changes.staged')} <small>{changes.filter(file => selectionMode || (side === 'working' ? file.unstaged : file.staged)).length}</small>
      </h4>
      {changes.filter(file => selectionMode || (side === 'working' ? file.unstaged : file.staged)).map(file => (
        <div className='changes-row' key={file.path} data-change-path={file.path} data-side={side}>
          <input type='checkbox' aria-label={t('changes.selectFile', { path: file.path })} checked={selectionMode ? included.includes(file.path) : file.staged} disabled={busy || !writable || !file.available} onChange={() => selectionMode ? setIncluded(old => old.includes(file.path) ? old.filter(path => path !== file.path) : [...old, file.path]) : void act(file, file.staged ? 'unstage' : 'stage')} />
          <Button type='button' className='changes-file' aria-pressed={active?.path === file.path && active.side === side} onClick={() => setActive({ path: file.path, side })} title={file.path}>
            <span>{file.path}</span>
            <small>{t(`changes.${file.kind}`)}</small>
          </Button>
          {!selectionMode && <Button type='button' size='icon' aria-label={`${t(side === 'working' ? 'changes.stage' : 'changes.unstage')} ${file.path}`} title={t(side === 'working' ? 'changes.stage' : 'changes.unstage')} disabled={busy || !writable || !file.available} onClick={() => void act(file, side === 'working' ? 'stage' : 'unstage')}>{side === 'working' ? <Plus /> : <Minus />}</Button>}
          <Button type='button' size='icon' aria-label={`${t('common.restore')} ${file.path}`} title={t(file.tracked ? 'common.restore' : 'changes.discardNew')} disabled={busy || !writable || !file.available} onClick={() => void act(file, 'restore')}>
            <RotateCcw />
          </Button>
        </div>
      ))}
    </section>
  );
  return (
    <WorkspaceDialog
      title={t('changes.title')}
      className='changes-dialog'
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <header>
        <div>
          <small>{t('commit.branch', { branch: gitStatus?.branch || '' })}</small>
        </div>
        <Button
          size='icon'
          aria-label={t('changes.refresh')}
          disabled={busy}
          onClick={() => {
            setError('');
            void refresh().catch(error => setError(error.message));
          }}
        >
          <RefreshCw />
        </Button>
      </header>
      {selectionMode && <p className='changes-help'>{t('changes.selectedHint')}</p>}
      {remote && <p className='changes-help'>{t('changes.remoteHint')}</p>}
      <div className='changes-body'>
        <div className='changes-list'>{loading ? <p role='status'>{t('agent.loadingDocument')}</p> : changes.length ? <>{group('working')}{!selectionMode && group('staged')}</> : <p>{t('commit.cleanWorkingTree')}</p>}</div>
        <DiffPreview file={selected} diff={diff} loading={diffLoading} error={diffError} />
      </div>
      {restoreFiles && (
        <EditorNotice
          actions={
            <>
              <Button
                disabled={busy}
                onClick={() => setRestoreFiles(undefined)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant='danger'
                disabled={busy || !restoreFiles.length}
                onClick={() => void restoreMany()}
              >
                {t('changes.confirm')}
              </Button>
            </>
          }
        >
          <strong>{t('changes.confirmRestoreMany', { count: restoreFiles.length })}</strong>
          <ul className='restore-file-list'>{restoreFiles.map(file => <li key={file.path}>{file.path}</li>)}</ul>
        </EditorNotice>
      )}
      {confirm && (
        <div className='changes-confirm' role='alert'>
          <p>{t(confirm.tracked ? 'changes.confirmRestore' : 'changes.confirmDiscard', { path: confirm.path })}</p>
          <Button disabled={busy} onClick={() => setConfirm(undefined)}>{t('common.cancel')}</Button>
          <Button variant='danger' aria-label={t('changes.confirm')} disabled={busy} onClick={() => void act(confirm, 'restore', true)}>{t('changes.confirm')}</Button>
        </div>
      )}
      {error && <p role='alert' className='changes-error'>{error}</p>}
      {notice && <p role='status' className='changes-help'>{notice}</p>}
      <footer>
        <input className='ui-control' aria-label={t('commit.message')} placeholder={t('commit.placeholder')} value={message} disabled={busy} onChange={event => setMessage(event.target.value)} />
        <Button disabled={busy || !staged.length} onClick={() => void generate()}>{t(remote ? 'commit.generateMessage' : 'commit.semanticMessage')}</Button>
        <Button variant='primary' disabled={busy || !writable || !staged.length || !message.trim() || staged.some(file => !file.available)} onClick={() => void commit()}>
          <GitCommit />
          {t(busy ? 'commit.committing' : selectionMode ? 'changes.commitSelected' : remote ? 'commit.commitToGithub' : 'commit.commitAndSave', { count: staged.length })}
        </Button>
      </footer>
    </WorkspaceDialog>
  );
}
