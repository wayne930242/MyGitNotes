import { LayoutList, LayoutGrid, Kanban, ListTree, Plus, Search, PanelLeft } from 'lucide-react';
import { Select } from './Select.js';
import { ViewMode } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';

interface NoteToolbarProps {
  readOnly: boolean;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onOpenNewNoteModal: () => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
}

export function NoteToolbar({ readOnly, viewMode, setViewMode, searchQuery, setSearchQuery, onOpenNewNoteModal, filtersOpen, onToggleFilters }: NoteToolbarProps) {
  const { t } = useTranslation();
  return (
            <div className="header-note-actions flex items-center gap-2.5 flex-1 min-w-0 justify-end">
              <button
                type="button"
                aria-label="Notebooks and filters"
                aria-expanded={filtersOpen}
                aria-controls="notebook-panel"
                onClick={onToggleFilters}
                className="mobile-only items-center justify-center rounded-lg border hover:bg-black/5 dark:hover:bg-white/10 transition"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <PanelLeft className="w-5 h-5" />
              </button>

              {/* Search Bar */}
              <div className="header-search relative w-full min-w-0 max-w-xs">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  aria-label={t('header.searchPlaceholder')}
                  placeholder={t('header.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-1.5 bg-black/5 dark:bg-white/5 border border-slate-200/80 dark:border-slate-700/80 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                  style={{ backgroundColor: 'var(--color-bg)' }}
                />
              </div>

              {/* View Switcher Mobile */}
              <Select
                aria-label="Note view"
                value={viewMode}
                onValueChange={(value) => setViewMode(value as ViewMode)}
                options={[
                  { value: 'list', label: t('layout.list') },
                  { value: 'card', label: t('layout.card') },
                  { value: 'kanban', label: t('layout.kanban') },
                  { value: 'flat', label: t('view.flat') },
                ]}
                className="mobile-only note-view-select px-1"
              />

              {/* View Switcher Desktop */}
              <div className="desktop-views flex items-center bg-black/5 dark:bg-white/5 p-1 rounded-lg gap-1 shrink-0">
                {([{ mode: 'list', icon: LayoutList }, { mode: 'card', icon: LayoutGrid }, { mode: 'kanban', icon: Kanban }, { mode: 'flat', icon: ListTree }] as const).map(({ mode, icon: Icon }) =>
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
