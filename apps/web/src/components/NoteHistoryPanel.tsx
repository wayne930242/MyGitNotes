import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, GitCompare, Pencil, RefreshCw, RotateCcw, Tag, Trash2 } from 'lucide-react';
import { type HistoryEntry, nextVersionNumbers, type NoteVersion, placeVersions, versionFilePath } from '@mygitnotes/core/note-versions';
import { changeVersion, fetchCommitFiles, fetchHistory, fetchHistoryContent, type HistoryContent, type HistoryTarget, onHistoryChanged, today, type VersionText } from '../lib/history-api.js';
import { discardStash, readStash, type StashedText, stashText } from '../lib/history-stash.js';
import { useTranslation } from '../lib/i18n/index.js';
import { createUnifiedDiff } from '../lib/unified-diff.js';
import { useVersionNumbering, versionNumbers } from '../lib/version-display.js';
import { Button } from './Button.js';
import { DiffPreview } from './DiffPreview.js';
import { LoadingStatus } from './LoadingStatus.js';
import { Select } from './Select.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';

export interface NoteHistoryPanelProps {
  /** Memoize it: a new target reads the history again. */
  target: HistoryTarget;
  /** The file has changes that are not in its history yet: unsaved, uncommitted locally, or a remote draft. */
  dirty?: boolean;
  /** Saves the file's changes and gives them a version number in the same commit; absent when the editor cannot commit. */
  onCommitVersion?: (text: VersionText) => Promise<void>;
  /**
   * The file's text as saving it now would write it, given while it has changes not in its history.
   * `latest` is the newest saved text, so a note whose frontmatter did not change keeps its form.
   */
  current?: (latest: string | null) => string;
  /** Puts a text into the editor as an ordinary unsaved change; absent when the editor cannot change the file. */
  onRestore?: (text: string) => void;
}

/**
 * One point a person can open or compare: a commit of the file, a version whose commit is not listed,
 * the editor's text not in the history yet, or a text kept on this device before a restore.
 */
interface Point {
  key: string;
  date: string;
  path: string;
  load: () => Promise<HistoryContent>;
  entry?: HistoryEntry;
  version?: NoteVersion;
  stashed?: StashedText;
}

/** The point of the editor's text that is not in the history yet. */
const CURRENT = 'current';

type VersionDialogMode = { mode: 'new'; } | { mode: 'mark'; entry: HistoryEntry; } | { mode: 'edit'; version: NoteVersion; };

/** Commit subjects as people read them: without a conventional prefix or the agent mark the badge already shows. */
export function plainSubject(subject: string): string {
  return subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '').replace(/\s*\(Agent, \d{4}-\d{2}-\d{2}\)$/, '') || subject;
}

const textOf = (content: HistoryContent | null) => content && 'content' in content ? content.content : null;
/** A content that cannot be shown as lines, spelled as the diff preview recognizes it. */
const noticeDiff = (content: HistoryContent) => 'notice' in content ? content.notice === 'binary' ? 'Binary file added.' : 'File exceeds the 1 MiB preview limit.' : '';

/** A file's commits and versions, read page by page, with each commit's or version's content read once. */
function useNoteHistory(target: HistoryTarget, current?: NoteHistoryPanelProps['current']) {
  const { language, t } = useTranslation();
  const numbering = useVersionNumbering();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(1);
  const [writable, setWritable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Contents of a commit or blob never change, so each is read once while the history is shown.
  const [contents] = useState(() => new Map<string, Promise<HistoryContent>>());
  const [stash, setStash] = useState(() => readStash(target));
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
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }, [target]);
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Read the file's history when it is shown; the request owns the loading state it sets. */
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
  const latestText = useCallback(async () => entries[0] ? textOf(await entryPoint(entries[0]).load()) : null, [entries, entryPoint]);
  /** The editor's text, kept texts, every commit newest first, then versions whose commit is not listed. */
  const points = useMemo(() => {
    const all = new Map<string, Point>();
    // The editor's text has no date: it is newer than every saved point.
    if (current) all.set(CURRENT, { key: CURRENT, date: '', path: target.path, load: async () => ({ blob: '', content: current(await latestText()) }) });
    for (const stashed of stash) all.set(`s:${stashed.id}`, { key: `s:${stashed.id}`, date: stashed.saved, path: target.path, stashed, load: async () => ({ blob: '', content: stashed.content }) });
    for (const entry of entries) all.set(`c:${entry.commit}`, entryPoint(entry));
    for (const version of versions) {
      const point = versionPoint(version);
      if (!all.has(point.key)) all.set(point.key, point);
    }
    return all;
  }, [current, entries, entryPoint, latestText, stash, target.path, versionPoint, versions]);

  const label = useCallback((version: NoteVersion) => {
    const [first, second] = versionNumbers(version, numbering);
    return { first, second, text: version.name ? `${first} · ${version.name}` : first };
  }, [numbering]);
  const pointTitle = useCallback((point: Point) => {
    if (point.key === CURRENT) return t('history.currentText');
    if (point.stashed) return `${t('history.stashed')} · ${dates.format(new Date(point.date))}`;
    const version = point.version ?? (point.entry && placed.get(point.entry.commit)?.[0]);
    return version ? label(version).text : dates.format(new Date(point.date));
  }, [dates, label, placed, t]);

  return { entries, versions, setVersions, more, page, writable, loading, error, setError, load, placed, placedVersions, points, versionPoint, label, pointTitle, dates, stash, setStash, latestText };
}

