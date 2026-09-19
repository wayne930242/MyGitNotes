import { Button } from './Button.js';
import { TodoGanttChart } from './TodoGanttChart.js';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { NotebookConfig, NoteItem } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Select } from './Select.js';
import { formatDateYMD } from '../lib/date-utils.js';
import { DONE_EMOJI, DUE_EMOJI, getTokenValue, setTaskChecked, START_EMOJI, stripTaskTokens, TIMESTAMP_EMOJI } from '../lib/task-tokens.js';
import { TASK_TOKEN_ICON } from '../lib/task-icons.js';
import { filterTasksByFolder } from '../lib/folder-filter.js';
import { groupTodoTasks, type TodoTask } from '../lib/todo-list.js';
import { effectivePanelScope, getSavedPanelScope, type PanelScope, savePanelScope } from '../lib/panel-scope.js';
import { useNoteAgenda } from '../lib/use-note-queries.js';

const TODO_SCOPE_STORAGE_KEY = 'github-notes:todo-scope';

/** The date/time tokens present on a task line, for icon-chip display. */
function taskDateChips(task: TodoTask): { emoji: string; value: string; }[] {
  const chips: { emoji: string; value: string; }[] = [];
  if (task.start) chips.push({ emoji: START_EMOJI, value: task.start });
  if (task.due) chips.push({ emoji: DUE_EMOJI, value: task.due });
  const done = getTokenValue(task.lineText, DONE_EMOJI);
  if (done) chips.push({ emoji: DONE_EMOJI, value: done });
  const timestamp = getTokenValue(task.lineText, TIMESTAMP_EMOJI, true);
  if (timestamp) chips.push({ emoji: TIMESTAMP_EMOJI, value: timestamp });
  return chips;
}

interface TodoToolProps {
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  /** The folder currently browsed (repo-root-relative), or undefined at the notebook root. */
  currentFolder?: string;
  onOpenNote: (note: NoteListItem) => void;
  onSaveNote: (params: { path: string; content: string; metadata?: Record<string, unknown>; notebookId?: string; }) => Promise<NoteItem>;
  onReadNote: (path: string) => Promise<NoteItem>;
}

/** A todo row identifies its note; opening it needs no more than that. */
const taskNote = (task: TodoTask): NoteListItem => ({ id: task.notePath, path: task.notePath, notebookId: task.notebookId, title: task.noteTitle, tags: [], metadata: {} });

const GROUP_ORDER: { key: 'overdue' | 'today' | 'upcoming' | 'noDate'; labelKey: 'panel.todoOverdue' | 'panel.todoToday' | 'panel.todoUpcoming' | 'panel.todoNoDate'; }[] = [{ key: 'overdue', labelKey: 'panel.todoOverdue' }, { key: 'today', labelKey: 'panel.todoToday' }, { key: 'upcoming', labelKey: 'panel.todoUpcoming' }, { key: 'noDate', labelKey: 'panel.todoNoDate' }];

