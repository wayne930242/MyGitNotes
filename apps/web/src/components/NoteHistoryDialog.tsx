import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { BookmarkPlus, Bot, GitCompare, Pencil, Trash2 } from 'lucide-react';
import { type HistoryEntry, nextVersionNumbers, type NoteVersion, placeVersions } from '@mygitnotes/core/note-versions';
import { changeVersion, fetchCommitFiles, fetchHistory, fetchHistoryContent, type HistoryContent, type HistoryTarget, today, type VersionText } from '../lib/history-api.js';
import { useTranslation } from '../lib/i18n/index.js';
import { createUnifiedDiff } from '../lib/unified-diff.js';
import { useVersionNumbering, versionNumbers } from '../lib/version-display.js';
import { Button } from './Button.js';
import { DiffPreview } from './DiffPreview.js';
import { EditorNotice } from './EditorNotice.js';
import { LoadingStatus } from './LoadingStatus.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';

interface Props {
  target: HistoryTarget;
  title: string;
  /** The file has changes that are not in its history yet: unsaved, uncommitted locally, or a remote draft. */
  dirty?: boolean;
  /** Saves the file's changes and records them as a new version in the same commit; absent when the editor cannot commit. */
  onCommitVersion?: (text: VersionText) => Promise<void>;
  onClose: () => void;
}

/** One point of the history a person can open or compare: a commit of the file, or a version whose commit is not listed. */
interface Point {
  key: string;
  date: string;
  path: string;
  load: () => Promise<HistoryContent>;
  entry?: HistoryEntry;
  version?: NoteVersion;
}

type VersionDialog = { mode: 'new'; } | { mode: 'mark'; entry: HistoryEntry; } | { mode: 'edit'; version: NoteVersion; };

/** Commit subjects as people read them: without a conventional prefix or the agent mark the badge already shows. */
export function plainSubject(subject: string): string {
  return subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '').replace(/\s*\(Agent, \d{4}-\d{2}-\d{2}\)$/, '') || subject;
}

const textOf = (content: HistoryContent | null) => content && 'content' in content ? content.content : null;
/** A content that cannot be shown as lines, spelled as the diff preview recognizes it. */
const noticeDiff = (content: HistoryContent) => 'notice' in content ? content.notice === 'binary' ? 'Binary file added.' : 'File exceeds the 1 MiB preview limit.' : '';

