import { Button } from './Button.js';
import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Undo2 } from 'lucide-react';
import type { ScreenRow } from '@github-notes/core/screen-page';
import { findStudyNote, createStudyNote, reconcileStudyNote, rebindStudyNote, studyCardContent } from '@github-notes/core/study';
import { nextStudyStage, type StudyProgression, type Familiarity } from '@github-notes/core/study-stages';
import { splitNotePages } from '@github-notes/core/note-pages';
import type { NoteItem } from '../lib/types.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { renderNote } from '../lib/markdown.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Select } from './Select.js';

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

export function StudyLane({ row, mode, notes, allNotes, controller, disabled, onOpen }: {
  row: ScreenRow; mode: 'reading' | 'study'; notes: NoteItem[]; allNotes: NoteItem[]; controller: StudyController; disabled: boolean; onOpen: (note: NoteItem) => void;
}) {
  const { t } = useTranslation();
  const [skipped, setSkipped] = useState<string[]>([]), [selected, setSelected] = useState<string>();
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
  return <div className="study-lane">
    <div className="study-lane-navigation">
      <div className="study-card-navigation">
        <Button size="icon" disabled={!previous} aria-label={t('study.previousCard')} onClick={() => move(-1)}><ChevronLeft size={18} /></Button>
        <Button size="icon" disabled={!next} aria-label={t('study.nextCard')} onClick={() => move(1)}><ChevronRight size={18} /></Button>
      </div>
      <Select className="study-pick-card" aria-label={t('study.pickCard')} value={current?.path || ''} disabled={busy || !notes.length}
        onValueChange={setSelected} options={[{ value: '', label: t('study.queueComplete') }, ...notes.map(note => ({ value: note.path, label: note.title }))]} />
      <span>{queue.length} {t('study.remaining')}</span>
      <Button size="icon" aria-label={t('study.undo')} title={t('study.undo')} disabled={busy || !undoNote} onClick={() => {
        if (undoNote && last) void controller.action(undoNote, row.id, 'undo', { eventId: last.id }).then(ok => { if (ok) { setSkipped(values => values.filter(path => path !== undoNote.path)); setSelected(undoNote.path); } });
      }}><Undo2 size={18} /></Button>
    </div>
    {!row.progression ? <p>{t('study.configureLane')}</p> : current ? <StudyLaneCard mode={mode} key={`${mode}:${current.notebookId}:${current.path}`} note={current} row={row} controller={controller} disabled={busy} onDone={advance} onOpen={() => onOpen(current)} />
      : <div className="study-lane-empty"><p>{t('study.queueComplete')}</p>{notes.length > 0 && <Button  onClick={() => { setSkipped([]); setSelected(notes[0].path); }}>{t('study.pickCard')}</Button>}</div>}
    {controller.error && <div className="study-alert" role="alert">{controller.error}<Button  disabled={controller.saving} onClick={() => void controller.reload()}>{t('study.reload')}</Button></div>}
    {controller.saving && <p role="status">{t('study.saving')}</p>}
  </div>;
}

