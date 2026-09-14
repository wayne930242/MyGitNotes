import { Button } from './Button.js';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Ellipsis, Undo2 } from 'lucide-react';
import type { ScreenRow } from '@github-notes/core/screen-page';
import { findStudyNote, createStudyNote, reconcileStudyNote, rebindStudyNote } from '@github-notes/core/study';
import { nextStudyStage, type StudyProgression, type Familiarity } from '@github-notes/core/study-stages';
import { splitNotePages } from '@github-notes/core/note-pages';
import type { NoteItem } from '../lib/types.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { renderNote } from '../lib/markdown.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Select } from './Select.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';

export function StudyLaneSettings({ progression, disabled, onChange }: { progression: StudyProgression; disabled: boolean; onChange: (value: StudyProgression) => void }) {
  const { t } = useTranslation();
  return <fieldset className="study-stage-settings" disabled={disabled}>
    <legend>{t('study.stages')}</legend>
    <div className="study-stage-labels"><span>{t('study.status')}</span><span>{t('study.intervalDays')}</span></div>
    {progression.stages.map((stage, index) => <div className="study-stage-row" key={index}>
      <input className="ui-control" required aria-label={`${t('study.status')} ${index + 1}`} value={stage.status} onChange={event => onChange({ ...progression, stages: progression.stages.map((value, i) => i === index ? { ...value, status: event.target.value } : value) })} />
      <input className="ui-control" type="number" required min={1 / 1440} max="3650" step="any" aria-label={`${t('study.intervalDays')} ${index + 1}`} value={stage.intervalDays} onChange={event => onChange({ ...progression, stages: progression.stages.map((value, i) => i === index ? { ...value, intervalDays: Number(event.target.value) } : value) })} />
      <Button size="icon" type="button" aria-label={`${t('study.removeStage')} ${index + 1}`} disabled={disabled || progression.stages.length === 1} onClick={() => onChange({ ...progression, stages: progression.stages.filter((_, i) => i !== index) })}>×</Button>
    </div>)}
    <Button type="button"  disabled={disabled || progression.stages.length >= 20} onClick={() => onChange({ ...progression, stages: [...progression.stages, { status: `stage-${progression.stages.length + 1}`, intervalDays: 30 }] })}>{t('study.addStage')}</Button>
    <label>{t('study.easy')}<Select aria-label={t('study.easy')} value={progression.easy} disabled={disabled} onValueChange={easy => onChange({ ...progression, easy: easy as 'two' | 'last' })} options={[{ value: 'two', label: t('study.easyTwo') }, { value: 'last', label: t('study.easyLast') }]} /></label>
    <p>{t('study.stageRules')}</p>
  </fieldset>;
}

