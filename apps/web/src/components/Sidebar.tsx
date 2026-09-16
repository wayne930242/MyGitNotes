import './sidebar-filters.css';
import type { FilterControls } from '../lib/filter-controls.js';
import { FolderTree } from './FolderTree.js';
import React, { useEffect, useState } from 'react';
import { Tag, Filter, GitBranch, CheckCircle2, Eye, EyeOff, Search, X, CheckSquare } from 'lucide-react';
import { NoteItem, GitStatus, FolderItem } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { WorkspaceSidebar } from './WorkspaceChrome.js';
import { Select } from './Select.js';
import { filterAndSortTags, getSavedTagSort, saveTagSort, TagSort } from '../lib/tag-list.js';
import { resolveAllNotebooksFolderSelect, resolveEnterTouchMultiSelect } from '../lib/folder-tree.js';

const selectedItemStyle: React.CSSProperties = {
  backgroundColor: 'color-mix(in srgb, var(--color-text) 8%, transparent)',
  color: 'var(--color-text)',
};

interface SidebarProps {
  onManageFiles: (notebookId: string, path: string) => void;
  folders?: FolderItem[];
  foldersWritable?: boolean;
  reorder: boolean;
  onToggleReorder: () => void;
  filters: FilterControls;
  beforeFolderChange?: () => void;
  onFoldersChanged?: () => Promise<void>;
  selectedFolder?: string | null;
  onSelectFolder?: (folder: string | null) => void;
  selectedNotebookId: string;
  notes: NoteItem[];
  hiddenNoteCount: number;
  gitStatus: GitStatus | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  folders = [],
  onManageFiles,
  foldersWritable = false, beforeFolderChange, onFoldersChanged,
  selectedFolder = null,
  onSelectFolder,
  selectedNotebookId,
  notes,
  filters, reorder, onToggleReorder, hiddenNoteCount,
  gitStatus,
}) => {
  const { t, language } = useTranslation();
  const { value, statuses, onChange } = filters;
  const { status: selectedStatus, tags: selectedTags, showHidden } = value;
  const onSelectStatus = (status: string | null) => onChange({ status });
  const onShowHiddenChange = (showHidden: boolean) => onChange({ showHidden });
  const onSelectTag = (tag: string | null) => onChange({ tags: tag === null ? [] : selectedTags.includes(tag) ? selectedTags.filter(item => item !== tag) : [...selectedTags, tag] });
  const toggleFolder = (notebookId: string, folder: string | null) => {
    if (folder === null) { onChange({ folders: [] }); return; }
    const root = filters.notebooks.find(nb => nb.id === notebookId)?.root.replace(/\/$/, '');
    if (!root) return;
    const path = `${root}/${folder}`;
    onChange({ folders: value.folders.includes(path) ? value.folders.filter(item => item !== path) : [...value.folders, path] });
  };
  // A plain click's single-select target is meaningless against the global selectedNotebookId
  // while every notebook's tree is shown at once ("all notebooks" view); scope it explicitly.
  const selectSingleFolder = (notebookId: string, folder: string | null) => {
    setTouchMultiSelect(false);
    const root = filters.notebooks.find(nb => nb.id === notebookId)?.root.replace(/\/$/, '');
    const scoped = resolveAllNotebooksFolderSelect(selectedNotebookId, root, folder);
    if (scoped) { onChange({ folders: scoped }); return; }
    onSelectFolder?.(folder);
  };
  // A touch long-press enters multi-select mode (see FolderTree/use-long-press); it exits
  // automatically once every folder has been tapped back out of the selection.
  const [touchMultiSelect, setTouchMultiSelect] = useState(false);
  useEffect(() => { if (touchMultiSelect && value.folders.length === 0) setTouchMultiSelect(false); }, [touchMultiSelect, value.folders.length]);
  const enterTouchMultiSelect = (notebookId: string, folder: string) => {
    setTouchMultiSelect(true);
    const root = filters.notebooks.find(nb => nb.id === notebookId)?.root;
    const nextFolders = resolveEnterTouchMultiSelect(value.folders, root, folder);
    if (nextFolders !== value.folders) {
      onChange({ folders: nextFolders });
    }
  };
  const [tagQuery, setTagQuery] = useState('');
  const [tagSort, setTagSort] = useState<TagSort>(getSavedTagSort);
  useEffect(() => { setTagQuery(''); }, [selectedNotebookId]);

  const notebookNotes = notes.filter((note) => selectedNotebookId === 'all' || note.notebookId === selectedNotebookId);

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

  for (const tag of selectedTags) tagCounts[tag] ??= 0;
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

        <a className="sidebar-credit" href="https://github.com/wayne930242/MyGitNotes"
          target="_blank" rel="noopener noreferrer" title="MyGitNotes by wayne930242">
          powered by <span>MyGitNotes</span>
        </a>
      </div>
    }>
        <section className="sidebar-search" aria-label={t('filters.title')}>
          <label className="sidebar-note-search header-search"><Search size={15} aria-hidden="true" />
            <input type="search" aria-label={t('header.searchPlaceholder')} placeholder={t('header.searchPlaceholder')} value={value.q} onChange={event => onChange({ q: event.target.value })} />
          </label>
          <div className="sidebar-filter-summary"><span role="status" data-filter-results={filters.count}>{t('filters.results', { count: filters.count })}</span>
            <button type="button" className="sidebar-clear-filters" onClick={filters.onClear}>{t('filters.clear')}</button>
          </div>
          {value.folders.filter(path => !folders.some(folder => {
            const root = filters.notebooks.find(nb => nb.id === folder.notebookId)?.root.replace(/\/$/, '');
            return path === `${root}/${folder.path}`;
          })).map(path => <button type="button" className="sidebar-missing-filter" key={path} aria-label={t('filters.remove', { value: path })} onClick={() => onChange({ folders: value.folders.filter(item => item !== path) })}>{path}<X size={12} /></button>)}
        </section>
        {touchMultiSelect && (
          <div role="status" className="folder-multiselect-banner">
            <div className="folder-multiselect-badge">
              <CheckSquare size={13} />
              <span>{t('folder.touchMultiSelectMode')}</span>
            </div>
            <p className="folder-multiselect-text">{t('folder.touchMultiSelectInstruction')}</p>
          </div>
        )}
        {onSelectFolder && filters.notebooks.filter(nb => selectedNotebookId === 'all' || nb.id === selectedNotebookId).map(nb => {
          const root = nb.root.replace(/\/$/, '');
          return <section className="sidebar-folder-section" key={nb.id}>
            {selectedNotebookId === 'all' && <p className="sidebar-section-label">{nb.title}</p>}
            <FolderTree onManageFiles={path => onManageFiles(nb.id, path)} reorder={reorder} onToggleReorder={onToggleReorder} folders={folders} notebookId={nb.id} selected={selectedFolder} onSelect={folder => selectSingleFolder(nb.id, folder)}
              allFoldersSelected={value.folders.length === 0}
              selectedPaths={value.folders.filter(path => path.startsWith(root + '/')).map(path => path.slice(root.length + 1))}
              onFilterFolder={folder => toggleFolder(nb.id, folder)}
              touchMultiSelect={touchMultiSelect}
              onLongPressFolder={folder => enterTouchMultiSelect(nb.id, folder)}
              writable={foldersWritable} beforeChange={beforeFolderChange} onChanged={onFoldersChanged} />
          </section>;
        })}
        <label className="sidebar-descendants"><input type="checkbox" checked={value.descendants} onChange={event => onChange({ descendants: event.target.checked })} />{t('filters.descendants')}</label>

        {/* Status Filters */}
        <details open className="sidebar-filter-section">
          <summary>{t('sidebar.statusFilter')}</summary>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 px-2">

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
        </details>

        {/* Tags Cloud */}
        {allTags.length > 0 && (
          <details open className="sidebar-filter-section" aria-label={t('sidebar.tags')}>
            <summary>{t('sidebar.tags')}</summary>
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 px-2">

              {selectedTags.length > 0 && (
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
              {selectedTags.filter(tag => !visibleTags.includes(tag)).map(tag => <button type="button" key={tag} className="sidebar-missing-filter" onClick={() => onSelectTag(tag)} aria-label={t('sidebar.clearActiveTag', { tag })}><span>#{tag}</span><X size={12} /></button>)}
            </div>
            {visibleTags.length === 0 && <p className="px-2 py-3 text-xs text-slate-400">{t('sidebar.noMatchingTags')}</p>}
            <div className="sidebar-tag-mode" role="group" aria-label={t('filters.tagMode')}>
              {(['any', 'all'] as const).map(mode => <button type="button" key={mode} aria-pressed={value.tagMode === mode} onClick={() => onChange({ tagMode: mode })}>{t(`filters.${mode}`)}</button>)}
            </div>
            <div className="sidebar-tags flex flex-wrap gap-1.5 px-1">
              {visibleTags.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <button
                    type="button"
                    key={tag}
                    data-tag-filter={tag}
                    onClick={() => onSelectTag(tag)}
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
          </details>
        )}
    </WorkspaceSidebar>
  );
};
