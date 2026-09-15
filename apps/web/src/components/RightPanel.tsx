import { useEffect } from 'react';
import { CalendarDays, ListTodo, Search, ListTree, Settings2, Image as ImageIcon, GitBranch, X } from 'lucide-react';
import type { NoteItem, NotebookConfig } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { isNoteToolId, usePanelContext, WORKSPACE_TOOL_IDS, type NoteToolId, type PanelToolId } from '../lib/panel-context.js';
import { CalendarTool } from './CalendarTool.js';
import { TodoTool } from './TodoTool.js';

interface RightPanelProps {
  notes: NoteItem[];
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  onOpenNote: (note: NoteItem) => void;
  onSaveNote: (params: { path: string; content: string; metadata?: Record<string, unknown>; notebookId?: string }) => Promise<NoteItem>;
}

const WORKSPACE_TOOL_ICONS: Record<(typeof WORKSPACE_TOOL_IDS)[number], typeof CalendarDays> = {
  calendar: CalendarDays,
  todo: ListTodo,
};
const WORKSPACE_TOOL_LABELS: Record<(typeof WORKSPACE_TOOL_IDS)[number], 'panel.calendar' | 'panel.todo'> = {
  calendar: 'panel.calendar',
  todo: 'panel.todo',
};
const NOTE_TOOL_ICONS: Record<NoteToolId, typeof Search> = {
  find: Search, outline: ListTree, frontmatter: Settings2, assets: ImageIcon, git: GitBranch,
};

export function RightPanel({ notes, notebooks, selectedNotebookId, onOpenNote, onSaveNote }: RightPanelProps) {
  const { t } = useTranslation();
  const panel = usePanelContext();

  useEffect(() => {
    document.documentElement.style.setProperty('--right-panel-width', panel.isOpen ? '364px' : '44px');
    return () => document.documentElement.style.setProperty('--right-panel-width', '0px');
  }, [panel.isOpen]);

  const tab = (id: PanelToolId, Icon: typeof Search, label: string) => (
    <button key={id} type="button" role="tab" aria-selected={panel.isOpen && panel.activeTool === id} title={label} aria-label={label}
      onClick={() => panel.openTool(id)}>
      <Icon aria-hidden="true" />
    </button>
  );

  return (
    <aside className="right-panel" data-open={panel.isOpen}>
      {panel.isOpen && (
        <div className="right-panel-content">
          <div className="right-panel-content-header">
            <button type="button" className="ui-icon-button" aria-label={t('panel.close')} onClick={panel.close}><X aria-hidden="true" /></button>
          </div>
          {panel.activeTool === 'calendar' && <CalendarTool notes={notes} notebooks={notebooks} selectedNotebookId={selectedNotebookId} onOpenNote={onOpenNote} />}
          {panel.activeTool === 'todo' && <TodoTool notes={notes} notebooks={notebooks} selectedNotebookId={selectedNotebookId} onOpenNote={onOpenNote} onSaveNote={onSaveNote} />}
          <div ref={panel.registerNoteToolPortal} className="right-panel-note-tool-slot" style={{ display: isNoteToolId(panel.activeTool) ? 'contents' : 'none' }} />
        </div>
      )}
      <div className="right-panel-rail" role="tablist" aria-label={t('panel.title')}>
        {WORKSPACE_TOOL_IDS.map(id => tab(id, WORKSPACE_TOOL_ICONS[id], t(WORKSPACE_TOOL_LABELS[id])))}
        {panel.hasOpenNote && <div className="right-panel-divider" role="separator" />}
        {panel.hasOpenNote && tab('find', NOTE_TOOL_ICONS.find, t('editor.find'))}
        {panel.hasOpenNote && panel.isMarkdownNote && tab('outline', NOTE_TOOL_ICONS.outline, t('editor.outline'))}
        {panel.hasOpenNote && tab('frontmatter', NOTE_TOOL_ICONS.frontmatter, t('editor.frontmatter'))}
        {panel.hasOpenNote && tab('assets', NOTE_TOOL_ICONS.assets, t('editor.asset'))}
        {panel.hasOpenNote && tab('git', NOTE_TOOL_ICONS.git, t('editor.git'))}
      </div>
    </aside>
  );
}
