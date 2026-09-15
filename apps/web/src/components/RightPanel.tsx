import { useEffect } from 'react';
import { CalendarDays, ListTodo, GitBranch } from 'lucide-react';
import type { GitStatus, NoteItem, NotebookConfig } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { usePanelContext, WORKSPACE_TOOL_IDS, type WorkspaceToolId } from '../lib/panel-context.js';
import { CalendarTool } from './CalendarTool.js';
import { TodoTool } from './TodoTool.js';
import { ChangesTool } from './ChangesTool.js';

interface RightPanelProps {
  notes: NoteItem[];
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  onOpenNote: (note: NoteItem) => void;
  onSaveNote: (params: { path: string; content: string; metadata?: Record<string, unknown>; notebookId?: string }) => Promise<NoteItem>;
  gitStatus: GitStatus | null;
  deletedNotes: NoteItem[];
  onRestoreNote: (note: NoteItem) => void;
  onOpenCommitModal: () => void;
}

const WORKSPACE_TOOL_ICONS: Record<WorkspaceToolId, typeof CalendarDays> = {
  calendar: CalendarDays,
  todo: ListTodo,
  changes: GitBranch,
};
const WORKSPACE_TOOL_LABELS: Record<WorkspaceToolId, 'panel.calendar' | 'panel.todo' | 'panel.changes'> = {
  calendar: 'panel.calendar',
  todo: 'panel.todo',
  changes: 'panel.changes',
};

/** The workspace-level Calendar/Todo/Changes panel. Hidden while a note is open — the editor has its own document panel. */
export function RightPanel({ notes, notebooks, selectedNotebookId, onOpenNote, onSaveNote, gitStatus, deletedNotes, onRestoreNote, onOpenCommitModal }: RightPanelProps) {
  const { t } = useTranslation();
  const panel = usePanelContext();
  const visible = !panel.hasOpenNote;

  useEffect(() => {
    if (!visible) {
      document.documentElement.style.setProperty('--right-panel-width', '0px');
      return;
    }
    document.documentElement.style.setProperty('--right-panel-width', panel.isOpen ? '364px' : '44px');
    return () => document.documentElement.style.setProperty('--right-panel-width', '0px');
  }, [panel.isOpen, visible]);

  if (!visible) return null;

  const changesCount = new Set([...(gitStatus?.staged || []), ...(gitStatus?.modified || []), ...(gitStatus?.untracked || [])]).size + deletedNotes.length;

  return (
    <aside className="right-panel" data-open={panel.isOpen}>
      {panel.isOpen && (
        <div className="right-panel-content">
          {panel.activeTool === 'calendar' && <CalendarTool notes={notes} notebooks={notebooks} selectedNotebookId={selectedNotebookId} onOpenNote={onOpenNote} />}
          {panel.activeTool === 'todo' && <TodoTool notes={notes} notebooks={notebooks} selectedNotebookId={selectedNotebookId} onOpenNote={onOpenNote} onSaveNote={onSaveNote} />}
          {panel.activeTool === 'changes' && <ChangesTool gitStatus={gitStatus} deletedNotes={deletedNotes} onRestoreNote={onRestoreNote} onOpenCommitModal={onOpenCommitModal} />}
        </div>
      )}
      <div className="right-panel-rail" role="tablist" aria-label={t('panel.title')}>
        {WORKSPACE_TOOL_IDS.map(id => {
          const Icon = WORKSPACE_TOOL_ICONS[id];
          const label = t(WORKSPACE_TOOL_LABELS[id]);
          return (
            <button key={id} type="button" role="tab" aria-selected={panel.isOpen && panel.activeTool === id} title={label} aria-label={label}
              onClick={() => panel.openTool(id)}>
              <Icon aria-hidden="true" />
              {id === 'changes' && changesCount > 0 && <span className="right-panel-badge" aria-hidden="true">{changesCount > 99 ? '99+' : changesCount}</span>}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
