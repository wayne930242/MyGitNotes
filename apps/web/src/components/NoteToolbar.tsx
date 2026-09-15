import { Button } from './Button.js';
import { LayoutList, LayoutGrid, Kanban, ListTree, Plus } from 'lucide-react';
import { WorkspaceSidebarToggle } from './WorkspaceChrome.js';
import { Select } from './Select.js';
import type { SortField, SortOrder } from '../lib/note-sort.js';
import { ViewMode } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';

interface NoteToolbarProps {
  sortField: SortField;
  sortOrder: SortOrder;
  onSortChange: (field: SortField, order: SortOrder) => void;
  readOnly: boolean;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  onOpenNewNoteModal: () => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
}

export function NoteToolbar({ sortField, sortOrder, onSortChange, readOnly, viewMode, setViewMode, onOpenNewNoteModal, filtersOpen, onToggleFilters }: NoteToolbarProps) {
  const { t } = useTranslation();
  return (
            <div className="header-note-actions flex items-center gap-2.5 flex-1 min-w-0 justify-end">
              <WorkspaceSidebarToggle label="Notebooks and filters" open={filtersOpen}
                controlsId="notebook-panel" onClick={onToggleFilters} />

              {/* View Switcher Mobile */}
              <Select
                aria-label="Note view"
                value={viewMode}
                onValueChange={(value) => setViewMode(value as ViewMode)}
                options={[
                  { value: 'flat', label: t('view.flat') },
                  { value: 'list', label: t('layout.list') },
                  { value: 'card', label: t('layout.card') },
                  { value: 'kanban', label: t('layout.kanban') },
                ]}
                className="mobile-only note-view-select px-1"
              />

              {viewMode === 'flat' && (
      <Select className="mobile-only note-toolbar-sort"
        aria-label={t('sort.select')}
        value={`${sortField}:${sortOrder}`}
        onValueChange={value => {
          const [field, order] = value.split(':') as [SortField, SortOrder];
          onSortChange(field, order);
        }}
        options={[
          { value: 'updated:desc', label: t('sort.updatedDesc') },
          { value: 'updated:asc', label: t('sort.updatedAsc') },
          { value: 'created:desc', label: t('sort.createdDesc') },
          { value: 'created:asc', label: t('sort.createdAsc') },
          { value: 'title:asc', label: t('sort.titleAsc') },
          { value: 'title:desc', label: t('sort.titleDesc') },
          { value: 'status:asc', label: t('sort.status') },
        ]}
      />
              )}

              {/* View Switcher Desktop */}
              <div className="desktop-views flex items-center bg-black/5 dark:bg-white/5 p-1 rounded-lg gap-1 shrink-0">
                {([{ mode: 'flat', icon: ListTree }, { mode: 'list', icon: LayoutList }, { mode: 'card', icon: LayoutGrid }, { mode: 'kanban', icon: Kanban }] as const).map(({ mode, icon: Icon }) =>
                  <button key={mode} type="button" onClick={() => setViewMode(mode)} title={t(`view.${mode}`)} aria-label={t(`view.${mode}`)} aria-pressed={viewMode === mode}
                    style={viewMode === mode ? { backgroundColor: 'var(--color-surface)', color: 'var(--color-primary)' } : undefined}
                    className={`p-1.5 rounded-md transition ${viewMode === mode ? 'shadow-xs hover:opacity-90' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10'}`}>
                    <Icon className="w-4 h-4" />
                  </button>)}
              </div>

              {/* New Note Button */}
              {!readOnly && (
                <Button variant="primary"
                  type="button"
                  aria-label={t('header.newNote')}
                  onClick={onOpenNewNoteModal}
                  className="header-new-note"
>
                  <Plus className="w-4 h-4" />
                  <span>{t('header.newNote')}</span>
                </Button>
              )}
            </div>
  );
}
