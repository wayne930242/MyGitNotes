import React from 'react';
import { ChevronRight, ArrowLeft, ArrowUpDown, ClockArrowDown, ClockArrowUp, CalendarArrowDown, CalendarArrowUp, ArrowDownAZ, ArrowDownZA, ListOrdered } from 'lucide-react';
import { BreadcrumbSegment } from '../lib/folder-tree.js';
import { SortField, SortOrder } from '../lib/note-sort.js';
import { Select } from './Select.js';
import { useTranslation } from '../lib/i18n/index.js';

interface BreadcrumbsProps {
  segments: BreadcrumbSegment[];
  currentFolder: string | null;
  onSelectFolder: (folder: string | null) => void;
  subfolderCount?: number;
  noteCount?: number;
  sortField?: SortField;
  sortOrder?: SortOrder;
  onSortChange?: (field: SortField, order: SortOrder) => void;
  /** A narrow dock: the sort control shows the current order as an icon. */
  compact?: boolean;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  segments,
  currentFolder,
  onSelectFolder,
  subfolderCount = 0,
  noteCount = 0,
  sortField = 'updated',
  sortOrder = 'desc',
  onSortChange,
  compact = false,
}) => {
  const { t } = useTranslation();

  const sortOptions = [
    { value: 'updated:desc', label: t('sort.updatedDesc'), Icon: ClockArrowDown },
    { value: 'updated:asc', label: t('sort.updatedAsc'), Icon: ClockArrowUp },
    { value: 'created:desc', label: t('sort.createdDesc'), Icon: CalendarArrowDown },
    { value: 'created:asc', label: t('sort.createdAsc'), Icon: CalendarArrowUp },
    { value: 'title:asc', label: t('sort.titleAsc'), Icon: ArrowDownAZ },
    { value: 'title:desc', label: t('sort.titleDesc'), Icon: ArrowDownZA },
    { value: 'status:asc', label: t('sort.status'), Icon: ListOrdered },
  ];
  const currentSort = sortOptions.find(option => option.value === `${sortField}:${sortOrder}`);

  const handleSortSelect = (val: string) => {
    const [field, order] = val.split(':') as [SortField, SortOrder];
    onSortChange?.(field, order);
  };

  // Parent folder for the "Back / Up" button
  const parentFolder = currentFolder
    ? currentFolder.includes('/')
      ? currentFolder.slice(0, currentFolder.lastIndexOf('/'))
      : null
    : null;

  return (
    <nav
      aria-label="Breadcrumbs"
      className="workspace-breadcrumbs flex items-center justify-between gap-3 px-3 py-2 md:px-4 md:py-2.5 rounded-xl border bg-black/[0.02] dark:bg-white/[0.02] mb-4 text-xs select-none transition-colors flex-wrap sm:flex-nowrap"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {currentFolder !== null && (
          <button
            type="button"
            onClick={() => onSelectFolder(parentFolder)}
            title={t('folder.goUpTooltip')}
            aria-label={t('folder.goUpTooltip')}
            className="inline-flex items-center gap-1 px-2 py-1 -ml-1 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-black/5 dark:hover:bg-white/10 transition active:scale-95 shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="font-medium hidden sm:inline">{t('folder.up')}</span>
          </button>
        )}

        {/* Folder cards and note rows already read as folders; the path lists only the folders below the root. */}
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {segments.filter(seg => seg.path !== null).map((seg, idx, shown) => {
            const isLast = idx === shown.length - 1;

            return (
              <React.Fragment key={seg.path}>
                {idx > 0 && (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mx-0.5" />
                )}

                {isLast ? (
                  <span className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100 truncate px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10">
                    <span className="truncate max-w-[160px] md:max-w-xs">{seg.name}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectFolder(seg.path)}
                    className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition px-1.5 py-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5 truncate"
                  >
                    <span className="truncate max-w-[120px] md:max-w-[200px]">{seg.name}</span>
                  </button>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Right: Sort controls & Summary indicator */}
      <div className="flex items-center gap-3 shrink-0 justify-between sm:justify-end w-full sm:w-auto pt-1 sm:pt-0 border-t sm:border-t-0 border-black/5 dark:border-white/5">
        {onSortChange && (
          <div className="flex items-center gap-1.5">
            {!compact && <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
            <Select
              aria-label={compact && currentSort ? `${t('sort.select')}: ${currentSort.label}` : t('sort.select')}
              title={compact ? currentSort?.label : undefined}
              value={`${sortField}:${sortOrder}`}
              onValueChange={handleSortSelect}
              options={sortOptions}
              icon={compact && currentSort ? <currentSort.Icon className="w-4 h-4" aria-hidden="true" /> : undefined}
              className="breadcrumb-sort-select"
            />
          </div>
        )}

        <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-mono">
          {subfolderCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400">
              {subfolderCount === 1 ? t('folder.subfolderCount', { count: 1 }) : t('folder.subfoldersCount', { count: subfolderCount })}
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400">
            {noteCount === 1 ? t('folder.noteCount', { count: 1 }) : t('folder.notesCount', { count: noteCount })}
          </span>
        </div>
      </div>
    </nav>
  );
};
