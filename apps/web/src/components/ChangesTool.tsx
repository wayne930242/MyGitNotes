import { useEffect, useState } from 'react';
import { GitCommit, RotateCcw, FileDiff } from 'lucide-react';
import type { FileChange, GitStatus, NoteItem, ChangeRequest } from '../lib/types.js';
import { fetchFileChanges, fetchFileDiff } from '../lib/api.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';
import { DiffPreview } from './DiffPreview.js';
import { EditorNotice } from './EditorNotice.js';
import { GitSyncSection } from './GitSyncSection.js';

interface ChangesToolProps {
  gitStatus: GitStatus | null;
  deletedNotes: NoteItem[];
  onRestoreNote: (note: NoteItem) => void;
  onOpenCommitModal: (request?: ChangeRequest) => void;
  remoteChanges?: FileChange[];
  getPreview?: (file: string) => string;
  writable: boolean;
  onSynced?: () => void;
}

export function ChangesTool({ gitStatus, deletedNotes, onRestoreNote, onOpenCommitModal, remoteChanges, getPreview, writable, onSynced }: ChangesToolProps) {
  const { t } = useTranslation();
  const [localFiles, setFiles] = useState<FileChange[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string>();
  const [diff, setDiff] = useState('');
  const [error, setError] = useState('');
  const [diffError, setDiffError] = useState('');
  const [loading, setLoading] = useState(false);
  const files = remoteChanges || localFiles;
  const active = files.find(file => file.path === activePath);
  useEffect(() => {
    if (remoteChanges) return;
    let cancelled = false;
    setError('');
    void fetchFileChanges().then(files => { if (!cancelled) setFiles(files); }).catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [gitStatus, remoteChanges]);
  const preview = active && getPreview ? getPreview(active.path) : undefined;
  useEffect(() => {
    let cancelled = false;
    setDiff(''); setDiffError(''); setLoading(false);
    if (!active?.available) return;
    if (preview !== undefined) { setDiff(preview); return; }
    setLoading(true);
    void fetchFileDiff(active.path, 'current')
      .then(diff => { if (!cancelled) setDiff(diff); })
      .catch(error => { if (!cancelled) setDiffError(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active?.path, active?.revision, active?.available, preview]);
  const manageable = files.filter(file => file.available);
  const chosen = manageable.filter(file => selected.includes(file.path));
  const request = (action: ChangeRequest['action'], paths: string[]) => onOpenCommitModal({ action, paths });
  return <div className="panel-tool changes-tool">
    {error && <EditorNotice tone="error">{error}</EditorNotice>}
    {!files.length && !deletedNotes.length && <p className="todo-empty">{t('panel.changesEmpty')}</p>}
    {!!files.length && <>
      <label className="panel-select-all"><input type="checkbox" checked={!!manageable.length && chosen.length === manageable.length} disabled={!writable || !manageable.length}
        onChange={event => setSelected(event.target.checked ? manageable.map(file => file.path) : [])} />{t('changes.selectAll')}</label>
      <ul className="changes-file-list">{files.map(file => <li key={file.path} className="panel-change" data-change-path={file.path}>
        <div className="panel-change-heading">
          <input type="checkbox" aria-label={t('changes.selectFile', { path: file.path })} checked={selected.includes(file.path)} disabled={!writable || !file.available}
            onChange={event => setSelected(old => event.target.checked ? [...old, file.path] : old.filter(path => path !== file.path))} />
          <Button className="panel-file-title" title={file.path} aria-pressed={activePath === file.path} onClick={() => setActivePath(old => old === file.path ? undefined : file.path)}>
            <FileDiff aria-hidden="true" /><span>{file.path.split('/').pop()}<small>{file.path}</small></span>
          </Button>
        </div>
        <div className="panel-change-actions"><span className="change-kind" data-kind={file.kind}>{t(`changes.${file.kind}`)}</span>
          <Button size="icon" title={t('changes.viewFile')} aria-label={t('panel.changesViewDiff', { path: file.path })} onClick={() => request('review', [file.path])}><FileDiff aria-hidden="true" /></Button>
          <Button size="icon" title={t('common.restore')} aria-label={t('changes.restoreFile', { path: file.path })} disabled={!writable || !file.available} onClick={() => request('restore', [file.path])}><RotateCcw aria-hidden="true" /></Button>
          <Button size="icon" title={t('changes.commitFile', { path: file.path })} aria-label={t('changes.commitFile', { path: file.path })} disabled={!writable || !file.available} onClick={() => request('commit', [file.path])}><GitCommit aria-hidden="true" /></Button>
        </div>
      </li>)}</ul>
      {active && <DiffPreview file={active} diff={diff} loading={loading} error={diffError} />}
      <div className="panel-bulk-actions">
        <Button variant="primary" disabled={!writable || !chosen.length} onClick={() => request('commit', chosen.map(file => file.path))}><GitCommit aria-hidden="true" />{t('changes.commitSelected', { count: chosen.length })}</Button>
        <Button variant="danger" disabled={!writable || !manageable.length} onClick={() => request('restore', manageable.map(file => file.path))}><RotateCcw aria-hidden="true" />{t('changes.restoreAll')}</Button>
        <Button onClick={() => onOpenCommitModal()}>{t('changes.manageAll')}</Button>
      </div>
    </>}
    {deletedNotes.length > 0 && <section className="todo-group"><h4>{t('panel.changesDeleted')}</h4><ul>{deletedNotes.map(note => <li key={note.path} className="changes-deleted-item"><span>{note.title}</span><Button size="icon" aria-label={t('footer.restore')} disabled={!writable} onClick={() => onRestoreNote(note)}><RotateCcw aria-hidden="true" /></Button></li>)}</ul></section>}
    {onSynced && <GitSyncSection gitStatus={gitStatus} onSynced={onSynced} />}
  </div>;
}
