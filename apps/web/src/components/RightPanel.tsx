import { Button } from './Button.js';
import { type ReactNode, useLayoutEffect } from 'react';
import { Braces, CalendarDays, GitBranch, History, ImageIcon, Info, ListTodo, ListTree, Search } from 'lucide-react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { ChangeRequest, FileChange, GitStatus, NotebookConfig, NoteItem } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { DOCUMENT_TOOL_IDS, type DocumentToolId, isDocumentTool, usePanelContext, WORKSPACE_TOOL_IDS, type WorkspaceToolId } from '../lib/panel-context.js';
import { getSavedRightPanelWidth, RIGHT_PANEL_RAIL_WIDTH } from './WorkspaceChrome.js';
import { CalendarTool } from './CalendarTool.js';
import { TodoTool } from './TodoTool.js';
import { ChangesTool } from './ChangesTool.js';

interface RightPanelProps {
  onFileMetadataContainer?: (element: HTMLDivElement | null) => void;
  fileMode?: boolean;
  fileMetadata?: ReactNode;
  /** Whether the Files page shows its metadata tab; App owns it so the file toolbar can open it. */
  metadataOpen?: boolean;
  onMetadataOpenChange?: (open: boolean) => void;
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  /** The folder currently browsed (repo-root-relative), or undefined at the notebook root. */
  currentFolder?: string;
  onOpenNote: (note: NoteListItem) => void;
  onSaveNote: (params: { path: string; content: string; metadata?: Record<string, unknown>; notebookId?: string; }) => Promise<NoteItem>;
  /** Reads a note in full before a panel action rewrites it. */
  onReadNote: (path: string) => Promise<NoteItem>;
  gitStatus: GitStatus | null;
  deletedNotes: NoteItem[];
  onRestoreNote: (note: NoteItem) => void;
  onOpenCommitModal: (request?: ChangeRequest) => void;
  remoteChanges?: FileChange[];
  getPreview?: (file: string) => string;
  writable: boolean;
  /** Present only for a local workspace, which syncs with its Git upstream. */
  onSynced?: () => void;
  /** Reports the panel's current desired width in pixels (0 while hidden) so the layout can size its splitter panel. */
  onWidthChange?: (width: number) => void;
  /** While a Focus is displayed: the rail offers the active pane's document panel, which its editor renders into the container. */
  documentPanel?: { enabled: boolean; onContainer: (element: HTMLDivElement | null) => void; };
}

const WORKSPACE_TOOL_ICONS: Record<WorkspaceToolId, typeof CalendarDays> = { calendar: CalendarDays, todo: ListTodo, changes: GitBranch };
const WORKSPACE_TOOL_LABELS: Record<WorkspaceToolId, 'panel.calendar' | 'panel.todo' | 'panel.changes'> = { calendar: 'panel.calendar', todo: 'panel.todo', changes: 'panel.changes' };
const DOCUMENT_TOOL_ICONS: Record<DocumentToolId, typeof CalendarDays> = { outline: ListTree, find: Search, frontmatter: Braces, assets: ImageIcon, git: History };
const DOCUMENT_TOOL_LABELS: Record<DocumentToolId, 'editor.outline' | 'editor.findInNote' | 'editor.frontmatter' | 'editor.notebookAssets' | 'editor.fileGitStatus'> = { outline: 'editor.outline', find: 'editor.findInNote', frontmatter: 'editor.frontmatter', assets: 'editor.notebookAssets', git: 'editor.fileGitStatus' };

