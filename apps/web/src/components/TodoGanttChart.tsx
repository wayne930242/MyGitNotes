import { useMemo } from 'react';
import { useTranslation } from '../lib/i18n/index.js';
import { stripTaskTokens } from '../lib/task-tokens.js';
import { computeGanttRange, computeGanttRows, computeGanttTicks, type GanttRow } from '../lib/todo-gantt.js';
import type { TodoTask } from '../lib/todo-list.js';

const DAY_WIDTH = 28;

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

export function TodoGanttChart({ tasks, today, onOpenTask }: TodoGanttChartProps) {
  const { t } = useTranslation();
  const range = useMemo(() => computeGanttRange(tasks, today), [tasks, today]);
  const rows = useMemo(() => computeGanttRows(tasks, range), [tasks, range]);
  const ticks = useMemo(() => computeGanttTicks(range), [range]);
  const trackWidth = range.days * DAY_WIDTH;

  if (rows.length === 0) return <p className="todo-empty">{t('panel.todoGanttEmpty')}</p>;

  return (
    <div className="todo-gantt" role="group" aria-label={t('panel.todoGanttTimeline')}>
      <div className="todo-gantt-scroll">
        <div className="todo-gantt-header todo-gantt-row">
          <div className="todo-gantt-label-cell" />
          <div className="todo-gantt-track" style={{ width: trackWidth }}>
            {ticks.map(tick => (
              <span key={tick.offset} className="todo-gantt-tick" style={{ left: tick.offset * DAY_WIDTH }}>{tick.date.slice(5)}</span>
            ))}
            <span
              className="todo-gantt-today-line"
              style={{ left: range.todayOffset * DAY_WIDTH }}
              title={t('panel.todoGanttToday')}
              aria-hidden="true"
            />
          </div>
        </div>

        {rows.map(row => (
          <div className="todo-gantt-row" key={row.task.id}>
            <button
              type="button"
              className="todo-gantt-label-cell todo-gantt-label-button"
              title={row.task.noteTitle}
              onClick={() => onOpenTask(row.task)}
            >
              {stripTaskTokens(row.task.lineText)}
            </button>
            <div className="todo-gantt-track" style={{ width: trackWidth }}>
              <span className="todo-gantt-today-line" style={{ left: range.todayOffset * DAY_WIDTH }} aria-hidden="true" />
              <span
                className={`todo-gantt-bar todo-gantt-bar-${row.kind}`}
                style={{ left: row.offset * DAY_WIDTH, width: row.span * DAY_WIDTH }}
                title={barTitle(row)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
