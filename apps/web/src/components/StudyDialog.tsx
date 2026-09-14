import { useMemo, useRef, useState } from 'react';
import { splitNotePages } from '@github-notes/core/note-pages';
import { applyStudyAction, createStudyNote, findStudyNote, previewStudyRating, reconcileStudyNote, rebindStudyNote,
  studyCardContent, StudyPolicySchema, undoStudyAction, type StudyWorkspace } from '@github-notes/core/study';
import type { NoteItem } from '../lib/types.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { renderNote } from '../lib/markdown.js';
import { useTranslation } from '../lib/i18n/index.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';

export function StudyDialog({ note, controller, onClose }: { note: NoteItem; controller: StudyController; onClose: () => void }) {
  const { t, language } = useTranslation();
  const stored = findStudyNote(controller.study, note);
  const fresh = useMemo(() => createStudyNote(note), [note.path, note.notebookId, note.content, note.title]);
  const resolved = stored ? reconcileStudyNote(stored, note) : fresh;
  const entry = resolved || stored!;
  const card = entry.cards[0];
  const [mode, setMode] = useState<'read' | 'recall'>('read'), [page, setPage] = useState(0), [revealed, setRevealed] = useState(false);
  const [customDate, setCustomDate] = useState(''), [message, setMessage] = useState(''), [settings, setSettings] = useState(false);
  const [retention, setRetention] = useState(String(card.policy.retention * 100)), [intervals, setIntervals] = useState(card.policy.intervals.join(', '));
  const pointer = useRef<{ x: number; y: number; id: number }>();
  const [now, setNow] = useState(() => new Date());
  const readingPages = useMemo(() => splitNotePages(note.content), [note.content]);
  const shown = mode === 'read' ? readingPages : studyCardContent(entry, card, revealed ? 'back' : 'front');
  const visiblePage = Math.min(page, shown.length - 1);
  const html = useMemo(() => renderNote(shown[visiblePage], note.path), [shown[visiblePage], note.path]);
  const unsupported = card.kind !== 'forward' || entry.cards.length !== 1;
  const disabled = controller.loading || controller.saving || !controller.writable;
  const canReview = !disabled && Boolean(resolved) && !unsupported;
  const formatDate = (value: string) => new Date(value).toLocaleString(language === 'zh-TW' ? 'zh-TW' : 'en', { dateStyle: 'medium', timeStyle: 'short' });
  const last = controller.study.events.at(-1);
  const canUndo = last?.noteId === entry.id && last.before && last.kind !== 'undo';
  const persist = async (change: (workspace: StudyWorkspace) => StudyWorkspace, success = t('study.saved')) => {
    if (await controller.save(change)) { setMessage(success); setNow(new Date()); }
  };
  const nextDay = (days: number) => { const value = new Date(); value.setDate(value.getDate() + days); return value.toISOString(); };
  const readLater = (due: string) => {
    if (!resolved) return;
    if (!Number.isFinite(Date.parse(due)) || Date.parse(due) <= Date.now()) { setMessage(t('study.futureRequired')); return; }
    void persist(workspace => applyStudyAction(workspace, entry, card.id, { kind: 'read', due }), `${t('study.next')}: ${formatDate(due)}`);
  };
  const rate = (rating: 1 | 2 | 3 | 4) => {
    if (!revealed || !canReview) return;
    const time = new Date(), due = previewStudyRating(card, rating, time).due;
    void controller.save(workspace => applyStudyAction(workspace, entry, card.id, { kind: 'review', rating }, time)).then(ok => {
      if (ok) { setRevealed(false); setPage(0); setNow(new Date()); setMessage(`${t('study.next')}: ${formatDate(due)}`); }
    });
  };
  const switchMode = (next: 'read' | 'recall') => { setMode(next); setRevealed(false); setPage(0); setMessage(''); setNow(new Date()); };
  return <WorkspaceDialog title={`${t('study.title')} · ${note.title}`} className="study-dialog" onClose={() => { if (!controller.saving) onClose(); }}>
    <div className="study-toolbar" role="group" aria-label={t('study.mode')}>
      <button className="ui-button" aria-pressed={mode === 'read'} onClick={() => switchMode('read')}>{t('study.read')}</button>
      <button className="ui-button" aria-pressed={mode === 'recall'} onClick={() => switchMode('recall')}>{t('study.recall')}</button>
      <button className="ui-button" aria-expanded={settings} onClick={() => { setRetention(String(card.policy.retention * 100)); setIntervals(card.policy.intervals.join(', ')); setSettings(!settings); }}>{t('study.settings')}</button>
    </div>
    {controller.error && <div role="alert" className="study-alert">{controller.error}<button className="ui-button" disabled={controller.saving} onClick={() => void controller.reload()}>{t('study.reload')}</button></div>}
    {!resolved && <div role="alert" className="study-alert"><p>{t('study.changed')}</p>
      <button className="ui-button" disabled={disabled || unsupported} onClick={() => void persist(workspace => rebindStudyNote(workspace, stored!, note, false))}>{t('study.rebindKeep')}</button>
      <button className="ui-button" disabled={disabled || unsupported} onClick={() => void persist(workspace => rebindStudyNote(workspace, stored!, note, true))}>{t('study.rebindReset')}</button>
    </div>}
    {unsupported && <p role="status">{t('study.mappingFuture')}</p>}
    {settings && <form className="study-settings" onSubmit={event => {
      event.preventDefault();
      const policy = StudyPolicySchema.safeParse({ retention: Number(retention) / 100, intervals: intervals.split(',').map(value => Number(value.trim())) });
      if (!policy.success) { setMessage(t('study.invalidPolicy')); return; }
      void persist(workspace => applyStudyAction(workspace, entry, card.id, { kind: 'configure', policy: policy.data }));
    }}>
      <label>{t('study.retention')}<input className="ui-control" type="number" min="70" max="97" step="1" value={retention} onChange={event => setRetention(event.target.value)} /></label>
      <label>{t('study.intervals')}<input className="ui-control" value={intervals} onChange={event => setIntervals(event.target.value)} /></label>
      <p>{t('study.policyHint')}</p>
      <button className="ui-button" disabled={!canReview}>{t('study.saveSettings')}</button>
    </form>}
    <div className="study-face-label">{mode === 'recall' ? t(revealed ? 'study.answer' : 'study.question') : t('study.read')}
      <span>{visiblePage + 1} / {shown.length}</span></div>
    <div className="study-page" tabIndex={0} aria-label={t('study.page')}
      onPointerDown={event => {
        if (event.pointerType === 'mouse' || (event.target as HTMLElement).closest('a,button,input,textarea,select')) return;
        pointer.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      }}
      onPointerCancel={() => { pointer.current = undefined; }}
      onPointerUp={event => {
        const start = pointer.current; pointer.current = undefined;
        if (!start || start.id !== event.pointerId || window.getSelection()?.toString()) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (Math.abs(dx) < 75 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if (mode === 'read') setPage(value => Math.max(0, Math.min(shown.length - 1, value + (dx < 0 ? 1 : -1))));
        else if (revealed) rate(dx < 0 ? 1 : 3);
      }}>
      <div className="prose-custom" data-markdown-view dangerouslySetInnerHTML={{ __html: html }} />
    </div>
    <div className="study-page-nav">
      <button className="ui-button" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>{t('study.previousPage')}</button>
      <button className="ui-button" disabled={visiblePage === shown.length - 1} onClick={() => setPage(visiblePage + 1)}>{t('study.nextPage')}</button>
    </div>
    <div className="study-actions">
      {mode === 'recall' ? <>
        {!revealed ? <button className="ui-button ui-button-primary" disabled={!resolved || unsupported} onClick={() => { setRevealed(true); setPage(0); setNow(new Date()); }}>{t('study.reveal')}</button>
          : <div className="study-ratings">{([1, 2, 3, 4] as const).map(rating => <button key={rating} className="ui-button" disabled={!canReview} onClick={() => rate(rating)}>
            {t((['study.again', 'study.hard', 'study.good', 'study.easy'] as const)[rating - 1])}<small>{formatDate(previewStudyRating(card, rating, now).due)}</small>
          </button>)}</div>}
        <button className="ui-button" disabled={!canReview} onClick={() => void persist(workspace => applyStudyAction(workspace, entry, card.id, { kind: card.enabled ? 'suspend' : 'resume' }))}>{t(card.enabled ? 'study.pause' : 'study.enroll')}</button>
        <p className="study-hint">{t('study.recallHint')}</p>
      </> : <>
        <div className="study-reading-actions">
          <button className="ui-button" disabled={!canReview} onClick={() => readLater(nextDay(1))}>{t('study.tomorrow')}</button>
          <button className="ui-button" disabled={!canReview} onClick={() => readLater(nextDay(3))}>{t('study.threeDays')}</button>
          <button className="ui-button" disabled={!canReview} onClick={() => void persist(workspace => applyStudyAction(workspace, entry, card.id, { kind: 'fixed' }))}>{t('study.fixed')}</button>
        </div>
        <form className="study-custom-delay" onSubmit={event => { event.preventDefault(); const value = new Date(customDate); if (!Number.isFinite(value.getTime())) setMessage(t('study.futureRequired')); else readLater(value.toISOString()); }}>
          <label>{t('study.custom')}<input className="ui-control" type="datetime-local" value={customDate} onChange={event => setCustomDate(event.target.value)} required /></label>
          <button className="ui-button" disabled={!canReview}>{t('study.delay')}</button>
        </form>
        <p className="study-hint">{t('study.readHint')}</p>
      </>}
      <div className="study-footer-actions"><button className="ui-button" disabled={controller.saving} onClick={onClose}>{t('study.skip')}</button>
        <button className="ui-button" disabled={disabled || !canUndo} onClick={() => void persist(workspace => undoStudyAction(workspace), t('study.undone'))}>{t('study.undo')}</button></div>
    </div>
    <div className="study-result" role="status">{controller.saving ? t('study.saving') : message || t('study.ready')}</div>
    {(card.enabled || entry.reading.due) && <div className="study-schedule">
      {card.enabled && <span>{t('study.memoryDue')}: {formatDate(card.scheduler.due)}</span>}
      {entry.reading.due && <span>{t('study.readingDue')}: {formatDate(entry.reading.due)}</span>}
    </div>}
  </WorkspaceDialog>;
}
