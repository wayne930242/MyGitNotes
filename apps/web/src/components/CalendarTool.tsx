import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { NoteItem, NotebookConfig } from '../lib/types.js';
import { useTranslation, type TranslationKey } from '../lib/i18n/index.js';
import { Select } from './Select.js';
import { buildMonthGrid } from '../lib/calendar-grid.js';
import { formatDateYMD, getLocaleWeekStartDay } from '../lib/date-utils.js';
import { extractTodoTasks } from '../lib/todo-list.js';
import { buildDayCounts, notesForDay, notesForMonth, tasksForDay, tasksForMonth } from '../lib/note-day-index.js';

interface CalendarToolProps {
  notes: NoteItem[];
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  onOpenNote: (note: NoteItem) => void;
}

const MONTH_LABEL_KEYS: TranslationKey[] = [
  'panel.monthJanuary', 'panel.monthFebruary', 'panel.monthMarch', 'panel.monthApril', 'panel.monthMay', 'panel.monthJune',
  'panel.monthJuly', 'panel.monthAugust', 'panel.monthSeptember', 'panel.monthOctober', 'panel.monthNovember', 'panel.monthDecember',
];
const YEAR_RANGE = 6;

export function CalendarTool({ notes, notebooks, selectedNotebookId, onOpenNote }: CalendarToolProps) {
  const { t, language } = useTranslation();
  const locale = language === 'zh-TW' ? 'zh-TW' : 'en-US';
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
  const weekStartDay = useMemo(() => getLocaleWeekStartDay(locale), [locale]);
  const grid = useMemo(() => buildMonthGrid(cursor.getFullYear(), cursor.getMonth(), weekStartDay), [cursor, weekStartDay]);
  const todayYMD = formatDateYMD(new Date());
  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return grid.slice(0, 7).map(day => formatter.format(day));
  }, [grid, locale]);

  const yearOptions = useMemo(() => {
    const current = cursor.getFullYear();
    const options = [];
    for (let year = current - YEAR_RANGE; year <= current + YEAR_RANGE; year++) options.push({ value: String(year), label: String(year) });
    return options;
  }, [cursor]);
  const monthOptions = MONTH_LABEL_KEYS.map((key, index) => ({ value: String(index), label: t(key) }));

  const day = selectedDay
    ? { notes: notesForDay(scopedNotes, selectedDay, dayField), tasks: tasksForDay(tasks, selectedDay) }
    : { notes: notesForMonth(scopedNotes, cursor.getFullYear(), cursor.getMonth(), dayField), tasks: tasksForMonth(tasks, cursor.getFullYear(), cursor.getMonth()) };
  const dayIsEmpty = day.notes.length === 0 && day.tasks.length === 0;

  return (
    <div className="panel-tool calendar-tool">
      <div className="panel-tool-header">
        {notebooks.length > 1 && (
          <Select aria-label={t('filters.notebook')} value={scope} onValueChange={value => setScope(value as 'current' | 'all')}
            options={[{ value: 'current', label: t('panel.scopeCurrentNotebook') }, { value: 'all', label: t('panel.scopeAllNotebooks') }]} />
        )}
      </div>

      <div className="calendar-month-nav">
        <button type="button" className="ui-icon-button" aria-label={t('panel.previousMonth')} onClick={() => { setCursor(value => new Date(value.getFullYear(), value.getMonth() - 1, 1)); setSelectedDay(null); }}><ChevronLeft aria-hidden="true" /></button>
        <Select aria-label={t('panel.selectMonth')} className="calendar-month-select" value={String(cursor.getMonth())}
          onValueChange={value => { setCursor(current => new Date(current.getFullYear(), Number(value), 1)); setSelectedDay(null); }} options={monthOptions} />
        <Select aria-label={t('panel.selectYear')} className="calendar-year-select" value={String(cursor.getFullYear())}
          onValueChange={value => { setCursor(current => new Date(Number(value), current.getMonth(), 1)); setSelectedDay(null); }} options={yearOptions} />
        <button type="button" className="ui-icon-button" aria-label={t('panel.nextMonth')} onClick={() => { setCursor(value => new Date(value.getFullYear(), value.getMonth() + 1, 1)); setSelectedDay(null); }}><ChevronRight aria-hidden="true" /></button>
      </div>

      <div className="calendar-grid" role="grid">
        {weekdayLabels.map(label => <div key={label} className="calendar-weekday" role="columnheader">{label}</div>)}
        {grid.map(gridDay => {
          const key = formatDateYMD(gridDay);
          const counts = dayCounts.get(key);
          const inMonth = gridDay.getMonth() === cursor.getMonth();
          return (
            <button type="button" key={key} role="gridcell"
              className="calendar-day" data-in-month={inMonth} data-today={key === todayYMD} data-selected={key === selectedDay}
              onClick={() => setSelectedDay(current => (current === key ? null : key))}>
              <span className="calendar-day-number">{gridDay.getDate()}</span>
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

      <div className="calendar-day-detail">
        <div className="calendar-day-detail-header">
          <strong>{selectedDay ? (selectedDay === todayYMD ? t('panel.calendarToday') : selectedDay) : t('panel.calendarThisMonth')}</strong>
          <div className="calendar-day-toggle" role="tablist">
            <button type="button" role="tab" aria-selected={dayField === 'created'} onClick={() => setDayField('created')}>{t('panel.calendarCreated')}</button>
            <button type="button" role="tab" aria-selected={dayField === 'updated'} onClick={() => setDayField('updated')}>{t('panel.calendarUpdated')}</button>
          </div>
        </div>
        {dayIsEmpty ? <p className="calendar-day-empty">{t('panel.calendarNoItems')}</p> : <>
          {day.notes.length > 0 && <ul className="calendar-day-notes">
            {day.notes.map(note => (
              <li key={note.path}><button type="button" onClick={() => onOpenNote(note)}>{note.title}</button></li>
            ))}
          </ul>}
          {day.tasks.length > 0 && <ul className="calendar-day-tasks">
            {day.tasks.map(task => (
              <li key={task.id} data-checked={task.checked}>
                <button type="button" onClick={() => onOpenNote(scopedNotes.find(note => note.path === task.notePath)!)}>{task.noteTitle}</button>
              </li>
            ))}
          </ul>}
        </>}
      </div>
    </div>
  );
}
