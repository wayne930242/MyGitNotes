import { FolderTree } from './FolderTree.js';
import React from 'react';
import { GitBranch, CheckCircle2 } from 'lucide-react';
import { GitStatus, FolderItem } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { WorkspaceSidebar } from './WorkspaceChrome.js';

interface SidebarProps {
  folders?: FolderItem[];
  foldersWritable?: boolean;
  reorder?: boolean;
  indexFolders: string[];
  onOpenFolderIndex: (folder: string, revision?: string) => Promise<void>;
  beforeFolderChange?: () => void;
  onFoldersChanged?: () => Promise<void>;
  selectedFolder?: string | null;
  onSelectFolder?: (folder: string | null) => void;
  selectedNotebookId: string;
  gitStatus: GitStatus | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  folders = [], indexFolders, onOpenFolderIndex,
  reorder = false, foldersWritable = false, beforeFolderChange, onFoldersChanged,
  selectedFolder = null, onSelectFolder, selectedNotebookId, gitStatus,
}) => {
  const { t } = useTranslation();
  const modifiedCount = gitStatus?.modified.length || 0;
  const untrackedCount = gitStatus?.untracked.length || 0;
  const stagedCount = gitStatus?.staged.length || 0;
  const dirtyCount = modifiedCount + untrackedCount + stagedCount;

  return (
    <WorkspaceSidebar label={t('folder.folders')} className="notes-sidebar" footer={
      <div
        className="pt-3 mt-3 border-t shrink-0 flex flex-col gap-2.5"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div
          className="flex items-center justify-between px-3 py-2 rounded-xl border shadow-xs transition-colors"
          style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-black/5 dark:bg-white/5"
              style={{ color: 'var(--color-muted)' }}
            >
              <GitBranch className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight">
                {gitStatus?.branch || 'main'}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight">
                {gitStatus?.branch === 'core'
                  ? t('sidebar.productCore')
                  : t('sidebar.userWorkspace')}
              </span>
            </div>
          </div>

          <div>
            {dirtyCount > 0 ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                {t('sidebar.dirty', { count: dirtyCount })}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t('sidebar.clean')}
              </span>
            )}
          </div>
        </div>

        <a className="sidebar-credit" href="https://github.com/wayne930242/MyGitNotes"
          target="_blank" rel="noopener noreferrer" title="MyGitNotes by wayne930242">
          powered by <span>MyGitNotes</span>
        </a>
      </div>
    }>
        {onSelectFolder && <FolderTree reorder={reorder} folders={folders} notebookId={selectedNotebookId} selected={selectedFolder} onSelect={onSelectFolder}
          indexFolders={indexFolders} onOpenIndex={onOpenFolderIndex} writable={foldersWritable} beforeChange={beforeFolderChange} onChanged={onFoldersChanged} />}

    </WorkspaceSidebar>
  );
};
