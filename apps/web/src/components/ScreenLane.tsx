import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, GripVertical, X, Zap, ChevronLeft, ChevronRight, LayoutGrid, Columns3, Columns2, SlidersHorizontal, Brain, Network } from 'lucide-react';
import type { ScreenItem, ScreenRow } from '@mygitnotes/core/screen-page';
import { noteQueryStatuses, type NotebookFacets } from '@mygitnotes/core/note-query';
import type { NotebookConfig } from '../lib/types.js';
import { useLaneNotes } from '../lib/screen-queries.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { screenRowItems, studyRowItems } from '../lib/screen-content.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';
import { ScreenCard, screenItemTitle, type ScreenContentProps } from './ScreenCard.js';
import { NoteListSentinel } from './NoteListSentinel.js';
import { Select } from './Select.js';
import type { SortConfig } from '../lib/note-sort.js';
import { useAltWheelHorizontalScroll } from '../lib/use-alt-wheel-horizontal-scroll.js';

export const screenViewTabs = [
  { value: 'thumbnail', icon: LayoutGrid },
  { value: 'small', icon: Columns3 },
  { value: 'medium', icon: Columns2 },
  { value: 'graph', icon: Network },
] as const;

export function createLaneNoteContext(
  row: ScreenRow,
  notebooks: NotebookConfig[]
): { notebookId?: string; folder?: string; tag?: string } | null {
  if (row.kind !== 'dynamic') return null;
  if (row.source.kind === 'tag') {
    return { tag: row.source.tag, notebookId: row.source.notebookId };
  }
  if (row.source.kind === 'folder') {
    const nb = notebooks.find(n => n.id === row.source.notebookId);
    const root = nb?.root || '';
    const relativeFolder = row.source.path === root || !row.source.path.startsWith(`${root}/`)
      ? ''
      : row.source.path.slice(root.length + 1);
    return { notebookId: row.source.notebookId, folder: relativeFolder };
  }
  return null;
}

export function MovableCard({ item, row, reorder, disabled, remove, ...content }: ScreenContentProps & {
  item: ScreenItem; row: ScreenRow; reorder: boolean; disabled: boolean; remove: () => void;
}) {
  const { t } = useTranslation();
  const sort = useSortable({ id: item.id, disabled: disabled || !reorder, data: { rowId: row.id } });
  return <div ref={sort.setNodeRef} className="screen-card-slot" style={{ transform: CSS.Transform.toString(sort.transform), transition: sort.transition, opacity: sort.isDragging ? .3 : undefined }}>
    <ScreenCard {...content} item={item} view={row.view} controls={!disabled && <>
      {reorder && <Button type="button" ref={sort.setActivatorNodeRef} {...sort.attributes} {...sort.listeners} size="icon" className="screen-drag-handle" aria-label={`${t('screen.moveItem')}: ${screenItemTitle(item, content.notes, content.assets)}`}><GripVertical size={14} /></Button>}
      <Button type="button" size="icon" className="screen-remove" aria-label={`${t('screen.unpin')}: ${screenItemTitle(item, content.notes, content.assets)}`} onClick={remove}><X size={12} /></Button>
    </>} />
  </div>;
}

