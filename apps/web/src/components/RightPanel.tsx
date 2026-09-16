import { Button } from './Button.js';
import { useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, ListTodo, GitBranch, Info } from 'lucide-react';
import type { ChangeRequest, FileChange, GitStatus, NoteItem, NotebookConfig } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { usePanelContext, WORKSPACE_TOOL_IDS, type WorkspaceToolId } from '../lib/panel-context.js';
import { CalendarTool } from './CalendarTool.js';
import { TodoTool } from './TodoTool.js';
import { ChangesTool } from './ChangesTool.js';

interface RightPanelProps {
  onFileMetadataContainer?: (element: HTMLDivElement | null) => void;
  fileMode?: boolean;
  fileMetadata?: ReactNode;
  notes: NoteItem[];
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  onOpenNote: (note: NoteItem) => void;
  onSaveNote: (params: { path: string; content: string; metadata?: Record<string, unknown>; notebookId?: string }) => Promise<NoteItem>;
  gitStatus: GitStatus | null;
  deletedNotes: NoteItem[];
  onRestoreNote: (note: NoteItem) => void;
  onOpenCommitModal: (request?: ChangeRequest) => void;
  remoteChanges?: FileChange[];
  getPreview?: (file: string) => string;
  writable: boolean;
  /** Present only for a local workspace, which syncs with its Git upstream. */
  onSynced?: () => void;
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
export function RightPanel({ notes, notebooks, selectedNotebookId, onOpenNote, onSaveNote, gitStatus, deletedNotes, onRestoreNote, onOpenCommitModal, remoteChanges, getPreview, writable, onSynced, fileMode = false, fileMetadata, onFileMetadataContainer }: RightPanelProps) {
  const { t } = useTranslation();
  const panel = usePanelContext();
  const visible = !panel.hasOpenNote;
  const [metadataOpen, setMetadataOpen] = useState(false);
  useEffect(() => { setMetadataOpen(false); }, [fileMode]);
  const showingMetadata = fileMode && metadataOpen && !!fileMetadata;
  const showingWorkspaceTool = !showingMetadata && panel.isOpen && (!fileMode || panel.activeTool === 'changes');
  const isOpen = showingMetadata || showingWorkspaceTool;

  useEffect(() => {
    if (!visible) {
      document.documentElement.style.setProperty('--right-panel-width', '0px');
      return;
    }
    document.documentElement.style.setProperty('--right-panel-width', isOpen ? 'calc(320px + var(--right-panel-rail-width))' : 'var(--right-panel-rail-width)');
    return () => document.documentElement.style.setProperty('--right-panel-width', '0px');
  }, [isOpen, visible]);

  if (!visible) return null;

  const changesCount = new Set([...(gitStatus?.staged || []), ...(gitStatus?.modified || []), ...(gitStatus?.untracked || [])]).size + deletedNotes.length;

  return (
    <aside className="right-panel" data-open={isOpen}>
      {isOpen && (
        <div className="right-panel-content">
          {showingMetadata && <section className="file-metadata-panel"><h2>{t('files.metadataLabel')}</h2>{fileMetadata}<div ref={onFileMetadataContainer} /></section>}
          {showingWorkspaceTool && panel.activeTool === 'calendar' && <CalendarTool notes={notes} notebooks={notebooks} selectedNotebookId={selectedNotebookId} onOpenNote={onOpenNote} />}
          {showingWorkspaceTool && panel.activeTool === 'todo' && <TodoTool notes={notes} notebooks={notebooks} selectedNotebookId={selectedNotebookId} onOpenNote={onOpenNote} onSaveNote={onSaveNote} />}
          {showingWorkspaceTool && panel.activeTool === 'changes' && <ChangesTool writable={writable} remoteChanges={remoteChanges} getPreview={getPreview} gitStatus={gitStatus} deletedNotes={deletedNotes} onRestoreNote={onRestoreNote} onOpenCommitModal={onOpenCommitModal} onSynced={onSynced} />}
        </div>
      )}
      <div className="right-panel-rail" role="tablist" aria-label={t('panel.title')}>
        {fileMode && <Button type="button" role="tab" aria-selected={showingMetadata} aria-label={t('files.metadataLabel')} title={t('files.metadataLabel')} disabled={!fileMetadata} onClick={() => { panel.close(); setMetadataOpen(!showingMetadata); }}><Info aria-hidden="true" /></Button>}
        {WORKSPACE_TOOL_IDS.filter(id => !fileMode || id === 'changes').map(id => {
          const Icon = WORKSPACE_TOOL_ICONS[id];
          const label = t(WORKSPACE_TOOL_LABELS[id]);
          return (
            <Button key={id} type="button" role="tab" aria-selected={showingWorkspaceTool && panel.activeTool === id} title={label} aria-label={label}
              onClick={() => { setMetadataOpen(false); panel.openTool(id); }}>
              <Icon aria-hidden="true" />
              {id === 'changes' && changesCount > 0 && <span className="right-panel-badge" aria-hidden="true">{changesCount > 99 ? '99+' : changesCount}</span>}
            </Button>
          );
        })}
      </div>
    </aside>
  );
}