export function StudyLane({ row, notes, allNotes, controller, disabled, onOpen }: {
  row: ScreenRow; notes: NoteItem[]; allNotes: NoteItem[]; controller: StudyController; disabled: boolean; onOpen: (note: NoteItem) => void;
}) {
  const { t } = useTranslation();
  const [skipped, setSkipped] = useState<string[]>([]), [selected, setSelected] = useState<string>();
  const [actionsOpen, setActionsOpen] = useState(false);
  const queue = notes.filter(note => !skipped.includes(note.path));
  const current = notes.find(note => note.path === selected) || queue[0];
  const last = controller.study.events.at(-1);
  const lastNote = last?.transition?.laneId === row.id ? controller.study.notes.find(note => note.id === last.noteId) : undefined;
  const undoNote = lastNote && allNotes.find(note => note.path === lastNote.path && note.notebookId === lastNote.notebookId);
  const busy = disabled || controller.loading || controller.saving || !controller.writable;
  const currentIndex = notes.findIndex(note => note === current);
  const previous = !busy && currentIndex > 0, next = !busy && currentIndex >= 0 && currentIndex < notes.length - 1;
  const move = (direction: number) => {
    const target = notes[currentIndex + direction];
    if (!busy && target) setSelected(target.path);
  };
  const advance = () => { if (current) setSkipped(values => [...values, current.path]); setSelected(undefined); };
  const more = <Button size="icon" className="study-more" aria-label={t('study.more')} title={t('study.more')} onClick={() => setActionsOpen(true)}><Ellipsis size={20} /></Button>;
  return <div className="study-lane">
    {!row.progression ? <p>{t('study.configureLane')}</p> : current ? <StudyLaneCard key={`${current.notebookId}:${current.path}`} note={current} row={row} controller={controller} disabled={busy} onDone={advance} onOpen={() => onOpen(current)} previous={previous} next={next} onMove={move} more={more} remaining={queue.length} />
      : <div className="study-lane-empty"><p>{t('study.queueComplete')}</p>{more}</div>}
    {actionsOpen && <WorkspaceDialog title={t('study.more')} onClose={() => setActionsOpen(false)}>
      <div className="study-session-actions">
        <p>{queue.length} {t('study.remaining')}</p>
        <label>{t('study.pickCard')}<Select className="study-pick-card" aria-label={t('study.pickCard')} value={current?.path || ''} disabled={busy || !notes.length}
          onValueChange={value => { setSelected(value); setActionsOpen(false); }} options={[{ value: '', label: t('study.queueComplete') }, ...notes.map(note => ({ value: note.path, label: note.title }))]} /></label>
        <Button disabled={busy || !undoNote} onClick={() => {
          if (undoNote && last) void controller.action(undoNote, row.id, 'undo', { eventId: last.id }).then(ok => { if (ok) { setSkipped(values => values.filter(path => path !== undoNote.path)); setSelected(undoNote.path); setActionsOpen(false); } });
        }} aria-label={t('study.undo')}><Undo2 size={18} />{t('study.undo')}</Button>
        {current && <StudyPostpone key={`${current.notebookId}:${current.path}`} note={current} row={row} controller={controller} disabled={busy} onDone={() => { advance(); setActionsOpen(false); }} />}
        {controller.error && <p role="alert">{controller.error}</p>}
      </div>
    </WorkspaceDialog>}
    {controller.error && <div className="study-alert" role="alert">{controller.error}<Button disabled={controller.saving} onClick={() => void controller.reload()}>{t('study.reload')}</Button></div>}
    {controller.saving && <p role="status">{t('study.saving')}</p>}
  </div>;
}

function StudyPostpone({ note, row, controller, disabled, onDone }: {
  note: NoteItem; row: ScreenRow; controller: StudyController; disabled: boolean; onDone: () => void;
}) {
  const { t } = useTranslation();
  const [date, setDate] = useState('');
  const stored = findStudyNote(controller.study, note);
  const resolved = !stored || Boolean(reconcileStudyNote(stored, note));
  return <form className="study-postpone" onSubmit={event => {
    event.preventDefault();
    const due = new Date(date);
    if (!disabled && resolved && Number.isFinite(due.getTime())) void controller.action(note, row.id, 'stage-postpone', { due: due.toISOString() }).then(ok => { if (ok) onDone(); });
  }}><label>{t('study.custom')}<input className="ui-control" type="datetime-local" aria-label={t('study.custom')} value={date} required onChange={event => setDate(event.target.value)} /></label><Button type="submit" disabled={disabled || !resolved}>{t('study.delay')}</Button></form>;
}

