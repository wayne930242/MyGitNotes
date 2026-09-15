import { Button } from './Button.js';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { NoteItem, NotebookConfig } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Select } from './Select.js';
import { formatDateYMD } from '../lib/date-utils.js';
import { setTaskChecked } from '../lib/task-tokens.js';
import { extractTodoTasks, groupTodoTasks, type TodoTask } from '../lib/todo-list.js';

interface TodoToolProps {
  notes: NoteItem[];
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  onOpenNote: (note: NoteItem) => void;
  onSaveNote: (params: { path: string; content: string; metadata?: Record<string, unknown>; notebookId?: string }) => Promise<NoteItem>;
}

const GROUP_ORDER: { key: 'overdue' | 'today' | 'upcoming' | 'noDate'; labelKey: 'panel.todoOverdue' | 'panel.todoToday' | 'panel.todoUpcoming' | 'panel.todoNoDate' }[] = [
  { key: 'overdue', labelKey: 'panel.todoOverdue' },
  { key: 'today', labelKey: 'panel.todoToday' },
  { key: 'upcoming', labelKey: 'panel.todoUpcoming' },
  { key: 'noDate', labelKey: 'panel.todoNoDate' },
];

export function TodoTool({ notes, notebooks, selectedNotebookId, onOpenNote, onSaveNote }: TodoToolProps) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [groupMode, setGroupMode] = useState<'date' | 'note'>('date');
  const [showCompleted, setShowCompleted] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [staleIds, setStaleIds] = useState<Set<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());

  const scopedNotes = useMemo(
    () => (scope === 'all' || notebooks.length <= 1 ? notes : notes.filter(note => note.notebookId === selectedNotebookId)),
    [notes, notebooks.length, scope, selectedNotebookId]
  );
  const tasks = useMemo(() => extractTodoTasks(scopedNotes), [scopedNotes]);
  const groups = useMemo(() => groupTodoTasks(tasks, formatDateYMD(new Date())), [tasks]);
  const totalOpen = groups.overdue.length + groups.today.length + groups.upcoming.length + groups.noDate.length;
  const noteGroups = useMemo(() => {
    const byPath = new Map<string, { title: string; tasks: TodoTask[] }>();
    for (const task of tasks) {
      const entry = byPath.get(task.notePath) || { title: task.noteTitle, tasks: [] };
      entry.tasks.push(task);
      byPath.set(task.notePath, entry);
    }
    return [...byPath.entries()].sort((a, b) => a[1].title.localeCompare(b[1].title));
  }, [tasks]);

  const toggleTask = async (task: TodoTask) => {
    const note = notes.find(n => n.path === task.notePath);
    if (!note) return;
    const lines = note.content.split('\n');
    if (lines[task.lineIndex] !== task.lineText) {
      setStaleIds(prev => new Set(prev).add(task.id));
      return;
    }
    setStaleIds(prev => { if (!prev.has(task.id)) return prev; const next = new Set(prev); next.delete(task.id); return next; });
    setSaveErrors(prev => { if (!prev.has(task.id)) return prev; const next = new Map(prev); next.delete(task.id); return next; });
    setPendingIds(prev => new Set(prev).add(task.id));
    try {
      lines[task.lineIndex] = setTaskChecked(task.lineText, !task.checked, formatDateYMD(new Date()));
      await onSaveNote({ path: note.path, content: lines.join('\n'), metadata: note.metadata, notebookId: note.notebookId });
    } catch (error) {
      setSaveErrors(prev => new Map(prev).set(task.id, (error as Error).message));
    } finally {
      setPendingIds(prev => { const next = new Set(prev); next.delete(task.id); return next; });
    }
  };

  const renderTask = (task: TodoTask) => (
    <li key={task.id} className="todo-task" data-checked={task.checked}>
      <label>
        <input type="checkbox" checked={task.checked} disabled={pendingIds.has(task.id)} onChange={() => void toggleTask(task)} />
        <span className="todo-task-text">{task.lineText.replace(/^\s*[-*+]\s\[[ xX]\]\s?/, '')}</span>
      </label>
      {staleIds.has(task.id) && <p className="todo-task-stale" role="alert">{t('panel.todoStale')}</p>}
      {saveErrors.has(task.id) && <p className="todo-task-stale" role="alert">{saveErrors.get(task.id)}</p>}
    </li>
  );

  return (
    <div className="panel-tool todo-tool">
      {notebooks.length > 1 && <div className="panel-tool-header">
        {notebooks.length > 1 && (
          <Select aria-label={t('filters.notebook')} value={scope} onValueChange={value => setScope(value as 'current' | 'all')}
            options={[{ value: 'current', label: t('panel.scopeCurrentNotebook') }, { value: 'all', label: t('panel.scopeAllNotebooks') }]} />
        )}
      </div>}

      {totalOpen === 0 && groups.completed.length === 0 && <p className="todo-empty">{t('panel.todoEmpty')}</p>}

      {(totalOpen > 0 || groups.completed.length > 0) && (
        <div className="todo-group-mode-toggle" role="group">
          <Button type="button" aria-pressed={groupMode === 'date'} onClick={() => setGroupMode('date')}>{t('panel.todoGroupByDate')}</Button>
          <Button type="button" aria-pressed={groupMode === 'note'} onClick={() => setGroupMode('note')}>{t('panel.todoGroupByNote')}</Button>
        </div>
      )}

      {groupMode === 'date' && <>
        {GROUP_ORDER.map(({ key, labelKey }) => groups[key].length > 0 && (
          <section key={key} className="todo-group">
            <h4>{t(labelKey)} <span className="todo-group-count">{groups[key].length}</span></h4>
            <ul>{groups[key].map(task => renderTask(task))}</ul>
          </section>
        ))}

        {groups.completed.length > 0 && (
          <section className="todo-group todo-group-completed">
            <Button type="button" className="todo-completed-toggle" aria-expanded={showCompleted} onClick={() => setShowCompleted(value => !value)}>
              {showCompleted ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
              <h4>{t('panel.todoCompleted')} <span className="todo-group-count">{groups.completed.length}</span></h4>
            </Button>
            {showCompleted && <ul>{groups.completed.map(task => renderTask(task))}</ul>}
          </section>
        )}
      </>}

      {groupMode === 'note' && noteGroups.map(([path, { title, tasks: noteTasks }]) => (
        <section key={path} className="todo-group">
          <h4>
            <Button type="button" className="todo-group-note-link" title={t('panel.todoOpenNote')} onClick={() => onOpenNote(notes.find(n => n.path === path)!)}>{title}</Button>
            <span className="todo-group-count">{noteTasks.length}</span>
          </h4>
          <ul>{noteTasks.map(task => renderTask(task))}</ul>
        </section>
      ))}
    </div>
  );
}
