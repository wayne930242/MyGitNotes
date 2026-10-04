import { type ReactNode, useState } from 'react';
import { Brain, ChevronLeft, ChevronRight, Columns2, Columns3, LayoutGrid, Network, Plus, Rows3, SlidersHorizontal, Zap } from 'lucide-react';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { type NotebookFacets, noteQueryStatuses } from '@mygitnotes/core/note-query';
import type { NotebookConfig } from '../lib/types.js';
import type { SortConfig } from '../lib/note-sort.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';
import { Select } from './Select.js';

/** The arrangement switch: the three lane sizes, stack and graph. */
export const compilationViewTabs = [{ value: 'thumbnail', icon: LayoutGrid }, { value: 'small', icon: Columns3 }, { value: 'medium', icon: Columns2 }, { value: 'stack', icon: Rows3 }, { value: 'graph', icon: Network }] as const;

export interface CompilationHeaderProps {
  row: CompilationRow;
  count: number;
  disabled: boolean;
  readOnly?: boolean;
  notebooks: NotebookConfig[];
  facets?: Record<string, NotebookFacets>;
  onAddToFocus?: () => void;
  onStudy?: () => void;
  onView?: (view: CompilationRow['view']) => void;
  onAdd?: () => void;
  onSort?: (sort: SortConfig) => void;
  onStudyChange?: (study: NonNullable<CompilationRow['study']>) => void;
  /** Adds a note to a dynamic compilation's source. */
  onCreateInSource?: () => void;
  /** Scrolls a lane's strip; absent for arrangements that do not scroll sideways. */
  onScroll?: (direction: number) => void;
  /** View-level actions that follow the others, such as edit, copy and delete. */
  extra?: ReactNode;
}

/** The compilation's name, source and the controls shared by its arrangements. */
export function CompilationHeader({ row, count, disabled, readOnly, notebooks, facets, onAddToFocus, onStudy, onView, onAdd, onSort, onStudyChange, onCreateInSource, onScroll, extra }: CompilationHeaderProps) {
  const { t } = useTranslation();
  const [queryOpen, setQueryOpen] = useState(false);
  const query = row.study || { filter: 'all' as const, dueFirst: false };
  const filtered = Boolean(query.status);
  const statuses = noteQueryStatuses(notebooks, row.notebookId, Object.keys(facets?.[row.notebookId]?.statuses || {}));
  const source = row.kind === 'dynamic' ? row.source.kind === 'tag' ? `#${row.source.tag}` : row.source.path : '';
  return (
    <header className='screen-lane-header'>
      <div className='screen-lane-heading'>
        <h3>{row.name}</h3>
        <span className='screen-count'>{count}</span>
        {row.kind === 'dynamic' && (
          <span className='screen-dynamic-label' title={t('screen.dynamicHint')}>
            <Zap size={12} />
            {t('screen.dynamic')}
            {' · '}
            {source}
          </span>
        )}
      </div>
      <div className='screen-lane-actions'>
        {!readOnly && (
          <Button
            type='button'
            size='icon'
            className={`screen-lane-query-toggle ${filtered ? 'is-active' : ''}`}
            aria-label={`${t('screen.filtersAndSort')}: ${row.name}`}
            title={t('screen.filtersAndSort')}
            aria-expanded={queryOpen}
            aria-controls={`screen-query-${row.id}`}
            onClick={() => setQueryOpen(open => !open)}
          >
            <SlidersHorizontal size={18} />
          </Button>
        )}
        {!readOnly && (
          <div id={`screen-query-${row.id}`} className='screen-lane-query' data-open={queryOpen}>
            <label className='screen-lane-filter'>
              {t('study.status')}
              <select className='ui-control' disabled={disabled} value={query.status || ''} onChange={event => onStudyChange?.({ ...query, status: event.target.value || undefined })}>
                <option value=''>{t('study.filter.all')}</option>
                {statuses.map(status => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
            {row.kind === 'dynamic' && (
              <label className='screen-lane-sort'>
                <span>{t('sort.select')}</span>
                <Select
                  className='screen-sort-select'
                  aria-label={`${t('sort.select')}: ${row.name}`}
                  disabled={disabled}
                  value={`${row.sort?.field || 'title'}:${row.sort?.order || 'asc'}`}
                  onValueChange={value => {
                    const [field, order] = value.split(':') as [SortConfig['field'], SortConfig['order']];
                    onSort?.({ field, order });
                  }}
                  options={([['updated:desc', 'sort.updatedDesc'], ['updated:asc', 'sort.updatedAsc'], ['created:desc', 'sort.createdDesc'], ['created:asc', 'sort.createdAsc'], ['title:asc', 'sort.titleAsc'], ['title:desc', 'sort.titleDesc'], ['status:asc', 'sort.status']] as const).map(([value, label]) => ({ value, label: t(label) }))}
                />
              </label>
            )}
          </div>
        )}
        {!readOnly && <Select className='screen-view-select' aria-label={`${t('screen.view')}: ${row.name}`} value={row.view} disabled={disabled} onValueChange={value => onView?.(value as CompilationRow['view'])} options={(['thumbnail', 'small', 'medium', 'stack', 'graph'] as const).map(value => ({ value, label: t(`screen.${value}`) }))} />}
        {!readOnly && (
          <div className='screen-view-tabs' role='group' aria-label={`${t('screen.view')}: ${row.name}`}>
            {compilationViewTabs.map(({ value, icon: Icon }) => (
              <Button
                key={value}
                type='button'
                disabled={disabled}
                size='icon'
                title={t(`screen.${value}`)}
                aria-label={t(`screen.${value}`)}
                aria-pressed={row.view === value}
                onClick={() => onView?.(value)}
              >
                <Icon size={16} />
              </Button>
            ))}
          </div>
        )}
        {!readOnly && (
          <Button type='button' size='icon' className='screen-start-study' aria-label={`${t('study.start')}: ${row.name}`} title={t('study.start')} onClick={onStudy}>
            <Brain size={18} />
          </Button>
        )}
        {!readOnly && onAddToFocus && (
          <Button type='button' size='icon' className='screen-add-to-focus' aria-label={`${t('focus.addTo')}: ${row.name}`} title={t('focus.addTo')} onClick={onAddToFocus}>
            <LayoutGrid size={18} />
          </Button>
        )}
        {!readOnly && (row.kind === 'custom'
          ? (
            <Button type='button' size='icon' disabled={disabled} onClick={onAdd} aria-label={`${t('screen.addItem')}: ${row.name}`}>
              <Plus size={16} />
            </Button>
          )
          : (
            <Button type='button' size='icon' disabled={disabled} onClick={onCreateInSource} aria-label={`${t('screen.createNoteInLane')}: ${row.name}`} title={t('screen.createNoteInLane')}>
              <Plus size={16} />
            </Button>
          ))}
        {onScroll && (
          <>
            <Button type='button' size='icon' className='screen-lane-scroll' aria-label={`${t('screen.scrollLeft')}: ${row.name}`} onClick={() => onScroll(-1)}>
              <ChevronLeft size={16} />
            </Button>
            <Button type='button' size='icon' className='screen-lane-scroll' aria-label={`${t('screen.scrollRight')}: ${row.name}`} onClick={() => onScroll(1)}>
              <ChevronRight size={16} />
            </Button>
          </>
        )}
        {extra}
      </div>
    </header>
  );
}