function StudyLaneCard({ note, row, mode, controller, disabled, onDone, onOpen }: {
  note: NoteItem; row: ScreenRow; mode: 'reading' | 'study'; controller: StudyController; disabled: boolean; onDone: () => void; onOpen: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0), [revealed, setRevealed] = useState(false), [date, setDate] = useState('');
  const pointer = useRef<{ x: number; y: number; id: number }>();
  const fresh = useMemo(() => createStudyNote(note), [note.content, note.path, note.notebookId, note.title]);
  const stored = findStudyNote(controller.study, note), resolved = stored ? reconcileStudyNote(stored, note) : fresh;
  const entry = resolved || stored!, supported = entry.cards.length === 1 && entry.cards[0].kind === 'forward';
  const front = studyCardContent(entry, entry.cards[0], 'front');
  const pages = mode === 'reading' ? splitNotePages(note.content) : [...front, ...(revealed ? studyCardContent(entry, entry.cards[0], 'back') : [])];
  const index = Math.min(page, pages.length - 1), canRate = !disabled && Boolean(resolved) && supported && (mode === 'reading' || revealed);
  const rate = (rating: Familiarity) => { if (canRate) void controller.action(note, row.id, mode === 'study' ? 'stage-review' : 'stage-read', { rating }).then(ok => { if (ok) onDone(); }); };
  return <article className="study-lane-card" data-study-note={note.path}>
    <header><span>{note.status || row.progression!.stages[0].status}</span><span>{mode === 'study' ? t(index >= front.length ? 'study.answer' : 'study.question') : t('study.read')} · {index + 1} / {pages.length}</span>
      <Button size="icon" aria-label={`${t('links.open')}: ${note.title}`} onClick={onOpen}><ExternalLink size={16} /></Button></header>
    {!resolved && <div className="study-alert" role="alert"><p>{t('study.changed')}</p>
      <Button  disabled={disabled || !supported} onClick={() => void controller.save(workspace => rebindStudyNote(workspace, stored!, note, false))}>{t('study.rebindKeep')}</Button></div>}
    <div className="study-page" tabIndex={0} aria-label={t('study.page')}
      onPointerDown={event => { if (event.pointerType !== 'mouse' && !(event.target as HTMLElement).closest('a,button,input,select')) pointer.current = { x: event.clientX, y: event.clientY, id: event.pointerId }; }}
      onPointerCancel={() => { pointer.current = undefined; }} onPointerUp={event => {
        const start = pointer.current; pointer.current = undefined;
        if (!start || start.id !== event.pointerId || window.getSelection()?.toString()) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (Math.abs(dx) < 75 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if (mode === 'reading') setPage(value => Math.max(0, Math.min(pages.length - 1, value + (dx < 0 ? 1 : -1))));
        else rate(dx < 0 ? 1 : 3);
      }}><div className="prose-custom" data-markdown-view dangerouslySetInnerHTML={{ __html: renderNote(pages[index], note.path) }} /></div>
    {pages.length > 1 && <div className="study-page-nav"><Button size="icon" disabled={index === 0} aria-label={t('study.previousPage')} onClick={() => setPage(index - 1)}><ChevronLeft size={18} /></Button>
      <Button size="icon" disabled={index === pages.length - 1} aria-label={t('study.nextPage')} onClick={() => setPage(index + 1)}><ChevronRight size={18} /></Button></div>}
    {mode === 'study' && !revealed ? <Button variant="primary" className="study-reveal" disabled={disabled || !resolved || !supported} onClick={() => { setRevealed(true); setPage(front.length); }}>{t('study.reveal')}</Button>
      : <div className="study-ratings">{([1, 2, 3, 4] as const).map(rating => {
        const target = nextStudyStage(row.progression!, note.status, rating);
        return <Button  data-rating={rating} key={rating} disabled={!canRate} onClick={() => rate(rating)}>
          <span>{t((['study.again', 'study.hard', 'study.good', 'study.easy'] as const)[rating - 1])}</span><small>{target.status} · {target.intervalDays} {t('study.days')}</small>
        </Button>;
      })}</div>}
    <footer><Button  disabled={disabled} onClick={onDone}>{t('study.skip')}</Button>
      {mode === 'reading' && <details className="study-postpone"><summary>{t('study.custom')}</summary><form onSubmit={event => {
        event.preventDefault(); const due = new Date(date); if (Number.isFinite(due.getTime())) void controller.action(note, row.id, 'stage-postpone', { due: due.toISOString() }).then(ok => { if (ok) onDone(); });
      }}><input className="ui-control" type="datetime-local" aria-label={t('study.custom')} value={date} required onChange={event => setDate(event.target.value)} /><Button type="submit"  disabled={disabled || !resolved}>{t('study.delay')}</Button></form></details>}
    </footer>
  </article>;
}
