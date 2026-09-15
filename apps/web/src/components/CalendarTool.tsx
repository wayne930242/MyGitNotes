import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { NoteItem, NotebookConfig } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { buildMonthGrid } from '../lib/calendar-grid.js';
import { formatDateYMD, getLocaleWeekStartDay } from '../lib/date-utils.js';
import { extractTodoTasks } from '../lib/todo-list.js';
import { buildDayCounts, notesForDay, tasksForDay } from '../lib/note-day-index.js';

interface CalendarToolProps {
  notes: NoteItem[];
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  onOpenNote: (note: NoteItem) => void;
}

export function CalendarTool({ notes, notebooks, selectedNotebookId, onOpenNote }: CalendarToolProps) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayField, setDayField] = useState<'created' | 'updated'>('created');

  const scopedNotes = useMemo(
    () => (scope === 'all' || notebooks.length <= 1 ? notes : notes.filter(note => note.notebookId === selectedNotebookId)),
    [notes, notebooks.length, scope, selectedNotebookId]
  );
  const tasks = useMemo(() => extractTodoTasks(scopedNotes), [scopedNotes]);
  const dayCounts = useMemo(() => buildDayCounts(scopedNotes, tasks), [scopedNotes, tasks]);
  const weekStartDay = useMemo(() => getLocaleWeekStartDay(), []);
  const grid = useMemo(() => buildMonthGrid(cursor.getFullYear(), cursor.getMonth(), weekStartDay), [cursor, weekStartDay]);
  const todayYMD = formatDateYMD(new Date());
  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
    return grid.slice(0, 7).map(day => formatter.format(day));
  }, [grid]);

  const dayNotes = selectedDay ? notesForDay(scopedNotes, selectedDay, dayField) : [];
  const dayTasks = selectedDay ? tasksForDay(tasks, selectedDay) : [];

  return (
    <div className="panel-tool calendar-tool">
      <div className="panel-tool-header">
        {notebooks.length > 1 && (
          <select className="ui-control" aria-label={t('filters.notebook')} value={scope} onChange={event => setScope(event.target.value as 'current' | 'all')}>
            <option value="current">{t('panel.scopeCurrentNotebook')}</option>
            <option value="all">{t('panel.scopeAllNotebooks')}</option>
          </select>
        )}
        <div className="calendar-month-nav">
          <button type="button" className="ui-icon-button" aria-label="Previous month" onClick={() => setCursor(value => new Date(value.getFullYear(), value.getMonth() - 1, 1))}><ChevronLeft aria-hidden="true" /></button>
          <strong>{new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' }).format(cursor)}</strong>
          <button type="button" className="ui-icon-button" aria-label="Next month" onClick={() => setCursor(value => new Date(value.getFullYear(), value.getMonth() + 1, 1))}><ChevronRight aria-hidden="true" /></button>
        </div>
      </div>

      <div className="calendar-grid" role="grid">
        {weekdayLabels.map(label => <div key={label} className="calendar-weekday" role="columnheader">{label}</div>)}
        {grid.map(day => {
          const key = formatDateYMD(day);
          const counts = dayCounts.get(key);
          const inMonth = day.getMonth() === cursor.getMonth();
          return (
            <button type="button" key={key} role="gridcell"
              className="calendar-day" data-in-month={inMonth} data-today={key === todayYMD} data-selected={key === selectedDay}
              onClick={() => setSelectedDay(current => (current === key ? null : key))}>
              <span className="calendar-day-number">{day.getDate()}</span>
              {counts && (counts.created + counts.updated > 0 || counts.due > 0) && (
                <span className="calendar-day-counts">
                  {counts.created + counts.updated > 0 && <span className="calendar-dot calendar-dot-notes" aria-hidden="true" />}
                  {counts.due > 0 && <span className="calendar-dot calendar-dot-due" aria-hidden="true" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <div className="calendar-day-detail">
          <div className="calendar-day-detail-header">
            <strong>{selectedDay === todayYMD ? t('panel.calendarToday') : selectedDay}</strong>
            <div className="calendar-day-toggle" role="tablist">
              <button type="button" role="tab" aria-selected={dayField === 'created'} onClick={() => setDayField('created')}>{t('panel.calendarCreated')}</button>
              <button type="button" role="tab" aria-selected={dayField === 'updated'} onClick={() => setDayField('updated')}>{t('panel.calendarUpdated')}</button>
            </div>
          </div>
          <ul className="calendar-day-notes">
            {dayNotes.length === 0 && <li className="calendar-day-empty">{t('panel.calendarNoNotes')}</li>}
            {dayNotes.map(note => (
              <li key={note.path}><button type="button" onClick={() => onOpenNote(note)}>{note.title}</button></li>
            ))}
          </ul>
          <ul className="calendar-day-tasks">
            {dayTasks.length === 0 && <li className="calendar-day-empty">{t('panel.calendarNoTasks')}</li>}
            {dayTasks.map(task => (
              <li key={task.id} data-checked={task.checked}>
                <button type="button" onClick={() => onOpenNote(scopedNotes.find(note => note.path === task.notePath)!)}>{task.noteTitle}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