type NoteHistory = ReturnType<typeof useNoteHistory>;

/** The document panel's history section: a file's versions and saved changes; opening one shows its text and comparisons. */
export function NoteHistoryPanel({ target, dirty = false, onCommitVersion, current, onRestore }: NoteHistoryPanelProps) {
  const { t } = useTranslation();
  const history = useNoteHistory(target, dirty ? current : undefined);
  const { entries, versions, setVersions, more, page, writable, loading, error, setError, load, placed, placedVersions, versionPoint, label, dates, stash, setStash, latestText } = history;
  const [opened, setOpened] = useState<string>();
  const [dialog, setDialog] = useState<VersionDialogMode>();
  const [deleting, setDeleting] = useState<NoteVersion>();
  const [discarding, setDiscarding] = useState<StashedText>();
  const [busy, setBusy] = useState(false);

  // Commits anywhere in the workspace arrive from the server; one that names other files leaves this history as it is.
  useEffect(() =>
    onHistoryChanged(change => {
      if (!change.paths || change.paths.some(file => file === target.path || file === versionFilePath(target.path))) void load(1);
    }), [load, target.path]);

  // Changes that leave the unsaved state have usually been committed, from the footer or elsewhere: read the history again.
  const wasDirty = useRef(dirty);
  useEffect(() => {
    if (wasDirty.current && !dirty) void load(1);
    wasDirty.current = dirty;
  }, [dirty, load]);

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

  /**
   * Puts a point's text into the editor. Changes not in the history are kept on this device first, one entry per
   * restore, unless the history or an earlier kept text already holds them; a device that cannot keep them restores nothing.
   */
  const restore = async (point: Point) => {
    const text = textOf(await point.load());
    if (text === null || !onRestore) return;
    if (dirty && current) {
      const latest = await latestText();
      const now = current(latest);
      if (now !== text && now !== latest && !stash.some(entry => entry.content === now)) {
        try {
          setStash(stashText(target, now));
        } catch {
          throw new Error(t('history.stashFailed'));
        }
      }
    }
    onRestore(text);
    setOpened(undefined);
  };

  const canWrite = writable && !busy;
  const versionList = [...versions].sort((a, b) => b.sequence - a.sequence);
  const row = (key: string, content: ReactNode, actions?: ReactNode) => (
    <li key={key} className='note-history-row'>
      <button type='button' className='note-history-open' onClick={() => setOpened(key)}>{content}</button>
      {actions}
    </li>
  );

  return (
    <section className='note-history-panel note-panel-scroll' aria-label={t('history.open')}>
      <div className='note-history-actions'>
        {writable && dirty && onCommitVersion && (
          <Button size='small' variant='primary' disabled={!canWrite} onClick={() => setDialog({ mode: 'new' })}>
            <Tag aria-hidden='true' />
            {t('history.commitVersion')}
          </Button>
        )}
        <Button size='icon' aria-label={t('history.refresh')} title={t('history.refresh')} disabled={loading} onClick={() => void load(1)}>
          <RefreshCw aria-hidden='true' />
        </Button>
      </div>
      {dirty && <p className='note-history-hint'>{t('history.dirtyHint')}</p>}
      {error && <p role='alert' className='note-history-hint note-history-error'>{error}</p>}
      {deleting && (
        <div role='alertdialog' aria-label={t('history.deleteVersion', { version: label(deleting).first })} className='note-history-confirm'>
          <p>{t('history.confirmDelete', { version: label(deleting).text })}</p>
          <div>
            <Button size='small' disabled={busy} onClick={() => setDeleting(undefined)}>{t('common.cancel')}</Button>
            <Button size='small' variant='danger' disabled={busy} onClick={() => void confirmDelete()}>{t('common.delete')}</Button>
          </div>
        </div>
      )}
      {discarding && (
        <div role='alertdialog' aria-label={t('history.discardStash')} className='note-history-confirm'>
          <p>{t('history.confirmDiscard', { when: dates.format(new Date(discarding.saved)) })}</p>
          <div>
            <Button size='small' onClick={() => setDiscarding(undefined)}>{t('common.cancel')}</Button>
            <Button
              size='small'
              variant='danger'
              onClick={() => {
                setStash(discardStash(target, discarding.id));
                setDiscarding(undefined);
              }}
            >
              {t('common.delete')}
            </Button>
          </div>
        </div>
      )}
      {stash.length > 0 && (
        <>
          <h4>{t('history.stashed')}</h4>
          <ul>
            {stash.map(stashed =>
              row(
                `s:${stashed.id}`,
                <span className='history-subject'>{dates.format(new Date(stashed.saved))}</span>,
                <Button
                  size='icon'
                  aria-label={t('history.discardStash')}
                  title={t('history.discardStash')}
                  onClick={() => setDiscarding(stashed)}
                >
                  <Trash2 aria-hidden='true' />
                </Button>,
              )
            )}
          </ul>
        </>
      )}
      {versionList.length > 0 && (
        <>
          <h4>{t('history.versions')}</h4>
          <ul>
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
                  {!placedVersions.has(version) && <small className='history-meta'>{dates.format(new Date(version.authored))}</small>}
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
          </ul>
        </>
      )}
      <h4>{t('history.changes')}</h4>
      <ul>
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
              <Button
                size='icon'
                aria-label={t('history.markVersion')}
                title={t('history.markVersion')}
                onClick={() => setDialog({ mode: 'mark', entry })}
              >
                <Tag aria-hidden='true' />
              </Button>
            ),
          );
        })}
      </ul>
      {loading ? <LoadingStatus className='note-history-hint'>{t('history.loading')}</LoadingStatus> : !entries.length ? <p className='note-history-hint'>{t('history.empty')}</p> : more && <Button size='small' className='note-history-more' onClick={() => void load(page + 1)}>{t('history.loadMore')}</Button>}
      {opened && history.points.has(opened) && <HistoryReader history={history} start={opened} onRestore={onRestore && (point => restore(point))} onClose={() => setOpened(undefined)} />}
      {dialog && (
        <VersionDialog
          target={target}
          dialog={dialog}
          versions={versions}
          onClose={() => setDialog(undefined)}
          onSave={async text => {
            setBusy(true);
            try {
              if (dialog.mode === 'edit') setVersions(await changeVersion(target, { action: 'update', sequence: dialog.version.sequence, ...text }));
              else if (dialog.mode === 'new') {
                await onCommitVersion!(text);
                await load(1);
              } else setVersions(await changeVersion(target, { action: 'create', commit: dialog.entry.commit, at: dialog.entry.path, include: text.include ?? [], name: text.name, note: text.note }));
              setDialog(undefined);
            } finally {
              setBusy(false);
            }
          }}
          entry={dialog.mode === 'mark' ? dialog.entry : undefined}
        />
      )}
    </section>
  );
}