function StudyLaneCard({ note, row, controller, disabled, onDone, onOpen, previous, next, onMove, more, remaining }: {
  note: NoteItem; row: ScreenRow; controller: StudyController; disabled: boolean; onDone: () => void; onOpen: () => void;
  previous: boolean; next: boolean; onMove: (direction: number) => void; more: ReactNode; remaining: number;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0), [revealed, setRevealed] = useState(false);
  const pointer = useRef<{ x: number; y: number; id: number }>();
  const pageBody = useRef<HTMLDivElement>(null);
  const fresh = useMemo(() => createStudyNote(note), [note.content, note.path, note.notebookId, note.title]);
  const stored = findStudyNote(controller.study, note), resolved = stored ? reconcileStudyNote(stored, note) : fresh;
  const entry = resolved || stored!, supported = entry.cards.length === 1 && entry.cards[0].kind === 'forward';
  const pages = useMemo(() => {
    const bodyPages = splitNotePages(note.content);
    return bodyPages.length > 1 ? bodyPages : [note.title, ...bodyPages];
  }, [note.content, note.title]);
  const index = Math.min(page, pages.length - 1), canRate = !disabled && Boolean(resolved) && supported && revealed;
  const turnPage = (target: number) => {
    const value = Math.max(0, Math.min(pages.length - 1, target));
    setPage(value);
    if (value > 0) setRevealed(true);
    pageBody.current?.scrollTo({ top: 0 });
  };
  const rate = (rating: Familiarity) => { if (canRate) void controller.action(note, row.id, 'stage-review', { rating }).then(ok => { if (ok) onDone(); }); };
  return <>
    <article className="study-lane-card" data-study-note={note.path}>
      <header><button type="button" className="screen-card-title" aria-label={`${t('links.open')}: ${note.title}`} onClick={onOpen}>{note.title}</button><span>{note.status || row.progression!.stages[0].status}</span></header>
      {!resolved && <div className="study-alert" role="alert"><p>{t('study.changed')}</p><Button disabled={disabled || !supported} onClick={() => void controller.save(workspace => rebindStudyNote(workspace, stored!, note, false))}>{t('study.rebindKeep')}</Button></div>}
      <div ref={pageBody} className="study-page" tabIndex={0} aria-label={t('study.page')}
        onPointerDown={event => { if (event.pointerType !== 'mouse' && !(event.target as HTMLElement).closest('a,button,input,select,pre')) pointer.current = { x: event.clientX, y: event.clientY, id: event.pointerId }; }}
        onPointerCancel={() => { pointer.current = undefined; }} onPointerUp={event => {
          const start = pointer.current; pointer.current = undefined;
          if (!start || start.id !== event.pointerId || window.getSelection()?.toString()) return;
          const dx = event.clientX - start.x, dy = event.clientY - start.y;
          if (Math.abs(dx) >= 75 && Math.abs(dx) >= Math.abs(dy) * 1.5) turnPage(index + (dx < 0 ? 1 : -1));
        }}><div className="prose-custom" data-markdown-view dangerouslySetInnerHTML={{ __html: renderNote(pages[index], note.path) }} /></div>
    </article>
    <footer className="study-footer" aria-label={t('study.controls')}>
      <div className="study-footer-meta">
        <nav className="study-pages" aria-label={t('study.page')}><span>Page</span>{pages.map((_, i) => <Button key={i} aria-label={`Page ${i + 1}`} aria-pressed={index === i} onClick={() => turnPage(i)}>{i + 1}</Button>)}</nav>
        <span className="study-remaining">{remaining} {t('study.remaining')}</span>{more}
      </div>
      <div className="study-footer-navigation">
        <Button size="icon" disabled={!previous} aria-label={t('study.previousCard')} onClick={() => onMove(-1)}><ChevronLeft size={24} /></Button>
        <Button variant="primary" className="study-reveal" disabled={index === pages.length - 1} onClick={() => turnPage(index + 1)}>{t('study.reveal')}</Button>
        <Button className="study-skip" disabled={disabled} onClick={onDone}>{t('study.skip')}</Button>
        <Button size="icon" disabled={!next} aria-label={t('study.nextCard')} onClick={() => onMove(1)}><ChevronRight size={24} /></Button>
      </div>
      {revealed && <div className="study-ratings">{([1, 2, 3, 4] as const).map(rating => {
        const target = nextStudyStage(row.progression!, note.status, rating);
        return <Button data-rating={rating} key={rating} disabled={!canRate} onClick={() => rate(rating)} title={`${target.status} · ${target.intervalDays} ${t('study.days')}`}>
          <span>{t((['study.again', 'study.hard', 'study.good', 'study.easy'] as const)[rating - 1])}</span><small>{target.intervalDays} {t('study.days')}</small>
        </Button>;
      })}</div>}
    </footer>
  </>;
}
