import { Button } from './Button.js';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, ListTodo } from 'lucide-react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { NotebookConfig } from '../lib/types.js';
import { type TranslationKey, useTranslation } from '../lib/i18n/index.js';
import { Select } from './Select.js';
import { buildMonthGrid } from '../lib/calendar-grid.js';
import { formatDateYMD, getLocaleWeekStartDay } from '../lib/date-utils.js';
import { stripTaskTokens } from '../lib/task-tokens.js';
import type { TodoTask } from '../lib/todo-list.js';
import { buildDayCounts, notesForDay, notesForMonth, tasksForDay, tasksForMonth } from '../lib/note-day-index.js';
import { filterNotesByFolder, filterTasksByFolder } from '../lib/folder-filter.js';
import { effectivePanelScope, getSavedPanelScope, type PanelScope, savePanelScope } from '../lib/panel-scope.js';
import { useNoteAgenda } from '../lib/use-note-queries.js';
import { LoadingStatus } from './LoadingStatus.js';

const CALENDAR_SCOPE_STORAGE_KEY = 'github-notes:calendar-scope';

interface CalendarToolProps {
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  /** The folder currently browsed (repo-root-relative), or undefined at the notebook root. */
  currentFolder?: string;
  onOpenNote: (note: NoteListItem) => void;
}

/** A todo row identifies its note; opening it needs no more than that. */
const taskNote = (task: TodoTask): NoteListItem => ({ id: task.notePath, path: task.notePath, notebookId: task.notebookId, title: task.noteTitle, tags: [], metadata: {} });

const MONTH_LABEL_KEYS: TranslationKey[] = ['panel.monthJanuary', 'panel.monthFebruary', 'panel.monthMarch', 'panel.monthApril', 'panel.monthMay', 'panel.monthJune', 'panel.monthJuly', 'panel.monthAugust', 'panel.monthSeptember', 'panel.monthOctober', 'panel.monthNovember', 'panel.monthDecember'];
const YEAR_RANGE = 6;

