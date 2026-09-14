import { useEffect, useRef, useState } from 'react';
import { X, GitCommit, RotateCcw, Plus, Minus, RefreshCw, FileDiff } from 'lucide-react';
import type { FileChange, GitStatus } from '../lib/types.js';
import { fetchFileChanges, fetchFileDiff, manageFileChange, commitStagedChanges, generateSemanticCommit } from '../lib/api.js';
import { useTranslation } from '../lib/i18n/index.js';

interface Props {
  isOpen: boolean;
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

function Changes({ writable, gitStatus, remoteChanges, getPreview, restoreFile, commitFiles, onChanged, onCommitted, onClose }: Props) {
  const { t } = useTranslation();
  const remote = Boolean(commitFiles);
  const [localChanges, setChanges] = useState<FileChange[]>([]);
  const [included, setIncluded] = useState<string[]>(remoteChanges?.map(file => file.path) || []);
  const changes = remoteChanges ? remoteChanges.map(file => ({ ...file, staged: included.includes(file.path), unstaged: !included.includes(file.path) })) : localChanges;
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const [active, setActive] = useState<{ path: string; side: 'working' | 'staged' }>();
  const [diff, setDiff] = useState('');
  const [loading, setLoading] = useState(!remote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<FileChange>();
  const [message, setMessage] = useState(remote ? `docs(notes): update ${remoteChanges?.length || 0} notes` : '');
  const staged = changes.filter(file => file.staged);
  const selected = changes.find(file => file.path === active?.path);
  const refresh = async () => {
    if (!remote) setChanges(await fetchFileChanges());
    await onChanged();
  };
  useEffect(() => {
    let cancelled = false;
    if (!remote) void fetchFileChanges().then(files => { if (!cancelled) setChanges(files); })
      .catch(error => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [remote]);
  const fileKey = changes.map(file => `${file.path}:${file.revision}:${file.staged}:${file.unstaged}`).join('|');
  useEffect(() => {
    if (!changes.length) { setActive(undefined); return; }
    if (!selected || active?.side === 'staged' && !selected.staged || active?.side === 'working' && !selected.unstaged) {
      const file = selected || changes[0];
      setActive({ path: file.path, side: file.unstaged ? 'working' : 'staged' });
    }
  }, [fileKey]);
  const remoteDiff = active && getPreview ? getPreview(active.path) : undefined;
  useEffect(() => {
    let cancelled = false;
    setDiff('');
    if (!active || !selected?.available) return;
    if (remoteDiff !== undefined) { setDiff(remoteDiff); return; }
    void fetchFileDiff(active.path, active.side).then(value => { if (!cancelled) setDiff(value); }).catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [active?.path, active?.side, selected?.revision, selected?.available, remoteDiff]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!busy) { if (confirm) setConfirm(undefined); else onClose(); }
    };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [busy, confirm, onClose]);

  const act = async (file: FileChange, action: 'stage' | 'unstage' | 'restore', confirmed = false) => {
    if (busy || !writable || !file.available) return;
    if (action === 'restore' && !confirmed) { setConfirm(file); return; }
    setBusy(true); setError(''); setNotice('');
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
      setError((error as Error).message); setConfirm(undefined);
      if (!remote) try { setChanges(await fetchFileChanges()); } catch { /* Keep the reviewed snapshot on read failure. */ }
    } finally { setBusy(false); }
  };
  const commit = async () => {
    if (busy || !writable || !staged.length || !message.trim()) return;
    setBusy(true); setError('');
    try {
      if (commitFiles) await commitFiles(staged.map(file => file.path), message.trim());
      else await commitStagedChanges(staged, message.trim());
      await onCommitted(); onClose();
    } catch (error) { setError((error as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  };
  const generate = async () => {
    setBusy(true); setError('');
    try {
      setMessage(remote ? `docs(notes): update ${staged.length} files` : await generateSemanticCommit((await Promise.all(staged.map(file => fetchFileDiff(file.path, 'staged')))).join('\n'), staged[0]?.path));
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const group = (side: 'working' | 'staged') => <section className="changes-group" aria-label={t(side === 'working' ? 'changes.unstaged' : remote ? 'changes.included' : 'changes.staged')}>
    <h4>{t(side === 'working' ? 'changes.unstaged' : remote ? 'changes.included' : 'changes.staged')} <small>{changes.filter(file => side === 'working' ? file.unstaged : file.staged).length}</small></h4>
    {changes.filter(file => side === 'working' ? file.unstaged : file.staged).map(file => <div className="changes-row" key={file.path} data-change-path={file.path} data-side={side}>
      <input type="checkbox" aria-label={`Commit ${file.path}`} checked={file.staged} disabled={busy || !writable || !file.available} onChange={() => void act(file, file.staged ? 'unstage' : 'stage')} />
      <button type="button" className="changes-file" aria-pressed={active?.path === file.path && active.side === side} onClick={() => setActive({ path: file.path, side })} title={file.path}>
        <span>{file.path}</span><small>{t(`changes.${file.kind}`)}</small>
      </button>
      <button type="button" className="ui-icon-button" aria-label={`${t(side === 'working' ? 'changes.stage' : 'changes.unstage')} ${file.path}`} title={t(side === 'working' ? 'changes.stage' : 'changes.unstage')} disabled={busy || !writable || !file.available} onClick={() => void act(file, side === 'working' ? 'stage' : 'unstage')}>{side === 'working' ? <Plus /> : <Minus />}</button>
      <button type="button" className="ui-icon-button" aria-label={`${t('common.restore')} ${file.path}`} title={t(file.tracked ? 'common.restore' : 'changes.discardNew')} disabled={busy || !writable || !file.available} onClick={() => void act(file, 'restore')}><RotateCcw /></button>
    </div>)}
  </section>;
  return <div className="viewport-overlay changes-overlay">
    <div ref={dialog} tabIndex={-1} className="changes-dialog ui-dialog" role="dialog" aria-modal="true" aria-label={t('commit.title')} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || [])].filter(node => node.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <header><div><strong>{t('changes.title')}</strong><small>{t('commit.branch', { branch: gitStatus?.branch || '' })}</small></div>
        <button className="ui-icon-button" aria-label={t('changes.refresh')} disabled={busy} onClick={() => { setError(''); void refresh().catch(error => setError(error.message)); }}><RefreshCw /></button>
        <button className="ui-icon-button" aria-label={t('commit.close')} disabled={busy} onClick={onClose}><X /></button></header>
      {remote && <p className="changes-help">{t('changes.remoteHint')}</p>}
      <div className="changes-body">
        <div className="changes-list">{loading ? <p role="status">{t('agent.loadingDocument')}</p> : changes.length ? <>{group('working')}{group('staged')}</> : <p>{t('commit.cleanWorkingTree')}</p>}</div>
        <section className="changes-preview" aria-label={t('commit.diffPreview')}><h4><FileDiff />{active?.path || t('commit.diffPreview')}</h4>
          {selected && !selected.available ? <p>{t('changes.unavailable')}</p> : <pre tabIndex={0}>{diff ? diff.split('\n').map((line, index) => <span key={index} className={line.startsWith('+') ? 'diff-added' : line.startsWith('-') ? 'diff-removed' : line.startsWith('@@') ? 'diff-range' : undefined}>{line}{'\n'}</span>) : t('changes.noDiff')}</pre>}
        </section>
      </div>
      {confirm && <div className="changes-confirm" role="alert"><p>{t(confirm.tracked ? 'changes.confirmRestore' : 'changes.confirmDiscard', { path: confirm.path })}</p>
        <button className="ui-button" disabled={busy} onClick={() => setConfirm(undefined)}>{t('common.cancel')}</button>
        <button className="ui-button ui-button-danger" aria-label={t('changes.confirm')} disabled={busy} onClick={() => void act(confirm, 'restore', true)}>{t('changes.confirm')}</button></div>}
      {error && <p role="alert" className="changes-error">{error}</p>}
      {notice && <p role="status" className="changes-help">{notice}</p>}
      <footer><input className="ui-control" aria-label={t('commit.message')} placeholder={t('commit.placeholder')} value={message} disabled={busy} onChange={event => setMessage(event.target.value)} />
        <button className="ui-button" disabled={busy || !staged.length} onClick={() => void generate()}>{t(remote ? 'commit.generateMessage' : 'commit.semanticMessage')}</button>
        <button className="ui-button ui-button-primary" disabled={busy || !writable || !staged.length || !message.trim() || staged.some(file => !file.available)} onClick={() => void commit()}><GitCommit />{t(busy ? 'commit.committing' : remote ? 'commit.commitToGithub' : 'commit.commitAndSave')}</button></footer>
    </div>
  </div>;
}
