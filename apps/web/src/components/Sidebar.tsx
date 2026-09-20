import './sidebar-filters.css';
import type { FilterControls } from '../lib/filter-controls.js';
import { FolderTree } from './FolderTree.js';
import React, { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, CheckSquare, ChevronsDownUp, ChevronsUpDown, Filter, GitBranch, Library, MoreHorizontal, Search, Tag, X } from 'lucide-react';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import { FolderItem, GitStatus } from '../lib/types.js';
import { mergeNotebookFacets, queryNotebookIds } from '../lib/note-facets.js';
import { useTranslation } from '../lib/i18n/index.js';
import { WorkspaceSidebar } from './WorkspaceChrome.js';
import { Select } from './Select.js';
import { LoadingStatus } from './LoadingStatus.js';
import { filterAndSortTags, getSavedTagSort, saveTagSort, TagSort } from '../lib/tag-list.js';
import { resolveAllNotebooksFolderSelect, resolveEnterTouchMultiSelect } from '../lib/folder-tree.js';
import { NavTree, NavTreeRow } from './NavTree.js';
import { ReorderToggle } from './ReorderToggle.js';
import { TagActions } from './TagActions.js';

const selectedItemStyle: React.CSSProperties = { backgroundColor: 'color-mix(in srgb, var(--color-text) 8%, transparent)', color: 'var(--color-text)' };

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
  /** Per-notebook counts from `/api/notes/facets`, with staged drafts already applied. */
  facets?: Record<string, NotebookFacets>;
  facetsLoading?: boolean;
  facetsError?: string;
  workspaceTagNames: string[];
  gitStatus: GitStatus | null;
  canManageTags?: boolean;
  onPreviewTagUsage?: (tag: string) => Promise<number>;
  onRenameTag?: (from: string, to: string) => Promise<void>;
  onMergeTag?: (from: string, into: string) => Promise<void>;
  onDeleteTag?: (tag: string) => Promise<void>;
}