export function TodoTool({ notebooks, selectedNotebookId, currentFolder, onOpenNote, onSaveNote, onReadNote }: TodoToolProps) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<PanelScope>(() => getSavedPanelScope(TODO_SCOPE_STORAGE_KEY));
  const changeScope = (next: PanelScope) => {
    setScope(next);
    savePanelScope(TODO_SCOPE_STORAGE_KEY, next);
  };
  const effectiveScope = effectivePanelScope(scope, currentFolder);
  const [groupMode, setGroupMode] = useState<'date' | 'note' | 'gantt'>('date');
  const [showCompleted, setShowCompleted] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [staleIds, setStaleIds] = useState<Set<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());

  const agenda = useNoteAgenda(effectiveScope === 'all' || notebooks.length <= 1 ? 'all' : selectedNotebookId);
  const tasks = useMemo(() => {
    const raw = agenda.agenda?.tasks ?? [];
    return effectiveScope === 'folder' && currentFolder ? filterTasksByFolder(raw, currentFolder) : raw;
  }, [agenda.agenda, effectiveScope, currentFolder]);
  const groups = useMemo(() => groupTodoTasks(tasks, formatDateYMD(new Date())), [tasks]);
  const totalOpen = groups.overdue.length + groups.today.length + groups.upcoming.length + groups.noDate.length;
  const noteGroups = useMemo(() => {
    const byPath = new Map<string, { title: string; tasks: TodoTask[]; }>();
    for (const task of tasks) {
      const entry = byPath.get(task.notePath) || { title: task.noteTitle, tasks: [] };
      entry.tasks.push(task);
      byPath.set(task.notePath, entry);
    }
    return [...byPath.entries()].sort((a, b) => a[1].title.localeCompare(b[1].title));
  }, [tasks]);
  const undatedOpenTasks = useMemo(() => tasks.filter(task => !task.checked && !task.start && !task.due), [tasks]);

  const toggleTask = async (task: TodoTask) => {
    setPendingIds(prev => new Set(prev).add(task.id));
    try {
      // The agenda carries todo lines, not bodies: read the note before rewriting its line.
      const note = await onReadNote(task.notePath);
      const lines = note.content.split('\n');
      if (lines[task.lineIndex] !== task.lineText) {
        setStaleIds(prev => new Set(prev).add(task.id));
        return;
      }
      setStaleIds(prev => {
        if (!prev.has(task.id)) return prev;
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      setSaveErrors(prev => {
        if (!prev.has(task.id)) return prev;
        const next = new Map(prev);
        next.delete(task.id);
        return next;
      });
      lines[task.lineIndex] = setTaskChecked(task.lineText, !task.checked, formatDateYMD(new Date()));
      await onSaveNote({ path: note.path, content: lines.join('\n'), metadata: note.metadata, notebookId: note.notebookId });
    } catch (error) {
      setSaveErrors(prev => new Map(prev).set(task.id, (error as Error).message));
    } finally {
      setPendingIds(prev => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  };

  const renderTask = (task: TodoTask) => {
    const chips = taskDateChips(task);
    return (
      <li key={task.id} className='todo-task' data-checked={task.checked}>
        <label>
          <input type='checkbox' checked={task.checked} disabled={pendingIds.has(task.id)} onChange={() => void toggleTask(task)} />
          <span className='todo-task-text'>{stripTaskTokens(task.lineText)}</span>
        </label>
        {chips.length > 0 && (
          <ul className='todo-task-dates'>
            {chips.map(chip => {
              const Icon = TASK_TOKEN_ICON[chip.emoji];
              return (
                <li key={chip.emoji} className='todo-task-date-chip'>
                  <Icon aria-hidden='true' />
                  {chip.value}
                </li>
              );
            })}
          </ul>
        )}
        {staleIds.has(task.id) && <p className='todo-task-stale' role='alert'>{t('panel.todoStale')}</p>}
        {saveErrors.has(task.id) && <p className='todo-task-stale' role='alert'>{saveErrors.get(task.id)}</p>}
      </li>
    );
  };

  const completedSection = groups.completed.length > 0 && (
    <section className='todo-group todo-group-completed'>
      <Button type='button' className='todo-completed-toggle' aria-expanded={showCompleted} onClick={() => setShowCompleted(value => !value)}>
        {showCompleted ? <ChevronDown aria-hidden='true' /> : <ChevronRight aria-hidden='true' />}
        <h4>
          {t('panel.todoCompleted')} <span className='todo-group-count'>{groups.completed.length}</span>
        </h4>
      </Button>
      {showCompleted && <ul>{groups.completed.map(task => renderTask(task))}</ul>}
    </section>
  );

  return (
    <div className='panel-tool todo-tool'>
      {(notebooks.length > 1 || currentFolder) && (
        <div className='panel-tool-header'>
          <Select
            aria-label={t('filters.notebook')}
            value={effectiveScope}
            onValueChange={value => changeScope(value as PanelScope)}
            options={[{ value: 'folder', label: t('panel.scopeCurrentFolder'), disabled: !currentFolder }, { value: 'current', label: t('panel.scopeCurrentNotebook') }, ...(notebooks.length > 1 ? [{ value: 'all', label: t('panel.scopeAllNotebooks') }] : [])]}
          />
        </div>
      )}
      {agenda.error && <p role='alert' className='todo-task-stale'>{agenda.error}</p>}
      {agenda.loading && <p role='status' className='todo-empty'>{t('notes.loading')}</p>}
      {!agenda.loading && totalOpen === 0 && groups.completed.length === 0 && <p className='todo-empty'>{t('panel.todoEmpty')}</p>}
      {(totalOpen > 0 || groups.completed.length > 0) && (
        <div className='todo-group-mode-toggle' role='group'>
          <Button type='button' aria-pressed={groupMode === 'date'} onClick={() => setGroupMode('date')}>{t('panel.todoGroupByDate')}</Button>
          <Button type='button' aria-pressed={groupMode === 'note'} onClick={() => setGroupMode('note')}>{t('panel.todoGroupByNote')}</Button>
          <Button type='button' aria-pressed={groupMode === 'gantt'} onClick={() => setGroupMode('gantt')}>{t('panel.todoGroupByGantt')}</Button>
        </div>
      )}
      {groupMode === 'date' && (
        <>
          {GROUP_ORDER.map(({ key, labelKey }) =>
            groups[key].length > 0 && (
              <section key={key} className='todo-group'>
                <h4>
                  {t(labelKey)} <span className='todo-group-count'>{groups[key].length}</span>
                </h4>
                <ul>{groups[key].map(task => renderTask(task))}</ul>
              </section>
            )
          )}
          {completedSection}
        </>
      )}
      {groupMode === 'note' && noteGroups.map(([path, { title, tasks: noteTasks }]) => (
        <section key={path} className='todo-group'>
          <h4>
            <Button type='button' className='todo-group-note-link' title={t('panel.todoOpenNote')} onClick={() => onOpenNote(taskNote(noteTasks[0]))}>{title}</Button>
            <span className='todo-group-count'>{noteTasks.length}</span>
          </h4>
          <ul>{noteTasks.map(task => renderTask(task))}</ul>
        </section>
      ))}
      {groupMode === 'gantt' && (
        <>
          <TodoGanttChart tasks={tasks} today={formatDateYMD(new Date())} onOpenTask={task => onOpenNote(taskNote(task))} />
          {undatedOpenTasks.length > 0 && (
            <section className='todo-group'>
              <h4>
                {t('panel.todoNoDate')} <span className='todo-group-count'>{undatedOpenTasks.length}</span>
              </h4>
              <ul>{undatedOpenTasks.map(task => renderTask(task))}</ul>
            </section>
          )}
          {completedSection}
        </>
      )}
    </div>
  );
}
