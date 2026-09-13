import React, { useEffect, useState } from 'react';
import { Folder, Tag, Filter, GitBranch, CheckCircle2, Eye, EyeOff, Search, X } from 'lucide-react';
import { NoteItem, GitStatus, FolderItem } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { WorkspaceSidebar } from './WorkspaceChrome.js';
import { Select } from './Select.js';
import { filterAndSortTags, getSavedTagSort, saveTagSort, TagSort } from '../lib/tag-list.js';

const selectedItemStyle: React.CSSProperties = {
  backgroundColor: 'color-mix(in srgb, var(--color-text) 8%, transparent)',
  color: 'var(--color-text)',
};

interface SidebarProps {
  folders?: FolderItem[];
  selectedFolder?: string | null;
  onSelectFolder?: (folder: string | null) => void;
  selectedNotebookId: string;
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
  folders = [],
  selectedFolder = null,
  onSelectFolder,
  selectedNotebookId,
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
  const { t, language } = useTranslation();
  const [tagQuery, setTagQuery] = useState('');
  const [tagSort, setTagSort] = useState<TagSort>(getSavedTagSort);
  useEffect(() => { setTagQuery(''); }, [selectedNotebookId]);

  const notebookNotes = notes.filter((note) => note.notebookId === selectedNotebookId);