export const Sidebar: React.FC<SidebarProps> = ({ folders = [], onManageFiles, foldersWritable = false, beforeFolderChange, onFoldersChanged, selectedFolder = null, onSelectFolder, selectedNotebookId, facets, facetsLoading = false, facetsError = '', workspaceTagNames, filters, reorder, onToggleReorder, gitStatus, canManageTags = false, onPreviewTagUsage, onRenameTag, onMergeTag, onDeleteTag }) => {
  const { t, language } = useTranslation();
  const { value, statuses, onChange } = filters;
  const { status: selectedStatus, tags: selectedTags } = value;
  const allNotebooks = filters.allNotebooks;
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<string>>(() => new Set(selectedNotebookId ? [selectedNotebookId] : []));
  const [expansionSelection, setExpansionSelection] = useState<{ notebookId: string; folders: typeof value.folders; notebooks: typeof filters.notebooks; }>();
  if (!expansionSelection || expansionSelection.notebookId !== selectedNotebookId || expansionSelection.folders !== value.folders || expansionSelection.notebooks !== filters.notebooks) {
    setExpansionSelection({ notebookId: selectedNotebookId, folders: value.folders, notebooks: filters.notebooks });
    const next = new Set(expandedNotebooks);
    if ((!expansionSelection || expansionSelection.notebookId !== selectedNotebookId) && selectedNotebookId) next.add(selectedNotebookId);
    if (!expansionSelection || expansionSelection.folders !== value.folders || expansionSelection.notebooks !== filters.notebooks) {
      for (const nb of filters.notebooks) if (value.folders.some(path => path.startsWith(nb.root.replace(/\/$/, '') + '/'))) next.add(nb.id);
    }
    setExpandedNotebooks(next);
  }
  const [folderExpandCommand, setFolderExpandCommand] = useState<{ expanded: boolean; }>();
  // Both commands reach the notebook level: expanding opens every notebook, collapsing closes them all.
  const expandAll = (expanded: boolean) => {
    setExpandedNotebooks(expanded ? new Set(filters.notebooks.map(nb => nb.id)) : new Set());
    setFolderExpandCommand({ expanded });
  };
  const onSelectStatus = (status: string | null) => onChange({ status });
  const onSelectTag = (tag: string | null) => onChange({ tags: tag === null ? [] : selectedTags.includes(tag) ? selectedTags.filter(item => item !== tag) : [...selectedTags, tag] });
  const toggleFolder = (notebookId: string, folder: string | null) => {
    if (folder === null) {
      onChange({ folders: [] });
      return;
    }
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
    const scoped = resolveAllNotebooksFolderSelect(value.notebookId, root, folder);
    if (scoped) {
      onChange({ folders: scoped });
      return;
    }
    onSelectFolder?.(folder);
  };
  // A touch long-press enters multi-select mode (see FolderTree/use-long-press); it exits
  // automatically once every folder has been tapped back out of the selection.
  const [touchMultiSelect, setTouchMultiSelect] = useState(false);
  useEffect(() => {
    if (touchMultiSelect && value.folders.length === 0) setTouchMultiSelect(false);
  }, [touchMultiSelect, value.folders.length]);
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
  const [tagNotebook, setTagNotebook] = useState(selectedNotebookId);
  if (tagNotebook !== selectedNotebookId) {
    setTagNotebook(selectedNotebookId);
    setTagQuery('');
  }

  const notebookFacets = mergeNotebookFacets(queryNotebookIds(filters.notebooks, value.notebookId, value.folders).flatMap(id => facets?.[id] || []));
  const statusCounts = notebookFacets.statuses;
  const tagCounts: Record<string, number> = { ...notebookFacets.tags };
  for (const tag of selectedTags) tagCounts[tag] ??= 0;
  const allTags = Object.keys(tagCounts);
  const visibleTags = filterAndSortTags(tagCounts, tagQuery, tagSort, language);

  const modifiedCount = gitStatus?.modified.length || 0;
  const untrackedCount = gitStatus?.untracked.length || 0;
  const stagedCount = gitStatus?.staged.length || 0;
  const dirtyCount = modifiedCount + untrackedCount + stagedCount;

  return (
    <WorkspaceSidebar
      label={t('sidebar.statusFilter')}
      className='notes-sidebar'
      footer={
        <div className='pt-3 mt-3 border-t shrink-0 flex flex-col gap-2.5' style={{ borderColor: 'var(--color-border)' }}>
          <div className='flex items-center justify-between px-3 py-2 rounded-xl border shadow-xs transition-colors' style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div className='flex items-center gap-2.5'>
              <div className='w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-fg/5' style={{ color: 'var(--color-muted)' }}>
                <GitBranch className='w-4 h-4' />
              </div>
              <div className='flex flex-col'>
                <span className='font-mono text-xs font-semibold text-fg leading-tight'>{gitStatus?.branch || 'main'}</span>
                <span className='text-[10px] text-muted leading-tight'>{gitStatus?.branch === 'core' ? t('sidebar.productCore') : t('sidebar.userWorkspace')}</span>
              </div>
            </div>
            <div>
              {dirtyCount > 0
                ? (
                  <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-warning-soft text-warning'>
                    <span className='w-1.5 h-1.5 rounded-full bg-warning animate-pulse' />
                    {t('sidebar.dirty', { count: dirtyCount })}
                  </span>
                )
                : (
                  <span className='inline-flex items-center gap-1 text-[10px] text-success font-medium'>
                    <CheckCircle2 className='w-3.5 h-3.5' />
                    {t('sidebar.clean')}
                  </span>
                )}
            </div>
          </div>
          <a className='sidebar-credit' href='https://github.com/wayne930242/MyGitNotes' target='_blank' rel='noopener noreferrer' title='MyGitNotes by wayne930242'>
            {'powered by '}
            <span>MyGitNotes</span>
          </a>
        </div>
      }
    >
      <section className='sidebar-search' aria-label={t('filters.title')}>
        <div className='sidebar-search-row'>
          <label className='sidebar-note-search header-search'>
            <Search size={15} aria-hidden='true' />
            <input type='search' aria-label={t('header.searchPlaceholder')} placeholder={t('header.searchPlaceholder')} value={value.q} onChange={event => onChange({ q: event.target.value })} />
          </label>
          {onSelectFolder && (
            <div className='sidebar-panel-actions' role='group' aria-label={t('sidebar.notebooks')}>
              {filters.notebooks.length > 1 && (
                <button type='button' className='ui-icon-button all-notebooks-toggle' title={t('filters.allNotebooks')} aria-label={t('filters.allNotebooks')} aria-pressed={allNotebooks} onClick={() => filters.onAllNotebooksChange(!allNotebooks)}>
                  <Library size={15} />
                </button>
              )}
              <button type='button' className='ui-icon-button' title={t('folder.expandAll')} aria-label={t('folder.expandAll')} onClick={() => expandAll(true)}>
                <ChevronsUpDown size={15} />
              </button>
              <button type='button' className='ui-icon-button' title={t('folder.collapseAll')} aria-label={t('folder.collapseAll')} onClick={() => expandAll(false)}>
                <ChevronsDownUp size={15} />
              </button>
            </div>
          )}
        </div>
        <div className='sidebar-filter-summary'>
          {filters.count === null ? <LoadingStatus as='span'>{t('notes.countsLoading')}</LoadingStatus> : <span role='status' data-filter-results={filters.count}>{t('filters.results', { count: filters.count })}</span>}
          {/* The line above already says the counts are loading, so the facets only speak for themselves once it stops. */}
          {facetsLoading && filters.count !== null && <LoadingStatus as='span' className='sidebar-facets-status'>{t('notes.countsLoading')}</LoadingStatus>}
          {facetsError && <span role='alert' className='sidebar-facets-status'>{t('notes.countsFailed', { message: facetsError })}</span>}
          <button type='button' className='sidebar-clear-filters' onClick={filters.onClear}>{t('filters.clear')}</button>
        </div>
        {value.folders.filter(path =>
          !filters.notebooks.some(nb => path === nb.root.replace(/\/$/, '')) && !folders.some(folder => {
            const root = filters.notebooks.find(nb => nb.id === folder.notebookId)?.root.replace(/\/$/, '');
            return path === `${root}/${folder.path}`;
          })
        ).map(path => (
          <button type='button' className='sidebar-missing-filter' key={path} aria-label={t('filters.remove', { value: path })} onClick={() => onChange({ folders: value.folders.filter(item => item !== path) })}>
            {path}
            <X size={12} />
          </button>
        ))}
      </section>
      {touchMultiSelect && (
        <div role='status' className='folder-multiselect-banner'>
          <div className='folder-multiselect-badge'>
            <CheckSquare size={13} />
            <span>{t('folder.touchMultiSelectMode')}</span>
          </div>
          <p className='folder-multiselect-text'>{t('folder.touchMultiSelectInstruction')}</p>
        </div>
      )}
      {onSelectFolder && (
        <section className='sidebar-notebooks' aria-label={t('sidebar.notebooks')}>
          <NavTree aria-label={t('sidebar.notebooks')}>
            {filters.notebooks.filter(nb => allNotebooks || nb.id === selectedNotebookId).map(nb => {
              const root = nb.root.replace(/\/$/, '');
              const selectedPaths = value.folders.filter(path => path.startsWith(root + '/')).map(path => path.slice(root.length + 1));
              const expanded = expandedNotebooks.has(nb.id);
              const count = facets ? facets[nb.id]?.total ?? 0 : null;
              const nbFolders = folders.filter(f => f.notebookId === nb.id);
              const hasFolders = nbFolders.length > 0;
              const isCurrentNotebook = nb.id === selectedNotebookId;
              const isSelected = allNotebooks ? value.folders.includes(root) : isCurrentNotebook && selectedFolder === null && value.folders.length === 0;

              return (
                <section className='sidebar-notebook-group' key={nb.id} data-selected={isSelected || selectedPaths.length > 0} data-scope={allNotebooks ? (isCurrentNotebook ? 'current' : 'included') : undefined}>
                  <NavTreeRow
                    hasChildren={hasFolders}
                    isExpanded={expanded}
                    onToggleExpand={() => {
                      setExpandedNotebooks(previous => {
                        const next = new Set(previous);
                        if (next.has(nb.id)) next.delete(nb.id);
                        else next.add(nb.id);
                        return next;
                      });
                    }}
                    icon={<BookOpen size={16} />}
                    title={nb.title}
                    selected={isSelected}
                    onSelect={event => {
                      if (allNotebooks) {
                        if (event.metaKey || event.ctrlKey || event.shiftKey) {
                          onChange({
                            folders: value.folders.includes(root)
                              ? value.folders.filter(path => path !== root)
                              : [...value.folders, root],
                          });
                        } else {
                          onChange({ folders: [root] });
                          if (!expanded) {
                            setExpandedNotebooks(previous => new Set([...previous, nb.id]));
                          }
                        }
                      } else {
                        selectSingleFolder(nb.id, null);
                      }
                    }}
                    suffix={<span className='sidebar-notebook-count' title={count === null ? t('notes.countsLoading') : t('folder.noteCount', { count })}>{count ?? '—'}</span>}
                    actions={foldersWritable && isCurrentNotebook
                      ? (
                        <div className='folder-heading-actions'>
                          {onToggleReorder && <ReorderToggle active={reorder} onToggle={onToggleReorder} />}
                          <button type='button' className='folder-manage' aria-label={`${t('folder.manage')}: ${nb.title}`} title={t('folder.manage')} onClick={() => onManageFiles(nb.id, '')}>
                            <MoreHorizontal size={15} />
                          </button>
                        </div>
                      )
                      : undefined}
                  />
                  <div id={`notebook-folders-${nb.id}`} hidden={!expanded} className='sidebar-notebook-folders'>{hasFolders ? <FolderTree onManageFiles={path => onManageFiles(nb.id, path)} reorder={reorder} onToggleReorder={onToggleReorder} folders={folders} notebookId={nb.id} selected={isCurrentNotebook ? selectedFolder : null} onSelect={folder => selectSingleFolder(nb.id, folder)} allFoldersSelected={value.folders.length === 0} selectedPaths={selectedPaths} onFilterFolder={folder => toggleFolder(nb.id, folder)} touchMultiSelect={touchMultiSelect} onLongPressFolder={folder => enterTouchMultiSelect(nb.id, folder)} writable={foldersWritable && isCurrentNotebook} beforeChange={beforeFolderChange} onChanged={onFoldersChanged} expandCommand={folderExpandCommand} /> : <p className='sidebar-notebook-empty'>{t('folder.subfolderCount', { count: 0 })}</p>}</div>
                </section>
              );
            })}
          </NavTree>
        </section>
      )}
      {/* Status Filters */}
      <details key={`status-${selectedNotebookId}-${Boolean(selectedStatus)}`} open={!allNotebooks || Boolean(selectedStatus)} className='sidebar-filter-section'>
        <summary>{t('sidebar.statusFilter')}</summary>
        <div className='flex items-center justify-between text-xs font-semibold text-muted uppercase tracking-wider mb-2.5 px-2'>{selectedStatus && <button type='button' onClick={() => onSelectStatus(null)} className='text-xs hover:underline capitalize' style={{ color: 'var(--color-muted)' }}>{t('sidebar.clear')}</button>}</div>
        <div className='space-y-1 text-sm'>
          <button type='button' onClick={() => onSelectStatus(null)} aria-pressed={selectedStatus === null} style={selectedStatus === null ? selectedItemStyle : undefined} className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition ${selectedStatus === null ? 'font-semibold hover:opacity-90' : 'text-muted hover:bg-fg/5 hover:text-fg'}`}>
            <div className='flex items-center gap-2'>
              <Filter className='w-3.5 h-3.5 text-muted' />
              <span>{t('sidebar.allStatuses')}</span>
            </div>
            <span className='text-xs text-muted'>{facets ? notebookFacets.total : '—'}</span>
          </button>
          {statuses.map((status) => {
            const count = facets ? statusCounts[status] || 0 : null;
            const isSelected = selectedStatus === status;

            return (
              <button type='button' key={status} data-status-filter={status} onClick={() => onSelectStatus(isSelected ? null : status)} aria-pressed={isSelected} style={isSelected ? selectedItemStyle : undefined} className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition ${isSelected ? 'font-semibold hover:opacity-90' : 'text-muted hover:bg-fg/5 hover:text-fg'}`}>
                <div className='flex items-center gap-2'>
                  <span className={`w-2 h-2 rounded-full ${status === 'done' ? 'bg-success' : status === 'working' || status === 'doing' ? 'bg-info' : status === 'todo' ? 'bg-warning' : 'bg-muted'}`} />
                  <span className='truncate'>{status}</span>
                </div>
                <span className='text-xs text-muted'>{count ?? '—'}</span>
              </button>
            );
          })}
        </div>
      </details>
      {/* Tags Cloud */}
      {allTags.length > 0 && (
        <details key={`tags-${selectedNotebookId}-${selectedTags.length > 0}`} open={!allNotebooks || selectedTags.length > 0} className='sidebar-filter-section' aria-label={t('sidebar.tags')}>
          <summary>{t('sidebar.tags')}</summary>
          <div className='flex items-center justify-between text-xs font-semibold text-muted uppercase tracking-wider mb-2.5 px-2'>{selectedTags.length > 0 && <button type='button' onClick={() => onSelectTag(null)} className='text-xs hover:underline' style={{ color: 'var(--color-muted)' }}>{t('sidebar.clear')}</button>}</div>
          <div className='space-y-2 px-1 mb-2.5'>
            <div className='relative'>
              <Search aria-hidden='true' className='absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted pointer-events-none' />
              <input type='search' aria-label={t('sidebar.searchTags')} placeholder={t('sidebar.searchTags')} value={tagQuery} onChange={event => setTagQuery(event.target.value)} className='w-full min-w-0 h-9 pl-8 pr-8 rounded-lg border bg-transparent text-xs placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-muted [&::-webkit-search-cancel-button]:hidden' style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }} />
              {tagQuery && (
                <button type='button' aria-label={t('sidebar.clearTagSearch')} onClick={() => setTagQuery('')} className='absolute right-1 top-1 p-1.5 rounded-md text-muted hover:bg-fg/5'>
                  <X className='w-4 h-4' />
                </button>
              )}
            </div>
            <Select
              aria-label={t('sidebar.sortTags')}
              value={tagSort}
              onValueChange={value => {
                const sort = value as TagSort;
                setTagSort(sort);
                saveTagSort(sort);
              }}
              options={[{ value: 'name-asc', label: t('sidebar.tagNameAsc') }, { value: 'name-desc', label: t('sidebar.tagNameDesc') }, { value: 'count-desc', label: t('sidebar.tagCountDesc') }, { value: 'count-asc', label: t('sidebar.tagCountAsc') }]}
              className='w-full'
              style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}
            />
            <p role='status' className='text-[11px] text-muted'>{t('sidebar.tagResults', { count: visibleTags.length, total: allTags.length })}</p>
            {selectedTags.filter(tag => !visibleTags.includes(tag)).map(tag => (
              <button type='button' key={tag} className='sidebar-missing-filter' onClick={() => onSelectTag(tag)} aria-label={t('sidebar.clearActiveTag', { tag })}>
                <span>#{tag}</span>
                <X size={12} />
              </button>
            ))}
          </div>
          {visibleTags.length === 0 && <p className='px-2 py-3 text-xs text-muted'>{t('sidebar.noMatchingTags')}</p>}
          <div className='sidebar-tag-mode' role='group' aria-label={t('filters.tagMode')}>{(['any', 'all'] as const).map(mode => <button type='button' key={mode} aria-pressed={value.tagMode === mode} onClick={() => onChange({ tagMode: mode })}>{t(`filters.${mode}`)}</button>)}</div>
          <div className='sidebar-tags flex flex-wrap gap-1.5 px-1'>
            {visibleTags.map((tag) => {
              const isSelected = selectedTags.includes(tag);
              const tagChip = (
                <button type='button' data-tag-filter={tag} onClick={() => onSelectTag(tag)} aria-pressed={isSelected} style={isSelected ? selectedItemStyle : undefined} className={`max-w-full inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition border ${isSelected ? 'font-semibold border-line hover:opacity-90' : 'text-muted bg-surface border-line hover:border-muted hover:bg-sidebar hover:text-fg'}`}>
                  <Tag className='w-3 h-3 shrink-0' />
                  <span className='min-w-0 break-words text-left'>{tag}</span>
                  <span className={`text-[10px] ml-0.5 ${isSelected ? 'opacity-70' : 'text-muted'}`}>{tagCounts[tag]}</span>
                </button>
              );
              return (
                <div key={tag} className='inline-flex flex-col items-start gap-1 max-w-full'>
                  <div className='sidebar-tag-row inline-flex items-center gap-1 max-w-full'>{canManageTags && onPreviewTagUsage && onRenameTag && onMergeTag && onDeleteTag ? <TagActions tag={tag} allTags={workspaceTagNames} onPreviewUsage={onPreviewTagUsage} onRename={onRenameTag} onMerge={onMergeTag} onDelete={onDeleteTag}>{tagChip}</TagActions> : tagChip}</div>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </WorkspaceSidebar>
  );
};
