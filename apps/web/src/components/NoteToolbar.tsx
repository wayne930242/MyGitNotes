import './note-toolbar.css';
import { type ReactNode, type Ref, useImperativeHandle, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Eye, EyeOff, FileText, FolderTree, GalleryHorizontalEnd, Kanban, LayoutGrid, LayoutList, ListTree, Plus, Search, X } from 'lucide-react';
import { WorkspaceSidebarToggle } from './WorkspaceChrome.js';
import { Select } from './Select.js';
import { SelectButtonGroup, SelectButtonPrimary, SelectButtonTrigger } from './SelectButton.js';
import type { SortField, SortOrder } from '../lib/note-sort.js';
import { ViewMode } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';

interface NoteToolbarProps {
  showHidden: boolean;
  descendants: boolean;
  /** Hidden notes in scope, or null while the counts are still being answered. */
  hiddenNoteCount: number | null;
  onShowHiddenChange: (value: boolean) => void;
  onDescendantsChange: (value: boolean) => void;
  sortField: SortField;
  sortOrder: SortOrder;
  onSortChange: (field: SortField, order: SortOrder) => void;
  readOnly: boolean;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  onNewNote: () => void;
  /** Each of these creates at once, with default values, at the notebook root. */
  onNewCompilation: () => void;
  onNewOutline?: () => void;
  /** The notebook's note templates, each a New menu item that creates a note from it. */
  templates?: { id: string; title: string; }[];
  onNewFromTemplate?: (templateId: string) => void;
  /** The note search, the `q` query parameter. */
  query: string;
  onQueryChange: (query: string) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  /** The Focus switcher and division picker. */
  focusControls?: ReactNode;
  onImportLegacy?: () => void;
  /** Lets the "Search the note list" command reach the field, opening it first on narrow screens. */
  searchRef?: Ref<NoteSearchHandle>;
}

export interface NoteSearchHandle {
  focus: () => void;
}