  // Extract all distinct statuses and their counts
  const statusCounts = notebookNotes.reduce<Record<string, number>>((acc, n) => {
    const s = n.status || '';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, Object.create(null));

  // Extract all distinct tags and their counts
  const tagCounts = notebookNotes.reduce<Record<string, number>>((acc, n) => {
    for (const item of n.tags) {
      acc[item] = (acc[item] || 0) + 1;
    }
    return acc;
  }, Object.create(null));

  const allTags = Object.keys(tagCounts);
  const visibleTags = filterAndSortTags(tagCounts, tagQuery, tagSort, language);

  const modifiedCount = gitStatus?.modified.length || 0;
  const untrackedCount = gitStatus?.untracked.length || 0;
  const stagedCount = gitStatus?.staged.length || 0;
  const dirtyCount = modifiedCount + untrackedCount + stagedCount;

  return (
    <WorkspaceSidebar label={t('sidebar.statusFilter')} className="notes-sidebar" footer={
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

        <a className="sidebar-credit" href="https://github.com/wayne930242/github-notes"
          target="_blank" rel="noopener noreferrer" title="GitHub Notes by wayne930242">
          powered by <span>github-notes</span>
        </a>
      </div>
    }>
        {onSelectFolder && (
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-2">
              {t('folder.folders')}
            </div>
            <button
              type="button"
              className={`w-full text-left px-2.5 py-2 text-sm rounded-lg transition ${
                selectedFolder === null
                  ? 'font-semibold hover:opacity-90'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
              aria-pressed={selectedFolder === null}
              onClick={() => onSelectFolder(null)}
              style={selectedFolder === null ? selectedItemStyle : undefined}
            >
              {t('folder.allFolders')}
            </button>
            {folders
              .filter((f) => f.notebookId === selectedNotebookId)
              .map((folder) => (
                <button
                  type="button"
                  key={folder.path}
                  title={folder.description || folder.path}
                  aria-pressed={selectedFolder === folder.path}
                  onClick={() => onSelectFolder(folder.path)}
                  className={`w-full flex items-center gap-2 py-2 pr-2 text-sm rounded-lg text-left transition ${
                    selectedFolder === folder.path
                      ? 'font-semibold hover:opacity-90'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                  style={{
                    paddingLeft: 10 + (folder.path.split('/').length - 1) * 14,
                    ...(selectedFolder === folder.path ? selectedItemStyle : {}),
                  }}
                >
                  <Folder className="w-4 h-4 shrink-0" />
                  <span className="truncate">{folder.title}</span>
                </button>
              ))}
          </div>
        )}

        {/* Status Filters */}
        <div>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 px-2">
            <span>{t('sidebar.statusFilter')}</span>
            {selectedStatus && (
              <button
                type="button"
                onClick={() => onSelectStatus(null)}
                className="text-xs hover:underline capitalize"
                style={{ color: 'var(--color-muted)' }}
              >
                {t('sidebar.clear')}
              </button>
            )}
          </div>
          <div className="space-y-1 text-sm">
            <button
              type="button"
              onClick={() => onSelectStatus(null)}
              aria-pressed={selectedStatus === null}
              style={selectedStatus === null ? selectedItemStyle : undefined}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition ${
                selectedStatus === null
                  ? 'font-semibold hover:opacity-90'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <span>{t('sidebar.allStatuses')}</span>
              </div>
              <span className="text-xs text-slate-400">{notebookNotes.length}</span>
            </button>

            {statuses.map((status) => {
              const count = statusCounts[status] || 0;
              const isSelected = selectedStatus === status;

              return (
                <button
                  type="button"
                  key={status}
                  data-status-filter={status}
                  onClick={() => onSelectStatus(isSelected ? null : status)}
                  aria-pressed={isSelected}
                  style={isSelected ? selectedItemStyle : undefined}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition ${
                    isSelected
                      ? 'font-semibold hover:opacity-90'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        status === 'done'
                          ? 'bg-emerald-500'
                          : status === 'working' || status === 'doing'
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

          {/* Show Hidden Notes Toggle Switch */}
          <div className="mt-2.5 pt-2 border-t border-slate-200/70 dark:border-slate-800/70 px-1">
            <label className="flex items-center justify-between cursor-pointer group py-1.5 px-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition select-none">
              <div className="flex items-center gap-2 min-w-0">
                {showHidden ? (
                  <Eye className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 transition" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-500 dark:group-hover:text-slate-300 shrink-0 transition" />
                )}
                <span className="text-xs text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200 transition font-medium">
                  {t('sidebar.showHidden')}
                </span>
                <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-black/5 dark:bg-white/10 text-slate-500 dark:text-slate-400 font-mono">
                  {hiddenNoteCount}
                </span>
              </div>
              <div className="relative inline-flex items-center">
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(event) => onShowHiddenChange(event.target.checked)}
                  aria-label={t('sidebar.showHidden')}
                  className="sr-only peer"
                />
                <div
                  className={`w-8 h-4.5 rounded-full transition-colors relative flex items-center p-0.5 ${
                    showHidden ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                  style={showHidden ? { backgroundColor: 'var(--color-primary)' } : undefined}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                      showHidden ? 'translate-x-3.5' : 'translate-x-0'
                    }`}
                  />
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Tags Cloud */}
        {allTags.length > 0 && (
          <section aria-label={t('sidebar.tags')}>
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 px-2">
              <span>{t('sidebar.tags')}</span>
              {selectedTag && (
                <button
                  type="button"
                  onClick={() => onSelectTag(null)}
                  className="text-xs hover:underline"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {t('sidebar.clear')}
                </button>
              )}
            </div>
            <div className="space-y-2 px-1 mb-2.5">
              <div className="relative">
                <Search aria-hidden="true" className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="search"
                  aria-label={t('sidebar.searchTags')}
                  placeholder={t('sidebar.searchTags')}
                  value={tagQuery}
                  onChange={event => setTagQuery(event.target.value)}
                  className="w-full min-w-0 h-9 pl-8 pr-8 rounded-lg border bg-transparent text-xs placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 [&::-webkit-search-cancel-button]:hidden"
                  style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
                />
                {tagQuery && <button
                  type="button"
                  aria-label={t('sidebar.clearTagSearch')}
                  onClick={() => setTagQuery('')}
                  className="absolute right-1 top-1 p-1.5 rounded-md text-slate-400 hover:bg-black/5 dark:hover:bg-white/5"
                ><X className="w-4 h-4" /></button>}
              </div>
              <Select
                aria-label={t('sidebar.sortTags')}
                value={tagSort}
                onValueChange={value => { const sort = value as TagSort; setTagSort(sort); saveTagSort(sort); }}
                options={[
                  { value: 'name-asc', label: t('sidebar.tagNameAsc') },
                  { value: 'name-desc', label: t('sidebar.tagNameDesc') },
                  { value: 'count-desc', label: t('sidebar.tagCountDesc') },
                  { value: 'count-asc', label: t('sidebar.tagCountAsc') },
                ]}
                className="w-full"
                style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}
              />
              <p role="status" className="text-[11px] text-slate-400">
                {t('sidebar.tagResults', { count: visibleTags.length, total: allTags.length })}
              </p>
              {selectedTag && !visibleTags.includes(selectedTag) && (
                <button
                  type="button"
                  onClick={() => onSelectTag(null)}
                  aria-label={t('sidebar.clearActiveTag', { tag: selectedTag })}
                  className="w-full flex items-center gap-1.5 text-xs text-left rounded-md px-2 py-1.5"
                  style={selectedItemStyle}
                >
                  <span className="min-w-0 break-words">{t('sidebar.activeTag', { tag: selectedTag })}</span>
                  <X className="w-3.5 h-3.5 shrink-0 ml-auto" />
                </button>
              )}
            </div>
            {visibleTags.length === 0 && <p className="px-2 py-3 text-xs text-slate-400">{t('sidebar.noMatchingTags')}</p>}
            <div className="sidebar-tags flex flex-wrap gap-1.5 px-1">
              {visibleTags.map((tag) => {
                const isSelected = selectedTag === tag;
                return (
                  <button
                    type="button"
                    key={tag}
                    onClick={() => onSelectTag(isSelected ? null : tag)}
                    aria-pressed={isSelected}
                    style={isSelected ? selectedItemStyle : undefined}
                    className={`max-w-full inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition border ${
                      isSelected
                        ? 'font-semibold border-black/10 dark:border-white/15 hover:opacity-90'
                        : 'text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <Tag className="w-3 h-3 shrink-0" />
                    <span className="min-w-0 break-words text-left">{tag}</span>
                    <span
                      className={`text-[10px] ml-0.5 ${
                        isSelected ? 'opacity-70' : 'text-slate-400'
                      }`}
                    >
                      {tagCounts[tag]}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
    </WorkspaceSidebar>
  );
};
