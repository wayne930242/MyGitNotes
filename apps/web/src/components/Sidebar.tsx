import React from 'react';
import { Folder, Tag, Filter, GitBranch, CheckCircle2, Heart } from 'lucide-react';
import { NotebookConfig, NoteItem, GitStatus, FolderItem } from '../lib/types.js';

interface SidebarProps {
  folders?: FolderItem[];
  selectedFolder?: string | null;
  onSelectFolder?: (folder: string | null) => void;
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  onSelectNotebook: (id: string) => void;
  notes: NoteItem[];
  statuses: string[];
  showHidden: boolean;
  hiddenNoteCount: number;
  onShowHiddenChange: (show: boolean) => void;
  selectedStatus: string | null;
  onSelectStatus: (status: string | null) => void;
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
  gitStatus: GitStatus | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  folders = [], selectedFolder = null, onSelectFolder,
  notebooks,
  selectedNotebookId,
  onSelectNotebook,
  notes,
  statuses,
  showHidden,
  hiddenNoteCount,
  onShowHiddenChange,
  selectedStatus,
  onSelectStatus,
  selectedTag,
  onSelectTag,
  gitStatus,
}) => {
  // Aggregate note counts per notebook
  const notebookCounts = notebooks.reduce<Record<string, number>>((acc, nb) => {
    acc[nb.id] = notes.filter((n) => n.notebookId === nb.id).length;
    return acc;
  }, {});

  const notebookNotes = notes.filter(note => note.notebookId === selectedNotebookId);

  // Extract all distinct statuses and their counts
  const statusCounts = notebookNotes.reduce<Record<string, number>>((acc, n) => {
    const s = n.status || '';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, Object.create(null));

  // Extract all distinct tags and their counts
  const tagCounts = notebookNotes.reduce<Record<string, number>>((acc, n) => {
    for (const t of n.tags) {
      acc[t] = (acc[t] || 0) + 1;
    }
    return acc;
  }, {});

  const allTags = Object.keys(tagCounts).sort();

  const modifiedCount = gitStatus?.modified.length || 0;
  const untrackedCount = gitStatus?.untracked.length || 0;
  const stagedCount = gitStatus?.staged.length || 0;
  const dirtyCount = modifiedCount + untrackedCount + stagedCount;

  return (
    <aside
      className="w-64 flex flex-col justify-between shrink-0 h-full p-4 select-none border-r transition-colors"
      style={{ backgroundColor: 'var(--color-sidebar)', borderColor: 'var(--color-border)' }}
    >
      {/* Scrollable Navigation Sections */}
      <div className="flex flex-col gap-6 overflow-y-auto pr-1 flex-1">
        {/* Notebooks Section */}
        <div>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 px-2">
            <span>Notebooks</span>
            <span className="text-slate-400">{notebooks.length}</span>
          </div>
          <div className="space-y-1">
            {notebooks.map((nb) => {
              const isSelected = selectedNotebookId === nb.id;
              const count = notebookCounts[nb.id] || 0;
              return (
                <button
                  key={nb.id}
                  onClick={() => onSelectNotebook(nb.id)}
                  style={
                    isSelected
                      ? {
                          backgroundColor: 'var(--color-primary-light)',
                          color: 'var(--color-primary)',
                        }
                      : undefined
                  }
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm font-medium transition ${
                    isSelected
                      ? 'font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Folder
                      className="w-4 h-4"
                      style={isSelected ? { color: 'var(--color-primary)' } : undefined}
                    />
                    <span className="truncate">{nb.title}</span>
                  </div>
                  <span
                    style={
                      isSelected
                        ? {
                            backgroundColor: 'var(--color-primary-light)',
                            color: 'var(--color-primary)',
                          }
                        : undefined
                    }
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      isSelected
                        ? 'font-semibold'
                        : 'bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {onSelectFolder && <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-2">Folders</div>
          <button className="w-full text-left px-2.5 py-2 text-sm rounded-lg" aria-pressed={selectedFolder === null} onClick={() => onSelectFolder(null)}
            style={selectedFolder === null ? { backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary)' } : undefined}>All folders</button>
          {folders.filter(f => f.notebookId === selectedNotebookId).map(folder => <button key={folder.path} title={folder.description || folder.path}
            aria-pressed={selectedFolder === folder.path} onClick={() => onSelectFolder(folder.path)}
            className="w-full flex items-center gap-2 py-2 pr-2 text-sm rounded-lg text-left"
            style={{ paddingLeft: 10 + (folder.path.split('/').length - 1) * 14,
              ...(selectedFolder === folder.path ? { backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary)' } : {}) }}>
            <Folder className="w-4 h-4 shrink-0"/><span className="truncate">{folder.title}</span>
          </button>)}
        </div>}

        <label className="flex items-center gap-2 px-2 min-h-11 text-sm cursor-pointer">
          <input type="checkbox" checked={showHidden} onChange={event => onShowHiddenChange(event.target.checked)}
            aria-label="Show hidden notes" className="w-4 h-4 shrink-0 accent-indigo-600" />
          <span className="min-w-0">Show hidden notes</span>
          <span className="text-xs text-slate-400 ml-auto">{hiddenNoteCount}</span>
        </label>

        {/* Status Filters */}
        <div>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 px-2">
            <span>Status Filter</span>
            {selectedStatus && (
              <button
                onClick={() => onSelectStatus(null)}
                className="text-xs hover:underline capitalize"
                style={{ color: 'var(--color-primary)' }}
              >
                clear
              </button>
            )}
          </div>
          <div className="space-y-1 text-sm">
            <button
              onClick={() => onSelectStatus(null)}
              style={
                selectedStatus === null
                  ? {
                      backgroundColor: 'var(--color-primary-light)',
                      color: 'var(--color-primary)',
                    }
                  : undefined
              }
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition ${
                selectedStatus === null
                  ? 'font-medium'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <span>All Statuses</span>
              </div>
              <span className="text-xs text-slate-400">{notebookNotes.length}</span>
            </button>

            {statuses.map((status) => {
              const count = statusCounts[status] || 0;
              const isSelected = selectedStatus === status;

              return (
                <button
                  key={status}
                  data-status-filter={status}
                  onClick={() => onSelectStatus(isSelected ? null : status)}
                  style={
                    isSelected
                      ? {
                          backgroundColor: 'var(--color-primary-light)',
                          color: 'var(--color-primary)',
                        }
                      : undefined
                  }
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition ${
                    isSelected
                      ? 'font-medium'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        status === 'done'
                          ? 'bg-emerald-500'
                          : (status === 'working' || status === 'doing')
                          ? 'bg-sky-500'
                          : status === 'todo'
                          ? 'bg-amber-500'
                          : 'bg-slate-400'
                      }`}
                    />
                    <span className="truncate">{status}</span>
                  </div>
                  <span className="text-xs text-slate-400">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tags Cloud */}
        {allTags.length > 0 && (
          <div>
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 px-2">
              <span>Tags</span>
              {selectedTag && (
                <button
                  onClick={() => onSelectTag(null)}
                  className="text-xs hover:underline"
                  style={{ color: 'var(--color-primary)' }}
                >
                  clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 px-1">
              {allTags.map((tag) => {
                const isSelected = selectedTag === tag;
                return (
                  <button
                    key={tag}
                    onClick={() => onSelectTag(isSelected ? null : tag)}
                    style={
                      isSelected
                        ? {
                            backgroundColor: 'var(--color-primary)',
                            color: '#ffffff',
                          }
                        : {
                            backgroundColor: 'var(--color-surface)',
                            borderColor: 'var(--color-border)',
                          }
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition border ${
                      isSelected
                        ? 'font-medium shadow-xs border-transparent'
                        : 'text-slate-600 dark:text-slate-400 hover:border-slate-400'
                    }`}
                  >
                    <Tag className="w-3 h-3" />
                    <span>{tag}</span>
                    <span
                      className={`text-[10px] ml-0.5 ${
                        isSelected ? 'text-white/80' : 'text-slate-400'
                      }`}
                    >
                      {tagCounts[tag]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Sidebar Bottom: Git Branch & Workspace Status + Footer */}
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
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary)' }}
            >
              <GitBranch className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight">
                {gitStatus?.branch || 'main'}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight">
                {gitStatus?.branch === 'core' ? 'Product Core' : 'User Workspace'}
              </span>
            </div>
          </div>

          <div>
            {dirtyCount > 0 ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                {dirtyCount} dirty
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Clean
              </span>
            )}
          </div>
        </div>

        {/* Sidebar Footer (Requirement 5) */}
        <div className="text-center text-[11px] text-slate-400 dark:text-slate-500 leading-tight flex flex-col items-center gap-0.5 pb-0.5">
          <div className="flex items-center gap-1">
            <span>powered by</span>
            <a
              href="https://github.com/wayne930242/github-notes"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium hover:underline transition"
              style={{ color: 'var(--color-primary)' }}
            >
              github-notes
            </a>
          </div>
          <div>
            <a
              href="https://github.com/wayne930242/github-notes"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:underline transition hover:text-slate-600 dark:hover:text-slate-300"
            >
              <span>Made with</span>
              <Heart className="w-3 h-3 fill-red-500 text-red-500" />
              <span>by wayne930242</span>
            </a>
          </div>
        </div>
      </div>
    </aside>
  );
};
