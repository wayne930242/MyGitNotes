import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { NoteItem, NotebookConfig } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
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
  const [showCompleted, setShowCompleted] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [staleIds, setStaleIds] = useState<Set<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());

  const scopedNotes = useMemo(
    () => (scope === 'all' || notebooks.length <= 1 ? notes : notes.filter(note => note.notebookId === selectedNotebookId)),
    [notes, notebooks.length, scope, selectedNotebookId]
  );
  const groups = useMemo(() => groupTodoTasks(extractTodoTasks(scopedNotes), formatDateYMD(new Date())), [scopedNotes]);
  const totalOpen = groups.overdue.length + groups.today.length + groups.upcoming.length + groups.noDate.length;

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
    <li key={task.id} className="todo-task">
      <label>
        <input type="checkbox" checked={task.checked} disabled={pendingIds.has(task.id)} onChange={() => void toggleTask(task)} />
        <button type="button" className="todo-task-text" onClick={() => onOpenNote(notes.find(n => n.path === task.notePath)!)}>
          {task.lineText.replace(/^\s*[-*+]\s\[[ xX]\]\s?/, '')}
        </button>
      </label>
      <span className="todo-task-note">{task.noteTitle}</span>
      {staleIds.has(task.id) && <p className="todo-task-stale" role="alert">{t('panel.todoStale')}</p>}
      {saveErrors.has(task.id) && <p className="todo-task-stale" role="alert">{saveErrors.get(task.id)}</p>}
    </li>
  );

  return (
    <div className="panel-tool todo-tool">
      <div className="panel-tool-header">
        {notebooks.length > 1 && (
          <select className="ui-control" aria-label={t('filters.notebook')} value={scope} onChange={event => setScope(event.target.value as 'current' | 'all')}>
            <option value="current">{t('panel.scopeCurrentNotebook')}</option>
            <option value="all">{t('panel.scopeAllNotebooks')}</option>
          </select>
        )}
      </div>

      {totalOpen === 0 && groups.completed.length === 0 && <p className="todo-empty">{t('panel.todoEmpty')}</p>}

      {GROUP_ORDER.map(({ key, labelKey }) => groups[key].length > 0 && (
        <section key={key} className="todo-group">
          <h4>{t(labelKey)} <span className="todo-group-count">{groups[key].length}</span></h4>
          <ul>{groups[key].map(renderTask)}</ul>
        </section>
      ))}

      {groups.completed.length > 0 && (
        <section className="todo-group todo-group-completed">
          <button type="button" className="todo-completed-toggle" aria-expanded={showCompleted} onClick={() => setShowCompleted(value => !value)}>
            {showCompleted ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            <h4>{t('panel.todoCompleted')} <span className="todo-group-count">{groups.completed.length}</span></h4>
          </button>
          {showCompleted && <ul>{groups.completed.map(renderTask)}</ul>}
        </section>
      )}
    </div>
  );
}