/** A note's or agent file's history: its commits, the versions people recorded, what each changed, and comparisons. */
export function NoteHistoryDialog({ target, title, dirty = false, onCommitVersion, onClose }: Props) {
  const { t, language } = useTranslation();
  const numbering = useVersionNumbering();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(1);
  const [writable, setWritable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string>();
  const [view, setView] = useState<'changes' | 'text'>('changes');
  const [comparing, setComparing] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ diff: string; text?: string; title: string; loading: boolean; error: string; }>({ diff: '', title: '', loading: false, error: '' });
  const [dialog, setDialog] = useState<VersionDialog>();
  const [deleting, setDeleting] = useState<NoteVersion>();
  const [busy, setBusy] = useState(false);
  // Contents of a commit or blob never change, so each is read once while the dialog is open.
  const [contents] = useState(() => new Map<string, Promise<HistoryContent>>());
  const dates = useMemo(() => new Intl.DateTimeFormat(language, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }), [language]);

  const load = useCallback(async (next: number) => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchHistory(target, next);
      setEntries(previous => next === 1 ? result.entries : [...previous, ...result.entries.filter(entry => !previous.some(known => known.commit === entry.commit))]);
      setVersions(result.versions);
      setMore(result.more);
      setPage(next);
      setWritable(result.writable);
      if (next === 1) setSelected(current => current ?? (result.entries[0] ? `c:${result.entries[0].commit}` : undefined));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }, [target]);
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Load the file's history when the dialog opens; the request owns the loading state it sets. */
    void load(1);
    /* eslint-enable react/set-state-in-effect */
  }, [load]);

  const placed = useMemo(() => placeVersions(versions, entries), [versions, entries]);
  const placedVersions = useMemo(() => new Set([...placed.values()].flat()), [placed]);
  const cached = useCallback((key: string, read: () => Promise<HistoryContent>) => {
    let content = contents.get(key);
    if (!content) {
      content = read();
      contents.set(key, content);
      content.catch(() => contents.delete(key));
    }
    return content;
  }, [contents]);
  const entryPoint = useCallback((entry: HistoryEntry): Point => ({ key: `c:${entry.commit}`, date: entry.date, path: entry.path, entry, load: () => cached(`c:${entry.commit}`, () => fetchHistoryContent(target, { commit: entry.commit, path: entry.path })) }), [cached, target]);
  const versionPoint = useCallback((version: NoteVersion): Point => {
    const entry = entries.find(candidate => placed.get(candidate.commit)?.includes(version));
    return entry ? { ...entryPoint(entry), version } : { key: `b:${version.blob}:${version.sequence}`, date: version.authored, path: target.path, version, load: () => cached(`b:${version.blob}`, () => fetchHistoryContent(target, { blob: version.blob })) };
  }, [cached, entries, entryPoint, placed, target]);
  const points = useMemo(() => {
    const all = new Map<string, Point>();
    for (const entry of entries) all.set(`c:${entry.commit}`, entryPoint(entry));
    for (const version of versions) {
      const point = versionPoint(version);
      if (!all.has(point.key)) all.set(point.key, point);
    }
    return all;
  }, [entries, entryPoint, versionPoint, versions]);

  const label = useCallback((version: NoteVersion) => {
    const [first, second] = versionNumbers(version, numbering);
    return { first, second, text: version.name ? `${first} · ${version.name}` : first };
  }, [numbering]);
  const pointTitle = useCallback((point: Point) => {
    const version = point.version ?? (point.entry && placed.get(point.entry.commit)?.[0]);
    return version ? label(version).text : dates.format(new Date(point.date));
  }, [dates, label, placed]);

  // The preview follows the selection, the view and the comparison.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (comparing) {
        if (picks.length < 2) return setPreview({ diff: '', title: t('history.compareHint'), loading: false, error: '' });
        const [older, newer] = picks.map(key => points.get(key)!).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
        const [before, after] = await Promise.all([older.load(), newer.load()]);
        const notice = 'notice' in before ? before : 'notice' in after ? after : undefined;
        return { diff: notice ? noticeDiff(notice) : createUnifiedDiff(older.path, newer.path, textOf(before), textOf(after)), title: t('history.comparing', { from: pointTitle(older), to: pointTitle(newer) }) };
      }
      const point = selected ? points.get(selected) : undefined;
      if (!point) return setPreview({ diff: '', title: '', loading: false, error: '' });
      const content = await point.load();
      if (view === 'text') return { diff: 'notice' in content ? noticeDiff(content) : '', text: textOf(content) ?? undefined, title: t('history.textAt', { when: pointTitle(point) }) };
      const index = point.entry ? entries.indexOf(point.entry) : -1;
      // The change a commit made is against the file's previous commit; the first commit added the whole file.
      if (index >= 0 && index === entries.length - 1 && more) {
        await load(page + 1);
        return;
      }
      const previous = index >= 0 ? entries[index + 1] : undefined;
      const before = previous ? await entryPoint(previous).load() : null;
      const notice = 'notice' in content ? content : before && 'notice' in before ? before : undefined;
      return { diff: notice ? noticeDiff(notice) : createUnifiedDiff(previous?.path ?? point.path, point.path, textOf(before), textOf(content)), title: t(previous ? 'history.changesAt' : 'history.firstAt', { when: pointTitle(point) }) };
    };
    /* eslint-disable react/set-state-in-effect -- Mark the preview as loading while its cancellable read runs; the read owns the result. */
    setPreview(current => ({ ...current, loading: true, error: '' }));
    /* eslint-enable react/set-state-in-effect */
    run().then(result => {
      if (!cancelled && result) setPreview({ ...result, loading: false, error: '' });
    }, failure => {
      if (!cancelled) setPreview({ diff: '', title: '', loading: false, error: (failure as Error).message });
    });
    return () => {
      cancelled = true;
    };
  }, [comparing, entries, entryPoint, load, more, page, picks, pointTitle, points, selected, t, view]);

  const pick = (key: string) => {
    if (!comparing) return setSelected(key);
    setPicks(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key].slice(-2));
  };
  const toggleCompare = () => {
    setComparing(current => !current);
    setPicks(selected && entries[0] && selected !== `c:${entries[0].commit}` ? [selected, `c:${entries[0].commit}`] : []);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      setVersions(await changeVersion(target, { action: 'delete', sequence: deleting.sequence }));
      setDeleting(undefined);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canWrite = writable && !busy;
  const versionList = [...versions].sort((a, b) => b.sequence - a.sequence);
  const row = (key: string, content: ReactNode, actions?: ReactNode) => {
    const active = comparing ? picks.includes(key) : selected === key;
    return (
      <div key={key} className='changes-row history-row'>
        <button type='button' className='changes-file ui-button history-pick' aria-pressed={active} onClick={() => pick(key)}>{content}</button>
        {actions}
      </div>
    );
  };

  return (
    <WorkspaceDialog title={t('history.title', { title })} className='changes-dialog history-dialog' onClose={() => !busy && onClose()}>
      <header className='history-toolbar'>
        {writable && (dirty ? onCommitVersion : entries[0]) && (
          <Button variant='primary' disabled={!canWrite} onClick={() => setDialog({ mode: 'new' })}>
            <BookmarkPlus aria-hidden='true' />
            {t('history.newVersion')}
          </Button>
        )}
        <Button aria-pressed={comparing} disabled={entries.length + versions.length < 2} onClick={toggleCompare}>
          <GitCompare aria-hidden='true' />
          {t('history.compare')}
        </Button>
        {!comparing && (
          <div className='history-view' role='group' aria-label={t('history.view')}>
            <Button size='small' aria-pressed={view === 'changes'} onClick={() => setView('changes')}>{t('history.viewChanges')}</Button>
            <Button size='small' aria-pressed={view === 'text'} onClick={() => setView('text')}>{t('history.viewText')}</Button>
          </div>
        )}
      </header>
      {dirty && <p className='changes-help'>{t('history.dirtyHint')}</p>}
      {error && <p role='alert' className='changes-error'>{error}</p>}
      <div className='changes-body'>
        <div className='changes-list history-list'>
          {versionList.length > 0 && (
            <section className='changes-group' aria-label={t('history.versions')}>
              <h4>{t('history.versions')}</h4>
              {versionList.map(version => {
                const point = versionPoint(version), { first, second } = label(version);
                return row(
                  point.key,
                  <>
                    <span className='history-version'>
                      <b>{first}</b>
                      <small title={second}>{second}</small>
                      {version.name && <span>{version.name}</span>}
                    </span>
                    {version.note && <small className='history-note'>{version.note}</small>}
                    {!placedVersions.has(version) && <small>{dates.format(new Date(version.authored))}</small>}
                  </>,
                  canWrite && (
                    <>
                      <Button
                        size='icon'
                        aria-label={t('history.editVersion', { version: first })}
                        title={t('history.editVersion', { version: first })}
                        onClick={() => setDialog({ mode: 'edit', version })}
                      >
                        <Pencil aria-hidden='true' />
                      </Button>
                      <Button
                        size='icon'
                        aria-label={t('history.deleteVersion', { version: first })}
                        title={t('history.deleteVersion', { version: first })}
                        onClick={() => setDeleting(version)}
                      >
                        <Trash2 aria-hidden='true' />
                      </Button>
                    </>
                  ),
                );
              })}
            </section>
          )}
          <section className='changes-group' aria-label={t('history.changes')}>
            <h4>{t('history.changes')}</h4>
            {entries.map((entry, index) => {
              const marks = placed.get(entry.commit) ?? [];
              return row(
                `c:${entry.commit}`,
                <>
                  <span className='history-subject' title={entry.subject}>{plainSubject(entry.subject)}</span>
                  <small className='history-meta'>
                    {index === 0 && <span className='history-badge'>{t('history.latest')}</span>}
                    {entry.agent && (
                      <span className='history-badge' title={t('history.agentTitle')}>
                        <Bot aria-hidden='true' />
                        {t('history.agent')}
                      </span>
                    )}
                    {marks.map(version => <span key={version.sequence} className='history-badge history-badge-version'>{label(version).text}</span>)}
                    <span>{dates.format(new Date(entry.date))}</span>
                    {entry.author && <span>{entry.author}</span>}
                  </small>
                </>,
                canWrite && !marks.length && (
                  <Button size='icon' aria-label={t('history.markVersion')} title={t('history.markVersion')} onClick={() => setDialog({ mode: 'mark', entry })}>
                    <BookmarkPlus aria-hidden='true' />
                  </Button>
                ),
              );
            })}
            {loading ? <LoadingStatus className='changes-help'>{t('history.loading')}</LoadingStatus> : !entries.length ? <p className='changes-help'>{t('history.empty')}</p> : more && <Button size='small' className='history-more' onClick={() => void load(page + 1)}>{t('history.loadMore')}</Button>}
          </section>
        </div>
        {view === 'text' && !comparing && preview.text !== undefined && !preview.loading && !preview.error
          ? (
            <section className='changes-preview' aria-label={preview.title}>
              <h4>
                <span>{preview.title}</span>
              </h4>
              <pre tabIndex={0} className='history-text'>{preview.text}</pre>
            </section>
          )
          : <DiffPreview diff={preview.diff} loading={preview.loading} error={preview.error} title={preview.title || t('history.changes')} emptyText={comparing ? t('history.compareHint') : t('history.noChange')} />}
      </div>
      {deleting && (
        <EditorNotice
          actions={
            <>
              <Button
                disabled={busy}
                onClick={() => setDeleting(undefined)}
              >
                {t('common.cancel')}
              </Button>
              <Button variant='danger' disabled={busy} onClick={() => void confirmDelete()}>{t('common.delete')}</Button>
            </>
          }
        >
          <strong>{t('history.confirmDelete', { version: label(deleting).text })}</strong>
        </EditorNotice>
      )}
      {dialog && (
        <VersionDialog
          target={target}
          dialog={dialog}
          versions={versions}
          dirty={dirty}
          onClose={() => setDialog(undefined)}
          onSave={async text => {
            setBusy(true);
            try {
              if (dialog.mode === 'edit') setVersions(await changeVersion(target, { action: 'update', sequence: dialog.version.sequence, ...text }));
              else if (dialog.mode === 'new' && dirty) {
                await onCommitVersion!(text);
                await load(1);
              } else {
                const entry = dialog.mode === 'mark' ? dialog.entry : entries[0];
                setVersions(await changeVersion(target, { action: 'create', commit: entry.commit, at: entry.path, include: text.include ?? [], name: text.name, note: text.note }));
              }
              setDialog(undefined);
            } finally {
              setBusy(false);
            }
          }}
          entry={dialog.mode === 'mark' ? dialog.entry : dialog.mode === 'new' && !dirty ? entries[0] : undefined}
        />
      )}
    </WorkspaceDialog>
  );
}

