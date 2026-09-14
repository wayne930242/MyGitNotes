import { LayoutList, LayoutGrid, Kanban, ListTree, Plus } from 'lucide-react';
import { WorkspaceSidebarToggle } from './WorkspaceChrome.js';
import { Select } from './Select.js';
import { ViewMode } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';

interface NoteToolbarProps {
  readOnly: boolean;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  onOpenNewNoteModal: () => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
}

export function NoteToolbar({ readOnly, viewMode, setViewMode, onOpenNewNoteModal, filtersOpen, onToggleFilters }: NoteToolbarProps) {
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
                <button
                  type="button"
                  aria-label={t('header.newNote')}
                  onClick={onOpenNewNoteModal}
                  style={{ backgroundColor: 'var(--color-primary)' }}
                  className="header-new-note flex items-center gap-1.5 px-3.5 py-1.5 text-white rounded-lg text-sm font-medium shadow-sm transition hover:opacity-90 active:scale-95 shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t('header.newNote')}</span>
                </button>
              )}
            </div>
  );
}
