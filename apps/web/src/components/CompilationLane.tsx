import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, X } from 'lucide-react';
import type { CompilationItem, CompilationRow } from '@mygitnotes/core/compilation';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import type { NotebookConfig } from '../lib/types.js';
import { useLaneNotes } from '../lib/compilation-queries.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { compilationRowItems, studyRowItems } from '../lib/compilation-content.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';
import { CompilationHeader } from './CompilationHeader.js';
import { CompilationCard, type CompilationContentProps, compilationItemTitle } from './CompilationCard.js';
import { NoteListSentinel } from './NoteListSentinel.js';
import type { SortConfig } from '../lib/note-sort.js';
import { useAltWheelHorizontalScroll } from '../lib/use-alt-wheel-horizontal-scroll.js';
import { LoadingStatus } from './LoadingStatus.js';

export { compilationViewTabs } from './CompilationHeader.js';

export function createLaneNoteContext(row: CompilationRow, notebooks: NotebookConfig[]): { notebookId?: string; folder?: string; tag?: string; } | null {
  if (row.kind !== 'dynamic') return null;
  if (row.source.kind === 'tag') {
    return { tag: row.source.tag, notebookId: row.source.notebookId };
  }
  if (row.source.kind === 'folder') {
    const nb = notebooks.find(n => n.id === row.source.notebookId);
    const root = nb?.root || '';
    const relativeFolder = row.source.path === root || !row.source.path.startsWith(`${root}/`) ? '' : row.source.path.slice(root.length + 1);
    return { notebookId: row.source.notebookId, folder: relativeFolder };
  }
  return null;
}

export function MovableCard({ item, row, reorder, disabled, remove, ...content }: CompilationContentProps & { item: CompilationItem; row: CompilationRow; reorder: boolean; disabled: boolean; remove: () => void; }) {
  const { t } = useTranslation();
  const sort = useSortable({ id: item.id, disabled: disabled || !reorder, data: { rowId: row.id } });
  /* eslint-disable react/refs -- dnd-kit sortable bindings are callback refs and render state, forwarded to the card and drag handle. */
  return (
    <div ref={sort.setNodeRef} className='screen-card-slot' style={{ transform: CSS.Transform.toString(sort.transform), transition: sort.transition, opacity: sort.isDragging ? .3 : undefined }}>
      <CompilationCard
        {...content}
        item={item}
        view={row.view}
        controls={!disabled && (
          <>
            {reorder && (
              <Button type='button' ref={sort.setActivatorNodeRef} {...sort.attributes} {...sort.listeners} size='icon' className='screen-drag-handle' aria-label={`${t('screen.moveItem')}: ${compilationItemTitle(item, content.notes, content.assets)}`}>
                <GripVertical size={14} />
              </Button>
            )}
            <Button type='button' size='icon' className='screen-remove' aria-label={`${t('screen.unpin')}: ${compilationItemTitle(item, content.notes, content.assets)}`} onClick={remove}>
              <X size={12} />
            </Button>
          </>
        )}
      />
    </div>
  );
  /* eslint-enable react/refs */
}

export function CompilationLane({ row, graph, reorder, disabled, study, facets, notebooks, assets, onOpen, onStudy, onStudyChange, onView, onSort, onAdd, onRemove, onCreateNote, readOnly, onAddToFocus, extra }: Omit<CompilationContentProps, 'notes'> & { graph?: ReactNode; extra?: ReactNode; facets?: Record<string, NotebookFacets>; row: CompilationRow; reorder: boolean; disabled: boolean; study: StudyController; readOnly?: boolean; onAddToFocus?: () => void; onStudy?: () => void; onView?: (view: CompilationRow['view']) => void; onAdd?: () => void; onRemove?: (id: string) => void; onSort?: (sort: SortConfig) => void; onStudyChange?: (study: NonNullable<CompilationRow['study']>) => void; onCreateNote?: (context?: { notebookId?: string; folder?: string; tag?: string; }) => void; }) {
  const { t } = useTranslation();
  const host = useRef<HTMLElement>(null), strip = useRef<HTMLDivElement>(null);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  // Cards show a body, so the lane's page is read with content; a graph lane needs none.
  const laneNotes = useLaneNotes(row, { content: row.view !== 'graph' });
  const content: CompilationContentProps = { notebooks, assets, onOpen, notes: laneNotes.notes };
  const ordinaryRow = { ...row, study: { ...row.study, filter: 'all' as const, dueFirst: false } };
  const items = studyRowItems(compilationRowItems(row, content.notes, content.assets, content.notebooks), ordinaryRow, content.notes, study.study, clock);
  const filtered = Boolean(row.study?.status);
  const drop = useDroppable({ id: `lane:${row.id}`, disabled: readOnly || disabled || !reorder || filtered || row.kind !== 'custom', data: { rowId: row.id, empty: row.kind === 'custom' && !row.items.length } });
  useAltWheelHorizontalScroll(host, strip);
  const scroll = (direction: number) => strip.current?.scrollBy({ left: direction * strip.current.clientWidth * .8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  const handleCreateInLane = () => {
    const context = createLaneNoteContext(row, content.notebooks);
    if (context) onCreateNote?.(context);
  };
  return (
    <section id={`screen-lane-${row.id}`} ref={host} className={`screen-lane screen-view-${row.view} ${row.kind === 'dynamic' ? 'screen-lane-dynamic' : ''}`} aria-label={row.name}>
      <CompilationHeader row={row} count={items.length} disabled={disabled} readOnly={readOnly} notebooks={content.notebooks} facets={facets} extra={extra} onAddToFocus={onAddToFocus} onStudy={onStudy} onView={onView} onAdd={onAdd} onSort={onSort} onStudyChange={onStudyChange} onCreateInSource={handleCreateInLane} onScroll={row.view === 'graph' ? undefined : scroll} />
      {row.view === 'graph' ? graph : (
        <div ref={readOnly ? undefined : drop.setNodeRef} className={!readOnly && drop.isOver ? 'screen-drop-target' : ''}>
          <div ref={strip} className='screen-lane-strip' tabIndex={0} aria-label={`${row.name} · ${t('screen.items')}`}>
            {!readOnly && row.kind === 'custom' ? <SortableContext items={items.map(item => item.id)} strategy={horizontalListSortingStrategy}>{items.map(item => <MovableCard reorder={reorder} key={item.id} {...content} item={item} row={row} disabled={disabled || filtered} remove={() => onRemove?.(item.id)} />)}</SortableContext> : items.map(item => (
              <div className='screen-card-slot' key={item.id}>
                <CompilationCard {...content} item={item} view={row.view} />
              </div>
            ))}
            {laneNotes.error && <p role='alert' className='screen-error'>{laneNotes.error}</p>}
            {laneNotes.loading && <LoadingStatus className='screen-lane-empty'>{t('notes.loading')}</LoadingStatus>}
            <NoteListSentinel hasMore={laneNotes.hasMore} loading={laneNotes.loadingMore} error={laneNotes.error} onLoadMore={laneNotes.loadMore} className='screen-lane-sentinel' />
            {!items.length && !laneNotes.loading && (
              <div className='screen-lane-empty'>
                {t(row.kind === 'custom' ? 'screen.emptyCustom' : 'screen.emptyDynamic')}
                {!readOnly && !disabled && (
                  <Button onClick={row.kind === 'custom' ? onAdd : handleCreateInLane}>
                    <Plus size={14} />
                    {t(row.kind === 'custom' ? 'screen.addItem' : 'screen.createNoteInLane')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