/** Names a version and adds a note: for a new version, a past commit, or an existing version. */
function VersionDialog({ target, dialog, versions, dirty, entry, onClose, onSave }: { target: HistoryTarget; dialog: VersionDialog; versions: NoteVersion[]; dirty: boolean; entry?: HistoryEntry; onClose: () => void; onSave: (text: VersionText & { include?: string[]; }) => Promise<void>; }) {
  const { t } = useTranslation();
  const numbering = useVersionNumbering();
  const editing = dialog.mode === 'edit' ? dialog.version : undefined;
  const [name, setName] = useState(editing?.name ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [others, setOthers] = useState<string[]>();
  const [include, setInclude] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const numbers = editing ?? nextVersionNumbers(versions, today());
  const [first, second] = versionNumbers(numbers, numbering);
  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    fetchCommitFiles(target, entry.commit).then(files => {
      if (!cancelled) setOthers(files);
    }, () => {
      if (!cancelled) setOthers([]);
    });
    return () => {
      cancelled = true;
    };
  }, [entry, target]);
  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave({ name, note, include });
    } catch (failure) {
      setError((failure as Error).message);
      setSaving(false);
    }
  };
  return (
    <WorkspaceDialog title={t(dialog.mode === 'edit' ? 'history.editTitle' : dialog.mode === 'mark' ? 'history.markVersion' : 'history.newVersion')} onClose={() => !saving && onClose()}>
      <form
        className='screen-form history-version-form'
        onSubmit={event => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className='history-numbers'>
          <b>{first}</b>
          <span>{t('history.otherNumber', { number: second })}</span>
        </p>
        {dialog.mode === 'new' && dirty && <p className='text-xs text-muted'>{t('history.saveFirst')}</p>}
        <label>
          {t('history.versionName')}
          <input className='ui-control' value={name} maxLength={80} placeholder={t('history.versionNamePlaceholder')} onChange={event => setName(event.target.value.replace(/[\r\n]/g, ''))} autoFocus />
        </label>
        <label>
          {t('history.versionNote')}
          <textarea className='ui-control' value={note} maxLength={2000} rows={4} placeholder={t('history.versionNotePlaceholder')} onChange={event => setNote(event.target.value)} />
        </label>
        {entry && others && others.length > 0 && (
          <fieldset className='history-include'>
            <legend>{t('history.alsoMark')}</legend>
            {others.map(file => (
              <label key={file}>
                <input type='checkbox' checked={include.includes(file)} onChange={event => setInclude(current => event.target.checked ? [...current, file] : current.filter(value => value !== file))} />
                <span>{file}</span>
              </label>
            ))}
          </fieldset>
        )}
        {error && <p role='alert' className='text-xs text-danger'>{error}</p>}
        <div className='workspace-dialog-actions'>
          <Button type='button' onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button type='submit' variant='primary' disabled={saving}>{t(saving ? 'history.saving' : 'common.save')}</Button>
        </div>
      </form>
    </WorkspaceDialog>
  );
}