const pointTime = (point: Point) => point.key === CURRENT ? Infinity : Date.parse(point.date);

/** What the reader compares with: the file's previous saved change, or another point by key. */
const PREVIOUS = 'previous';

/** Shows one point's full text; Compare shows the lines changed against its previous change or another point; Restore puts its text in the editor. */
function HistoryReader({ history, start, onRestore, onClose }: { history: NoteHistory; start: string; onRestore?: (point: Point) => Promise<void>; onClose: () => void; }) {
  const { t } = useTranslation();
  const { entries, more, page, load, points, pointTitle, placed, label, dates } = history;
  const point = points.get(start)!;
  const index = point.entry ? entries.indexOf(point.entry) : -1;
  const latest = entries[0] && `c:${entries[0].commit}`;
  const [comparing, setComparing] = useState(false);
  const [other, setOther] = useState(() => index >= 0 ? PREVIOUS : latest && latest !== point.key ? latest : '');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [preview, setPreview] = useState<{ diff: string; text?: string; title: string; loading: boolean; error: string; }>({ diff: '', title: '', loading: true, error: '' });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const content = await point.load();
      if (!comparing) return { diff: 'notice' in content ? noticeDiff(content) : '', text: textOf(content) ?? undefined, title: t('history.textAt', { when: pointTitle(point) }) };
      if (other === PREVIOUS) {
        // The previous change of the last listed commit may be on the next page.
        if (index === entries.length - 1 && more) {
          await load(page + 1);
          return;
        }
        const previous = entries[index + 1];
        const before = previous ? await points.get(`c:${previous.commit}`)!.load() : null;
        const notice = 'notice' in content ? content : before && 'notice' in before ? before : undefined;
        return { diff: notice ? noticeDiff(notice) : createUnifiedDiff(previous?.path ?? point.path, point.path, textOf(before), textOf(content)), title: previous ? t('history.changesAt', { when: pointTitle(point) }) : t('history.firstAt', { when: pointTitle(point) }) };
      }
      const compared = points.get(other);
      if (!compared) return { diff: '', title: '' };
      const [older, newer] = [point, compared].sort((a, b) => pointTime(a) - pointTime(b));
      const [before, after] = await Promise.all([older.load(), newer.load()]);
      const notice = 'notice' in before ? before : 'notice' in after ? after : undefined;
      return { diff: notice ? noticeDiff(notice) : createUnifiedDiff(older.path, newer.path, textOf(before), textOf(after)), title: t('history.comparing', { from: pointTitle(older), to: pointTitle(newer) }) };
    };
    /* eslint-disable react/set-state-in-effect -- Mark the reader as loading while its cancellable read runs; the read owns the result. */
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
  }, [comparing, entries, index, load, more, other, page, point, pointTitle, points, t]);

  const optionLabel = (candidate: Point) => {
    if (candidate.key === CURRENT || candidate.stashed) return pointTitle(candidate);
    const version = candidate.version ?? (candidate.entry && placed.get(candidate.entry.commit)?.[0]);
    const when = dates.format(new Date(candidate.date));
    const text = version ? `${label(version).text} (${when})` : candidate.entry ? `${when} · ${plainSubject(candidate.entry.subject)}` : when;
    return candidate.key === latest ? `${t('history.latestVersion')} · ${text}` : text;
  };
  // The previous change, the latest version and the editor's text come first; then every other point, newest first.
  const firsts = [latest, CURRENT];
  const others = [...points.values()].filter(candidate => candidate.key !== point.key);
  const options = [...(index >= 0 ? [{ value: PREVIOUS, label: t('history.previousChange') }] : []), ...[...firsts.flatMap(key => others.filter(candidate => candidate.key === key)), ...others.filter(candidate => !firsts.includes(candidate.key))].map(candidate => ({ value: candidate.key, label: optionLabel(candidate) }))];
  const entry = point.entry;
  const canRestore = onRestore && point.key !== CURRENT && preview.text !== undefined && !preview.loading && !preview.error && !comparing;
  const restore = async () => {
    setRestoring(true);
    setRestoreError('');
    try {
      await onRestore!(point);
    } catch (failure) {
      setRestoreError((failure as Error).message);
      setRestoring(false);
    }
  };

  return (
    <WorkspaceDialog title={pointTitle(point)} className='changes-dialog history-reader' onClose={onClose}>
      <header className='history-reader-bar'>
        <div className='history-reader-meta'>
          {entry && <span className='history-subject'>{plainSubject(entry.subject)}</span>}
          <small className='history-meta'>
            {entry?.agent && (
              <span className='history-badge' title={t('history.agentTitle')}>
                <Bot aria-hidden='true' />
                {t('history.agent')}
              </span>
            )}
            {point.date && <span>{dates.format(new Date(point.date))}</span>}
            {entry?.author && <span>{entry.author}</span>}
          </small>
          {point.version?.note && <small className='history-note'>{point.version.note}</small>}
        </div>
        {comparing && options.length > 0 && <Select aria-label={t('history.compareWith')} value={other} onValueChange={setOther} options={options} className='history-compare-with' />}
        <Button aria-pressed={comparing} disabled={!options.length} onClick={() => setComparing(current => !current)}>
          <GitCompare aria-hidden='true' />
          {t('history.compare')}
        </Button>
        {canRestore && (
          <Button disabled={restoring} onClick={() => void restore()}>
            <RotateCcw aria-hidden='true' />
            {t(point.stashed ? 'history.restoreStash' : 'history.restore')}
          </Button>
        )}
      </header>
      {restoreError && <p role='alert' className='note-history-hint note-history-error'>{restoreError}</p>}
      {!comparing && preview.text !== undefined && !preview.loading && !preview.error
        ? (
          <section className='changes-preview' aria-label={preview.title}>
            <pre tabIndex={0} className='history-text'>{preview.text}</pre>
          </section>
        )
        : <DiffPreview diff={preview.diff} loading={preview.loading} error={preview.error} title={preview.title || pointTitle(point)} emptyText={t('history.noChange')} />}
    </WorkspaceDialog>
  );
}

/** Gives a version number, with an optional name and note: to the changes being committed, a past change, or an existing version. */
function VersionDialog({ target, dialog, versions, entry, onClose, onSave }: { target: HistoryTarget; dialog: VersionDialogMode; versions: NoteVersion[]; entry?: HistoryEntry; onClose: () => void; onSave: (text: VersionText & { include?: string[]; }) => Promise<void>; }) {
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
    <WorkspaceDialog title={t(dialog.mode === 'edit' ? 'history.editTitle' : dialog.mode === 'new' ? 'history.commitVersion' : 'history.newVersion')} onClose={() => !saving && onClose()}>
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
        {dialog.mode === 'new' && <p className='text-xs text-muted'>{t('history.saveFirst')}</p>}
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
