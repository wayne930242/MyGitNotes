import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../lib/i18n/index.js';
import { stripTaskTokens } from '../lib/task-tokens.js';
import { computeGanttRange, computeGanttRows, computeGanttTicks, GANTT_SCALES, ganttDayWidth, type GanttRow, type GanttScale, getSavedGanttScale, saveGanttScale } from '../lib/todo-gantt.js';
import type { TodoTask } from '../lib/todo-list.js';
import { Button } from './Button.js';

/** Days of history kept visible left of today when the chart first opens or the scale changes. */
const LEAD_DAYS = 2;

const SCALE_LABEL_KEY: Record<GanttScale, 'panel.todoGanttScaleDay' | 'panel.todoGanttScaleWeek' | 'panel.todoGanttScaleMonth'> = { day: 'panel.todoGanttScaleDay', week: 'panel.todoGanttScaleWeek', month: 'panel.todoGanttScaleMonth' };

interface TodoGanttChartProps {
  tasks: TodoTask[];
  today: string;
  onOpenTask: (task: TodoTask) => void;
}

function barTitle(row: GanttRow): string {
  const text = stripTaskTokens(row.task.lineText);
  if (row.kind === 'range') return `${text} · ${row.task.start} → ${row.task.due}`;
  if (row.kind === 'dueOnly') return `${text} · ${row.task.due}`;
  return `${text} · ${row.task.start}`;
}

/** `'day'`/`'week'` ticks show `MM-DD`; `'month'` ticks show a locale month/year (e.g. "Sep 2026" / "2026年9月"). */
function tickLabel(date: string, scale: GanttScale, language: string): string {
  if (scale !== 'month') return date.slice(5);
  const [year, month] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short' }).format(Date.UTC(year, month - 1, 1));
}

export function TodoGanttChart({ tasks, today, onOpenTask }: TodoGanttChartProps) {
  const { t, language } = useTranslation();
  const [scale, setScale] = useState<GanttScale>(getSavedGanttScale);
  const dayWidth = ganttDayWidth(scale);
  const range = useMemo(() => computeGanttRange(tasks, today, scale), [tasks, today, scale]);
  const rows = useMemo(() => computeGanttRows(tasks, range), [tasks, range]);
  const ticks = useMemo(() => computeGanttTicks(range, scale), [range, scale]);
  const trackWidth = range.days * dayWidth;
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasRows = rows.length > 0;

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, (range.todayOffset - LEAD_DAYS) * dayWidth);
  }, [range.todayOffset, dayWidth, hasRows]);

  const changeScale = (next: GanttScale) => {
    setScale(next);
    saveGanttScale(next);
  };

  const scaleToggle = <div className='todo-gantt-scale-toggle' role='group'>{GANTT_SCALES.map(option => <Button key={option} type='button' aria-pressed={scale === option} onClick={() => changeScale(option)}>{t(SCALE_LABEL_KEY[option])}</Button>)}</div>;

  if (rows.length === 0) {
    return (
      <>
        {scaleToggle}
        <p className='todo-empty'>{t('panel.todoGanttEmpty')}</p>
      </>
    );
  }

  return (
    <div className='todo-gantt' role='group' aria-label={t('panel.todoGanttTimeline')}>
      {scaleToggle}
      <div className='todo-gantt-scroll' ref={scrollRef}>
        <div className='todo-gantt-header todo-gantt-row'>
          <div className='todo-gantt-label-cell' />
          <div className='todo-gantt-track' style={{ width: trackWidth }}>
            {ticks.map(tick => <span key={tick.offset} className='todo-gantt-tick' style={{ left: tick.offset * dayWidth }}>{tickLabel(tick.date, scale, language)}</span>)}
            <span className='todo-gantt-today-line' style={{ left: range.todayOffset * dayWidth }} title={t('panel.todoGanttToday')} aria-hidden='true' />
          </div>
        </div>
        {rows.map(row => (
          <div className='todo-gantt-row' key={row.task.id}>
            <button type='button' className='todo-gantt-label-cell todo-gantt-label-button' title={`${stripTaskTokens(row.task.lineText)} · ${row.task.noteTitle}`} onClick={() => onOpenTask(row.task)}>{stripTaskTokens(row.task.lineText)}</button>
            <div className='todo-gantt-track' style={{ width: trackWidth }}>
              <span className='todo-gantt-today-line' style={{ left: range.todayOffset * dayWidth }} aria-hidden='true' />
              <span className={`todo-gantt-bar todo-gantt-bar-${row.kind}`} style={{ left: row.offset * dayWidth, width: row.span * dayWidth }} title={barTitle(row)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