export function CalendarTool({ notebooks, selectedNotebookId, currentFolder, onOpenNote }: CalendarToolProps) {
  const { t, language } = useTranslation();
  const locale = language === 'zh-TW' ? 'zh-TW' : 'en-US';
  const [scope, setScope] = useState<PanelScope>(() => getSavedPanelScope(CALENDAR_SCOPE_STORAGE_KEY));
  const changeScope = (next: PanelScope) => {
    setScope(next);
    savePanelScope(CALENDAR_SCOPE_STORAGE_KEY, next);
  };
  const effectiveScope = effectivePanelScope(scope, currentFolder);
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayField, setDayField] = useState<'created' | 'updated'>('created');

  const agenda = useNoteAgenda(effectiveScope === 'all' || notebooks.length <= 1 ? 'all' : selectedNotebookId);
  const folderScoped = effectiveScope === 'folder' && !!currentFolder;
  const scopedNotes = useMemo(() => {
    const raw = agenda.agenda?.dated ?? [];
    return folderScoped && currentFolder ? filterNotesByFolder(raw, currentFolder) : raw;
  }, [agenda.agenda, folderScoped, currentFolder]);
  const tasks = useMemo(() => {
    const raw = agenda.agenda?.tasks ?? [];
    return folderScoped && currentFolder ? filterTasksByFolder(raw, currentFolder) : raw;
  }, [agenda.agenda, folderScoped, currentFolder]);
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

  const day = selectedDay ? { notes: notesForDay(scopedNotes, selectedDay, dayField), tasks: tasksForDay(tasks, selectedDay) } : { notes: notesForMonth(scopedNotes, cursor.getFullYear(), cursor.getMonth(), dayField), tasks: tasksForMonth(tasks, cursor.getFullYear(), cursor.getMonth()) };
  const monthNoteCount = notesForMonth(scopedNotes, cursor.getFullYear(), cursor.getMonth(), dayField).length;
  const dayIsEmpty = day.notes.length === 0 && day.tasks.length === 0;

  return (
    <div className='panel-tool calendar-tool'>
      {(notebooks.length > 1 || currentFolder) && (
        <div className='panel-tool-header'>
          <Select aria-label={t('filters.notebook')} value={effectiveScope} onValueChange={value => changeScope(value as PanelScope)} options={[{ value: 'folder', label: t('panel.scopeCurrentFolder'), disabled: !currentFolder }, { value: 'current', label: t('panel.scopeCurrentNotebook') }, ...(notebooks.length > 1 ? [{ value: 'all', label: t('panel.scopeAllNotebooks') }] : [])]} />
        </div>
      )}
      {agenda.error && <p role='alert' className='calendar-day-empty'>{agenda.error}</p>}
      {agenda.loading && <LoadingStatus className='calendar-day-empty'>{t('notes.loading')}</LoadingStatus>}
      <div className='calendar-month-nav'>
        <Button
          type='button'
          size='icon'
          aria-label={t('panel.previousMonth')}
          onClick={() => {
            setCursor(value => new Date(value.getFullYear(), value.getMonth() - 1, 1));
            setSelectedDay(null);
          }}
        >
          <ChevronLeft aria-hidden='true' />
        </Button>
        <Select
          aria-label={t('panel.selectMonth')}
          className='calendar-month-select'
          value={String(cursor.getMonth())}
          onValueChange={value => {
            setCursor(current => new Date(current.getFullYear(), Number(value), 1));
            setSelectedDay(null);
          }}
          options={monthOptions}
        />
        <Select
          aria-label={t('panel.selectYear')}
          className='calendar-year-select'
          value={String(cursor.getFullYear())}
          onValueChange={value => {
            setCursor(current => new Date(Number(value), current.getMonth(), 1));
            setSelectedDay(null);
          }}
          options={yearOptions}
        />
        <Button
          type='button'
          size='icon'
          aria-label={t('panel.nextMonth')}
          onClick={() => {
            setCursor(value => new Date(value.getFullYear(), value.getMonth() + 1, 1));
            setSelectedDay(null);
          }}
        >
          <ChevronRight aria-hidden='true' />
        </Button>
        <span className='calendar-month-count' title={t('panel.calendarNotes')} aria-label={`${t('panel.calendarNotes')}: ${monthNoteCount}`}>
          <FileText aria-hidden='true' />
          {monthNoteCount}
        </span>
      </div>
      <div className='calendar-grid'>
        {weekdayLabels.map(label => <div key={label} className='calendar-weekday'>{label}</div>)}
        {grid.map(gridDay => {
          const key = formatDateYMD(gridDay);
          const counts = dayCounts.get(key);
          const inMonth = gridDay.getMonth() === cursor.getMonth();
          return (
            <Button
              type='button'
              key={key}
              aria-label={key}
              aria-pressed={key === selectedDay}
              className='calendar-day'
              data-in-month={inMonth}
              data-today={key === todayYMD}
              data-selected={key === selectedDay}
              onClick={() => setSelectedDay(current => (current === key ? null : key))}
            >
              <span className='calendar-day-number'>{gridDay.getDate()}</span>
              {counts && (counts.created + counts.updated > 0 || counts.due > 0) && <span className='calendar-day-counts'>{counts.created + counts.updated > 0 && <span className='calendar-dot calendar-dot-notes' aria-hidden='true' />}{counts.due > 0 && <span className='calendar-dot calendar-dot-due' aria-hidden='true' />}</span>}
            </Button>
          );
        })}
      </div>
      <div className='calendar-day-detail'>
        <div className='calendar-day-detail-header'>
          <strong>{selectedDay ? (selectedDay === todayYMD ? t('panel.calendarToday') : selectedDay) : t('panel.calendarThisMonth')}</strong>
          <div className='calendar-day-toggle' role='group'>
            <Button type='button' aria-pressed={dayField === 'created'} onClick={() => setDayField('created')}>{t('panel.calendarCreated')}</Button>
            <Button type='button' aria-pressed={dayField === 'updated'} onClick={() => setDayField('updated')}>{t('panel.calendarUpdated')}</Button>
          </div>
        </div>
        {dayIsEmpty ? <p className='calendar-day-empty'>{t('panel.calendarNoItems')}</p> : (
          <>
            {day.notes.length > 0 && <h4>{t('panel.calendarNotes')}</h4>}
            {day.notes.length > 0 && (
              <ul className='calendar-day-notes'>
                {day.notes.map(note => (
                  <li key={note.path}>
                    <Button
                      type='button'
                      className='panel-note-row'
                      onClick={() => onOpenNote(note)}
                    >
                      <FileText aria-hidden='true' />
                      <span>
                        {note.title}
                        <small>{note.path}</small>
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {day.tasks.length > 0 && <h4>{t('panel.calendarTasks')}</h4>}
            {day.tasks.length > 0 && (
              <ul className='calendar-day-tasks'>
                {day.tasks.map(task => (
                  <li key={task.id} data-checked={task.checked}>
                    <Button
                      className='panel-note-row'
                      onClick={() =>
                        onOpenNote(scopedNotes.find(note => note.path === task.notePath) || taskNote(task))}
                    >
                      <ListTodo aria-hidden='true' />
                      <span>
                        {stripTaskTokens(task.lineText)}
                        <small>{task.noteTitle}{' · '}{task.due}</small>
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