export function ScreenLane({ row, graph, reorder, disabled, study, facets, notebooks, assets, onOpen, onStudy, onStudyChange, onView, onSort, onAdd, onRemove, onCreateNote, readOnly, onAddToFocus }: Omit<ScreenContentProps, 'notes'> & {
  graph?: ReactNode;
  facets?: Record<string, NotebookFacets>;
  row: ScreenRow; reorder: boolean; disabled: boolean; study: StudyController;
  readOnly?: boolean; onAddToFocus?: () => void;
  onStudy?: () => void; onView?: (view: ScreenRow['view']) => void; onAdd?: () => void; onRemove?: (id: string) => void;
  onSort?: (sort: SortConfig) => void; onStudyChange?: (study: NonNullable<ScreenRow['study']>) => void;
  onCreateNote?: (context?: { notebookId?: string; folder?: string; tag?: string }) => void;
}) {
  const { t } = useTranslation(); const host = useRef<HTMLElement>(null), strip = useRef<HTMLDivElement>(null);
  const [queryOpen, setQueryOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 30000); return () => clearInterval(timer); }, []);
  // Cards show a body, so the lane's page is read with content; a graph lane needs none.
  const laneNotes = useLaneNotes(row, { content: row.view !== 'graph' });
  const content: ScreenContentProps = { notebooks, assets, onOpen, notes: laneNotes.notes };
  const ordinaryRow = { ...row, study: { ...(row.study || {}), filter: 'all' as const, dueFirst: false } };
  const items = studyRowItems(screenRowItems(row, content.notes, content.assets, content.notebooks), ordinaryRow, content.notes, study.study, clock);
  const query = row.study || { filter: 'all' as const, dueFirst: false };
  const filtered = Boolean(query.status);
  const drop = useDroppable({ id: `lane:${row.id}`, disabled: readOnly || disabled || !reorder || filtered || row.kind !== 'custom', data: { rowId: row.id, empty: row.kind === 'custom' && !row.items.length } });
  const statuses = noteQueryStatuses(content.notebooks, row.notebookId, Object.keys(facets?.[row.notebookId]?.statuses || {}));
  useAltWheelHorizontalScroll(host, strip);
  const scroll = (direction: number) => strip.current?.scrollBy({ left: direction * strip.current.clientWidth * .8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  const source = row.kind === 'dynamic' ? row.source.kind === 'tag' ? `#${row.source.tag}` : row.source.path : '';
  const handleCreateInLane = () => {
    const context = createLaneNoteContext(row, content.notebooks);
    if (context) onCreateNote?.(context);
  };
  return <section id={`screen-lane-${row.id}`} ref={host} className={`screen-lane screen-view-${row.view} ${row.kind === 'dynamic' ? 'screen-lane-dynamic' : ''}`} aria-label={row.name}>
    <header className="screen-lane-header"><div className="screen-lane-heading"><h3>{row.name}</h3><span className="screen-count">{items.length}</span>
      {row.kind === 'dynamic' && <span className="screen-dynamic-label" title={t('screen.dynamicHint')}><Zap size={12} />{t('screen.dynamic')} · {source}</span>}</div>
      <div className="screen-lane-actions">
        {!readOnly && <Button type="button" size="icon" className={`screen-lane-query-toggle ${filtered ? 'is-active' : ''}`}
          aria-label={`${t('screen.filtersAndSort')}: ${row.name}`} title={t('screen.filtersAndSort')}
          aria-expanded={queryOpen} aria-controls={`screen-query-${row.id}`} onClick={() => setQueryOpen(open => !open)}><SlidersHorizontal size={18} /></Button>}
        {!readOnly && <div id={`screen-query-${row.id}`} className="screen-lane-query" data-open={queryOpen}>
          <label className="screen-lane-filter">{t('study.status')}<select className="ui-control" disabled={disabled} value={query.status || ''} onChange={event => onStudyChange?.({ ...query, status: event.target.value || undefined })}>
            <option value="">{t('study.filter.all')}</option>{statuses.map(status => <option key={status} value={status}>{status}</option>)}
          </select></label>
          {row.kind === 'dynamic' && <label className="screen-lane-sort"><span>{t('sort.select')}</span><Select className="screen-sort-select" aria-label={`${t('sort.select')}: ${row.name}`} disabled={disabled}
            value={`${row.sort?.field || 'title'}:${row.sort?.order || 'asc'}`}
            onValueChange={value => {
              const [field, order] = value.split(':') as [SortConfig['field'], SortConfig['order']]; onSort?.({ field, order });
            }}
            options={([
              ['updated:desc','sort.updatedDesc'], ['updated:asc','sort.updatedAsc'],
              ['created:desc','sort.createdDesc'], ['created:asc','sort.createdAsc'],
              ['title:asc','sort.titleAsc'], ['title:desc','sort.titleDesc'], ['status:asc','sort.status'],
            ] as const).map(([value,label]) => ({value,label:t(label)}))} /></label>}
        </div>}
        {!readOnly && <Select className="screen-view-select" aria-label={`${t('screen.view')}: ${row.name}`} value={row.view} disabled={disabled} onValueChange={value => onView?.(value as ScreenRow['view'])}
          options={(['thumbnail', 'small', 'medium', 'graph'] as const).map(value => ({ value, label: t(`screen.${value}`) }))} />}
        {!readOnly && <div className="screen-view-tabs" role="group" aria-label={`${t('screen.view')}: ${row.name}`}>
        {screenViewTabs.map(({value,icon:Icon}) => <Button key={value} type="button" disabled={disabled} size="icon" title={t(`screen.${value}`)} aria-label={t(`screen.${value}`)} aria-pressed={row.view === value} onClick={() => onView?.(value)}><Icon size={16} /></Button>)}
      </div>}
        {!readOnly && <Button type="button" size="icon" className="screen-start-study" aria-label={`${t('study.start')}: ${row.name}`} title={t('study.start')} onClick={onStudy}><Brain size={18} /></Button>}
        {!readOnly && onAddToFocus && <Button type="button" size="icon" className="screen-add-to-focus" aria-label={`${t('focus.addTo')}: ${row.name}`} title={t('focus.addTo')} onClick={onAddToFocus}><LayoutGrid size={18} /></Button>}
        {!readOnly && (row.kind === 'custom' ? (
          <Button type="button" size="icon" disabled={disabled} onClick={onAdd} aria-label={`${t('screen.addItem')}: ${row.name}`}><Plus size={16} /></Button>
        ) : (
          <Button type="button" size="icon" disabled={disabled} onClick={handleCreateInLane} aria-label={`${t('screen.createNoteInLane')}: ${row.name}`} title={t('screen.createNoteInLane')}><Plus size={16} /></Button>
        ))}
        <Button type="button" size="icon" className="screen-lane-scroll" aria-label={`${t('screen.scrollLeft')}: ${row.name}`} onClick={() => scroll(-1)}><ChevronLeft size={16} /></Button>
        <Button type="button" size="icon" className="screen-lane-scroll" aria-label={`${t('screen.scrollRight')}: ${row.name}`} onClick={() => scroll(1)}><ChevronRight size={16} /></Button>
      </div>
    </header>
    {row.view === 'graph' ? graph : <div ref={readOnly ? undefined : drop.setNodeRef} className={!readOnly && drop.isOver ? 'screen-drop-target' : ''}>
      <div ref={strip} className="screen-lane-strip" tabIndex={0} aria-label={`${row.name} · ${t('screen.items')}`}>
        {!readOnly && row.kind === 'custom' ? <SortableContext items={items.map(item => item.id)} strategy={horizontalListSortingStrategy}>
          {items.map(item => <MovableCard reorder={reorder} key={item.id} {...content} item={item} row={row} disabled={disabled || filtered} remove={() => onRemove?.(item.id)} />)}
        </SortableContext> : items.map(item => <div className="screen-card-slot" key={item.id}><ScreenCard {...content} item={item} view={row.view} /></div>)}
        {laneNotes.error && <p role="alert" className="screen-error">{laneNotes.error}</p>}
        {laneNotes.loading && <p role="status" className="screen-lane-empty">{t('notes.loading')}</p>}
        <NoteListSentinel hasMore={laneNotes.hasMore} loading={laneNotes.loadingMore} error={laneNotes.error} onLoadMore={laneNotes.loadMore} className="screen-lane-sentinel" />
        {!items.length && !laneNotes.loading && <div className="screen-lane-empty">{t(row.kind === 'custom' ? 'screen.emptyCustom' : 'screen.emptyDynamic')}
          {!readOnly && !disabled && <Button onClick={row.kind === 'custom' ? onAdd : handleCreateInLane}><Plus size={14} />{t(row.kind === 'custom' ? 'screen.addItem' : 'screen.createNoteInLane')}</Button>}</div>}
      </div>
    </div>}
  </section>;
}