/** The workspace-level Calendar/Todo/Changes panel. Hidden while a note is open — the editor has its own document panel. */
export function RightPanel({ notebooks, selectedNotebookId, currentFolder, onOpenNote, onSaveNote, onReadNote, gitStatus, deletedNotes, onRestoreNote, onOpenCommitModal, remoteChanges, getPreview, writable, onSynced, fileMode = false, fileMetadata, onFileMetadataContainer, metadataOpen = false, onMetadataOpenChange, onWidthChange, documentPanel }: RightPanelProps) {
  const { t } = useTranslation();
  const panel = usePanelContext();
  const visible = !panel.hasOpenNote;
  const showingMetadata = fileMode && metadataOpen && !!fileMetadata;
  const showingWorkspaceTool = !showingMetadata && panel.isOpen && !isDocumentTool(panel.activeTool) && (!fileMode || panel.activeTool === 'changes');
  const showingDocument = !showingMetadata && panel.isOpen && isDocumentTool(panel.activeTool) && Boolean(documentPanel?.enabled);
  const isOpen = showingMetadata || showingWorkspaceTool || showingDocument;

  useLayoutEffect(() => {
    if (!visible) {
      document.documentElement.style.setProperty('--right-panel-width', '0px');
      onWidthChange?.(0);
      return;
    }
    const width = isOpen ? RIGHT_PANEL_RAIL_WIDTH + getSavedRightPanelWidth() : RIGHT_PANEL_RAIL_WIDTH;
    document.documentElement.style.setProperty('--right-panel-width', `${width}px`);
    onWidthChange?.(width);
    return () => {
      document.documentElement.style.setProperty('--right-panel-width', '0px');
      onWidthChange?.(0);
    };
  }, [isOpen, visible, onWidthChange]);

  if (!visible) return null;

  const changesCount = new Set([...(gitStatus?.staged || []), ...(gitStatus?.modified || []), ...(gitStatus?.untracked || [])]).size + deletedNotes.length;

  return (
    <aside className='right-panel' data-open={isOpen}>
      {isOpen && (
        <div className='right-panel-content'>
          {showingMetadata && (
            <section className='file-metadata-panel'>
              <h2>{t('files.metadataLabel')}</h2>
              {fileMetadata}
              <div ref={onFileMetadataContainer} />
            </section>
          )}
          {showingWorkspaceTool && panel.activeTool === 'calendar' && <CalendarTool notebooks={notebooks} selectedNotebookId={selectedNotebookId} currentFolder={currentFolder} onOpenNote={onOpenNote} />}
          {showingWorkspaceTool && panel.activeTool === 'todo' && <TodoTool notebooks={notebooks} selectedNotebookId={selectedNotebookId} currentFolder={currentFolder} onOpenNote={onOpenNote} onSaveNote={onSaveNote} onReadNote={onReadNote} />}
          {showingWorkspaceTool && panel.activeTool === 'changes' && <ChangesTool writable={writable} remoteChanges={remoteChanges} getPreview={getPreview} gitStatus={gitStatus} deletedNotes={deletedNotes} onRestoreNote={onRestoreNote} onOpenCommitModal={onOpenCommitModal} onSynced={onSynced} />}
          {showingDocument && <div ref={documentPanel?.onContainer} className='right-panel-document' />}
        </div>
      )}
      <div className='right-panel-rail' role='tablist' aria-label={t('panel.title')}>
        {fileMode && (
          <Button
            type='button'
            role='tab'
            aria-selected={showingMetadata}
            aria-label={t('files.metadataLabel')}
            title={t('files.metadataLabel')}
            disabled={!fileMetadata}
            onClick={() => {
              panel.close();
              onMetadataOpenChange?.(!showingMetadata);
            }}
          >
            <Info aria-hidden='true' />
          </Button>
        )}
        {WORKSPACE_TOOL_IDS.filter(id => !fileMode || id === 'changes').map(id => {
          const Icon = WORKSPACE_TOOL_ICONS[id];
          const label = t(WORKSPACE_TOOL_LABELS[id]);
          return (
            <Button
              key={id}
              type='button'
              role='tab'
              aria-selected={showingWorkspaceTool && panel.activeTool === id}
              title={label}
              aria-label={label}
              onClick={() => {
                onMetadataOpenChange?.(false);
                panel.openTool(id);
              }}
            >
              <Icon aria-hidden='true' />
              {id === 'changes' && changesCount > 0 && <span className='right-panel-badge' aria-hidden='true'>{changesCount > 99 ? '99+' : changesCount}</span>}
            </Button>
          );
        })}
        {documentPanel && (
          <>
            <span className='right-panel-divider' aria-hidden='true' />
            {DOCUMENT_TOOL_IDS.map(id => {
              const Icon = DOCUMENT_TOOL_ICONS[id];
              const label = t(DOCUMENT_TOOL_LABELS[id]);
              return (
                <Button
                  key={id}
                  type='button'
                  role='tab'
                  aria-selected={showingDocument && panel.activeTool === id}
                  title={label}
                  aria-label={label}
                  disabled={!documentPanel.enabled}
                  onClick={() => panel.openTool(id)}
                >
                  <Icon aria-hidden='true' />
                </Button>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}