export function NoteToolbar({ showHidden, descendants, hiddenNoteCount, onShowHiddenChange, onDescendantsChange, sortField, sortOrder, onSortChange, readOnly, viewMode, setViewMode, onNewNote, onNewCompilation, onNewOutline, templates = [], onNewFromTemplate, query, onQueryChange, filtersOpen, onToggleFilters, focusControls, onImportLegacy, searchRef }: NoteToolbarProps) {
  const { t } = useTranslation();
  // Below 768px the field is hidden behind a button and expands over the toolbar.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  useImperativeHandle(searchRef, () => ({
    focus: () => {
      setSearchOpen(true);
      requestAnimationFrame(() => searchInput.current?.focus());
    },
  }), []);
  return (
    <div className='header-note-actions flex items-center gap-2.5 flex-1 min-w-0 justify-end'>
      <WorkspaceSidebarToggle label={t('filters.notebookPanel')} open={filtersOpen} controlsId='notebook-panel' onClick={onToggleFilters} />
      <button type='button' className='ui-icon-button note-search-toggle' aria-label={t('header.searchPlaceholder')} aria-expanded={searchOpen} aria-controls='note-toolbar-search' data-active={query.trim() ? true : undefined} onClick={() => setSearchOpen(true)}>
        <Search size={16} aria-hidden='true' />
      </button>
      <div id='note-toolbar-search' className='note-toolbar-search' role='search' data-open={searchOpen || undefined}>
        <label className='note-search-field'>
          <Search size={15} aria-hidden='true' />
          <input ref={searchInput} type='search' aria-label={t('header.searchPlaceholder')} placeholder={t('header.searchPlaceholder')} value={query} onChange={event => onQueryChange(event.target.value)} />
        </label>
        <button type='button' className='ui-icon-button note-search-close' aria-label={t('common.close')} onClick={() => setSearchOpen(false)}>
          <X size={16} aria-hidden='true' />
        </button>
      </div>
      {/* View Switcher Mobile */}
      <Select aria-label={t('filters.noteView')} value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)} options={[{ value: 'flat', label: t('view.flat') }, { value: 'list', label: t('layout.list') }, { value: 'card', label: t('layout.card') }, { value: 'kanban', label: t('layout.kanban') }]} className='mobile-only note-view-select px-1' />
      {viewMode === 'flat' && (
        <Select
          className='mobile-only note-toolbar-sort'
          aria-label={t('sort.select')}
          value={`${sortField}:${sortOrder}`}
          onValueChange={value => {
            const [field, order] = value.split(':') as [SortField, SortOrder];
            onSortChange(field, order);
          }}
          options={[{ value: 'updated:desc', label: t('sort.updatedDesc') }, { value: 'updated:asc', label: t('sort.updatedAsc') }, { value: 'created:desc', label: t('sort.createdDesc') }, { value: 'created:asc', label: t('sort.createdAsc') }, { value: 'title:asc', label: t('sort.titleAsc') }, { value: 'title:desc', label: t('sort.titleDesc') }, { value: 'status:asc', label: t('sort.status') }]}
        />
      )}
      <div className='note-display-options' role='group' aria-label={t('filters.title')}>
        <button type='button' className='note-display-toggle' aria-label={t('filters.hidden')} aria-pressed={showHidden} aria-describedby='hidden-notes-tooltip' onClick={() => onShowHiddenChange(!showHidden)}>
          {showHidden ? <Eye size={16} aria-hidden='true' /> : <EyeOff size={16} aria-hidden='true' />}
          <span id='hidden-notes-tooltip' role='tooltip' className='note-display-tooltip'>{t('filters.hidden')}{' ('}{hiddenNoteCount ?? '—'})</span>
        </button>
        <button type='button' className='note-display-toggle' aria-label={t('filters.descendants')} aria-pressed={descendants} aria-describedby='descendants-tooltip' onClick={() => onDescendantsChange(!descendants)}>
          <FolderTree size={16} aria-hidden='true' />
          <span id='descendants-tooltip' role='tooltip' className='note-display-tooltip'>{t('filters.descendants')}</span>
        </button>
      </div>
      {focusControls && <div className='note-focus-controls' role='group' aria-label={t('focus.title')}>{focusControls}</div>}
      {/* View Switcher Desktop */}
      <div className='desktop-views flex items-center bg-fg/5 p-1 rounded-lg gap-1 shrink-0'>
        {([{ mode: 'flat', icon: ListTree }, { mode: 'list', icon: LayoutList }, { mode: 'card', icon: LayoutGrid }, { mode: 'kanban', icon: Kanban }] as const).map(({ mode, icon: Icon }) => (
          <button
            key={mode}
            type='button'
            onClick={() => setViewMode(mode)}
            title={t(`view.${mode}`)}
            aria-label={t(`view.${mode}`)}
            aria-pressed={viewMode === mode}
            style={viewMode === mode ? { backgroundColor: 'var(--color-surface)', color: 'var(--color-primary)' } : undefined}
            className={`p-1.5 rounded-md transition ${viewMode === mode ? 'shadow-xs hover:opacity-90' : 'text-muted hover:text-fg hover:bg-fg/5'}`}
          >
            <Icon className='w-4 h-4' />
          </button>
        ))}
      </div>
      {/* New Note Button */}
      {(!readOnly || onImportLegacy) && (
        <SelectButtonGroup>
          {!readOnly && (
            <SelectButtonPrimary aria-label={t('header.newNote')} onClick={onNewNote} className='ui-button-primary header-new-note'>
              <Plus aria-hidden='true' />
              <span>{t('header.newNote')}</span>
            </SelectButtonPrimary>
          )}
          <DropdownMenu.Root>
            <SelectButtonTrigger className='ui-button-primary' aria-label={t('header.newMenu')} title={t('header.newMenu')}>
              <ChevronDown aria-hidden='true' />
            </SelectButtonTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className='focus-menu' align='end' sideOffset={4} collisionPadding={8} aria-label={t('header.newMenu')}>
                {!readOnly && (
                  <DropdownMenu.Item onSelect={onNewNote}>
                    <Plus size={14} aria-hidden='true' />
                    {t('header.newNote')}
                  </DropdownMenu.Item>
                )}
                {!readOnly && onNewFromTemplate && templates.map(template => (
                  <DropdownMenu.Item
                    key={template.id}
                    onSelect={() => onNewFromTemplate(template.id)}
                  >
                    <FileText size={14} aria-hidden='true' />
                    {t('header.newFromTemplate', { template: template.title })}
                  </DropdownMenu.Item>
                ))}
                {!readOnly && onNewOutline && (
                  <DropdownMenu.Item onSelect={onNewOutline}>
                    <ListTree size={14} aria-hidden='true' />
                    {t('outline.new')}
                  </DropdownMenu.Item>
                )}
                {!readOnly && (
                  <DropdownMenu.Item onSelect={onNewCompilation}>
                    <GalleryHorizontalEnd size={14} aria-hidden='true' />
                    {t('compilation.new')}
                  </DropdownMenu.Item>
                )}
                {onImportLegacy && <DropdownMenu.Item onSelect={onImportLegacy}>{t('legacyOutline.title')}</DropdownMenu.Item>}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </SelectButtonGroup>
      )}
    </div>
  );
}
