import { ReorderToggle } from './ReorderToggle.js';
import { lazy } from 'react';
const GraphPage = lazy(() => import('./GraphPage.js').then(module => ({ default: module.GraphPage })));
import type { GraphEditing } from '../lib/use-graph-editing.js';
import type { ReactNode } from 'react';
import { Button } from './Button.js';
import './study.css';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { stringify } from 'yaml';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, GripVertical, X, Zap, ChevronLeft, ChevronRight, LayoutGrid, Columns3, Columns2, SlidersHorizontal, Brain, ArrowLeft, Pencil, Network } from 'lucide-react';
import { moveScreenItem, type ScreenItem, type ScreenRow } from '@mygitnotes/core/screen-page';
import type { NoteItem, NotebookConfig, FolderItem } from '../lib/types.js';
import { fetchAssets } from '../lib/api.js';
import { notebookRoute, screenLaneRoute } from '../lib/routes.js';
import { useStudyWorkspace, type StudyController } from '../lib/use-study-workspace.js';
import { StudyLane } from './StudyLane.js';
import { defaultStudyProgression, studyLaneStatuses } from '@mygitnotes/core/study-stages';
import { resolveNoteStatuses } from '@mygitnotes/core/note-status';
import { screenRowItems, studyRowItems } from '../lib/screen-content.js';
import type { ScreenController } from '../lib/use-screen-page.js';
import { ScreenIcon } from './ScreenIcon.js';
import { screenCollision, screenKeyboardCoordinates } from '../lib/screen-drag.js';
import { useTranslation } from '../lib/i18n/index.js';
import { ScreenCard, screenItemTitle, type ScreenContentProps, type ScreenAsset } from './ScreenCard.js';
import { ScreenAddRow, ScreenAddItem, ScreenEditRow } from './ScreenDialogs.js';
import { ScreenLaneNavigation } from './ScreenLaneNavigation.js';
import { WorkspaceSidebar, WorkspaceSidebarDrawer, WorkspaceSidebarToggle, useWorkspaceSidebarDrawer } from './WorkspaceChrome.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { Select } from './Select.js';
import type { SortConfig } from '../lib/note-sort.js';
import { useAltWheelHorizontalScroll } from '../lib/use-alt-wheel-horizontal-scroll.js';

export const screenViewTabs = [
  { value: 'thumbnail', icon: LayoutGrid },
  { value: 'small', icon: Columns3 },
  { value: 'medium', icon: Columns2 },
  { value: 'graph', icon: Network },
] as const;

function MovableCard({ item, row, reorder, disabled, remove, ...content }: ScreenContentProps & {
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

function Lane({ row, graph, reorder, disabled, study, onStudy, onStudyChange, onView, onSort, onAdd, onRemove, onCreateNote, ...content }: ScreenContentProps & {
  graph?: ReactNode;
  row: ScreenRow; reorder: boolean; disabled: boolean; onStudy: () => void; onView: (view: ScreenRow['view']) => void; onAdd: () => void; onRemove: (id: string) => void;
  onSort: (sort: SortConfig) => void; study: StudyController; onStudyChange: (study: NonNullable<ScreenRow['study']>) => void;
  onCreateNote?: (context?: { notebookId?: string; folder?: string; tag?: string }) => void;
}) {
  const { t } = useTranslation(); const host = useRef<HTMLElement>(null), strip = useRef<HTMLDivElement>(null);
  const [queryOpen, setQueryOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 30000); return () => clearInterval(timer); }, []);
  const ordinaryRow = { ...row, study: { ...(row.study || {}), filter: 'all' as const, dueFirst: false } };
  const items = studyRowItems(screenRowItems(row, content.notes, content.assets, content.notebooks), ordinaryRow, content.notes, study.study, clock);
  const query = row.study || { filter: 'all' as const, dueFirst: false };
  const filtered = Boolean(query.status);
  const drop = useDroppable({ id: `lane:${row.id}`, disabled: disabled || !reorder || filtered || row.kind !== 'custom', data: { rowId: row.id, empty: row.kind === 'custom' && !row.items.length } });
  const statuses = [...new Set(content.notebooks.filter(notebook => notebook.id === row.notebookId).flatMap(notebook => resolveNoteStatuses(notebook, content.notes.filter(note => note.notebookId === notebook.id).map(note => note.status))))];
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
        <Button type="button" size="icon" className={`screen-lane-query-toggle ${filtered ? 'is-active' : ''}`}
          aria-label={`${t('screen.filtersAndSort')}: ${row.name}`} title={t('screen.filtersAndSort')}
          aria-expanded={queryOpen} aria-controls={`screen-query-${row.id}`} onClick={() => setQueryOpen(open => !open)}><SlidersHorizontal size={18} /></Button>
        <div id={`screen-query-${row.id}`} className="screen-lane-query" data-open={queryOpen}>
          <label className="screen-lane-filter">{t('study.status')}<select className="ui-control" disabled={disabled} value={query.status || ''} onChange={event => onStudyChange({ ...query, status: event.target.value || undefined })}>
            <option value="">{t('study.filter.all')}</option>{statuses.map(status => <option key={status} value={status}>{status}</option>)}
          </select></label>
          {row.kind === 'dynamic' && <label className="screen-lane-sort"><span>{t('sort.select')}</span><Select className="screen-sort-select" aria-label={`${t('sort.select')}: ${row.name}`} disabled={disabled}
            value={`${row.sort?.field || 'title'}:${row.sort?.order || 'asc'}`}
            onValueChange={value => {
              const [field, order] = value.split(':') as [SortConfig['field'], SortConfig['order']]; onSort({ field, order });
            }}
            options={([
              ['updated:desc','sort.updatedDesc'], ['updated:asc','sort.updatedAsc'],
              ['created:desc','sort.createdDesc'], ['created:asc','sort.createdAsc'],
              ['title:asc','sort.titleAsc'], ['title:desc','sort.titleDesc'], ['status:asc','sort.status'],
            ] as const).map(([value,label]) => ({value,label:t(label)}))} /></label>}
        </div>
        <Select className="screen-view-select" aria-label={`${t('screen.view')}: ${row.name}`} value={row.view} disabled={disabled} onValueChange={value => onView(value as ScreenRow['view'])}
          options={(['thumbnail', 'small', 'medium', 'graph'] as const).map(value => ({ value, label: t(`screen.${value}`) }))} />
        <div className="screen-view-tabs" role="group" aria-label={`${t('screen.view')}: ${row.name}`}>
        {screenViewTabs.map(({value,icon:Icon}) => <Button key={value} type="button" disabled={disabled} size="icon" title={t(`screen.${value}`)} aria-label={t(`screen.${value}`)} aria-pressed={row.view === value} onClick={() => onView(value)}><Icon size={16} /></Button>)}
      </div>
        <Button type="button" size="icon" className="screen-start-study" aria-label={`${t('study.start')}: ${row.name}`} title={t('study.start')} onClick={onStudy}><Brain size={18} /></Button>
        {row.kind === 'custom' ? (
          <Button type="button" size="icon" disabled={disabled} onClick={onAdd} aria-label={`${t('screen.addItem')}: ${row.name}`}><Plus size={16} /></Button>
        ) : (
          <Button type="button" size="icon" disabled={disabled} onClick={handleCreateInLane} aria-label={`${t('screen.createNoteInLane')}: ${row.name}`} title={t('screen.createNoteInLane')}><Plus size={16} /></Button>
        )}
        <Button type="button" size="icon" className="screen-lane-scroll" aria-label={`${t('screen.scrollLeft')}: ${row.name}`} onClick={() => scroll(-1)}><ChevronLeft size={16} /></Button>
        <Button type="button" size="icon" className="screen-lane-scroll" aria-label={`${t('screen.scrollRight')}: ${row.name}`} onClick={() => scroll(1)}><ChevronRight size={16} /></Button>
      </div>
    </header>
    {row.view === 'graph' ? graph : <div ref={drop.setNodeRef} className={drop.isOver ? 'screen-drop-target' : ''}>
      <div ref={strip} className="screen-lane-strip" tabIndex={0} aria-label={`${row.name} · ${t('screen.items')}`}>
        {row.kind === 'custom' ? <SortableContext items={items.map(item => item.id)} strategy={horizontalListSortingStrategy}>
          {items.map(item => <MovableCard reorder={reorder} key={item.id} {...content} item={item} row={row} disabled={disabled || filtered} remove={() => onRemove(item.id)} />)}
        </SortableContext> : items.map(item => <div className="screen-card-slot" key={item.id}><ScreenCard {...content} item={item} view={row.view} /></div>)}
        {!items.length && <div className="screen-lane-empty">{t(row.kind === 'custom' ? 'screen.emptyCustom' : 'screen.emptyDynamic')}
          {!disabled && <Button onClick={row.kind === 'custom' ? onAdd : handleCreateInLane}><Plus size={14} />{t(row.kind === 'custom' ? 'screen.addItem' : 'screen.createNoteInLane')}</Button>}</div>}
      </div>
    </div>}
  </section>;
}

export function ScreenPage({ notebooks, notes, folders, selectedNotebookId, screen, editing: graphEditing, onOpenNote, onStudySaved, focusedLaneId, onCreateNote }: {
  editing?: GraphEditing;
  notebooks: NotebookConfig[]; notes: NoteItem[]; folders: FolderItem[]; selectedNotebookId: string; screen: ScreenController;
  focusedLaneId?: string | null; onOpenNote: (note: NoteItem) => void; onStudySaved: (note?: NoteItem) => void;
  onCreateNote?: (context?: { notebookId?: string; folder?: string; tag?: string }) => void;
}) {
  const { t } = useTranslation(); const navigate = useNavigate(); const location = useLocation();
  const sidebar = useWorkspaceSidebarDrawer();
  const [reorder, setReorder] = useState(false);
  useEffect(() => { setReorder(false); }, [selectedNotebookId, focusedLaneId]);
  const study = useStudyWorkspace(onStudySaved);
  const [assets, setAssets] = useState<ScreenAsset[]>([]), [assetError, setAssetError] = useState(false);
  const [assetAttempt, setAssetAttempt] = useState(0), [assetsLoading, setAssetsLoading] = useState(false);
  const [studyToolbar, setStudyToolbar] = useState<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<string>();
  const rows = screen.page.rows.filter(row => row.notebookId === selectedNotebookId);
  const focusedRow = rows.find(row => row.id === focusedLaneId);
  const laneNotebookId = screen.page.rows.find(row => row.id === focusedLaneId)?.notebookId;
  const switchingLane = Boolean(laneNotebookId && laneNotebookId !== selectedNotebookId && notebooks.some(notebook => notebook.id === laneNotebookId));
  useEffect(() => {
    if (!switchingLane || !laneNotebookId) return;
    const query = new URLSearchParams(location.search); query.set('notebook', laneNotebookId);
    navigate(`${location.pathname}?${query}${location.hash}`, { replace: true });
  }, [switchingLane, laneNotebookId, location.pathname, location.search, location.hash, navigate]);
  const editingRow = screen.page.rows.find(row => row.id === editing);
  const returnToScreen = () => { const query = new URLSearchParams(location.search); query.delete('mode'); query.delete('studyFilter'); navigate(`/screen${query.size ? '?' + query.toString() : ''}#screen-lane-${focusedLaneId}`); };
  const reviewRow = focusedRow && { ...focusedRow, progression: focusedRow.progression || defaultStudyProgression(studyLaneStatuses(focusedRow, notebooks)), study: { ...(focusedRow.study || {}), filter: focusedRow.study?.filter || 'all', dueFirst: true } };
  const reviewItems = reviewRow ? studyRowItems(screenRowItems(reviewRow, notes, [], notebooks), reviewRow, notes, study.study) : [];
  const reviewNotes = reviewItems.flatMap(item => item.kind === 'note' ? notes.filter(note => note.notebookId === item.notebookId && note.path === item.path) : []);
  useEffect(() => {
    if (!focusedLaneId && location.hash.startsWith('#screen-lane-')) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [focusedLaneId, location.hash, screen.loading]);
  const [dialog, setDialog] = useState<'add' | 'reload' | null>(null), [addTo, setAddTo] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScreenAsset>(), [dragging, setDragging] = useState<ScreenItem>();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: screenKeyboardCoordinates }));
  useEffect(() => {
    if (focusedLaneId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '[' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], .cm-content')) return;
        event.preventDefault();
        sidebar.setOpen(open => !open);
      }
    };
    const onToggle = () => sidebar.setOpen(open => !open);
    window.addEventListener('keydown', onKey);
    window.addEventListener('toggle-screen-sidebar', onToggle);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('toggle-screen-sidebar', onToggle);
    };
  }, [focusedLaneId, sidebar.setOpen]);
  useEffect(() => {
    let active = true; setAssetsLoading(true);
    const scoped = notebooks.filter(nb => nb.id === selectedNotebookId);
    void Promise.allSettled(scoped.map(async nb => (await fetchAssets(nb.id)).map(asset => ({ ...asset, notebookId: nb.id })))).then(results => {
      if (!active) return;
      setAssets(previous => results.flatMap((result,index) => result.status === 'fulfilled' ? result.value : previous.filter(asset => asset.notebookId === scoped[index].id)));
      setAssetError(results.some(result => result.status === 'rejected')); setAssetsLoading(false);
    });
    return () => { active = false; };
  }, [notebooks, notes, selectedNotebookId, assetAttempt]);
  const disabled = !screen.writable || screen.loading;
  const content: ScreenContentProps = { notebooks, notes, assets, onOpen: item => {
    if (item.kind === 'youtube') { window.open(`https://www.youtube.com/watch?v=${item.videoId}&t=${item.start}`, '_blank', 'noopener,noreferrer'); return; }
    const nb = notebooks.find(nb => nb.id === item.notebookId);
    if (!nb) { screen.setError(t('screen.missing')); return; }
    if (item.kind === 'note') {
      const note = notes.find(note => note.notebookId === item.notebookId && note.path === item.path);
      if (note) onOpenNote(note); else screen.setError(t('screen.missing'));
    } else if (item.kind === 'folder') {
      const assetRoot = `${nb.root}/${nb.assets || 'assets'}`;
      navigate(item.path === assetRoot || item.path.startsWith(`${assetRoot}/`)
        ? `/assets?notebook=${encodeURIComponent(nb.id)}&directory=${encodeURIComponent(item.path.slice(assetRoot.length + 1))}`
        : notebookRoute(nb.id, item.path === nb.root ? null : item.path.slice(nb.root.length + 1)));
    }
    else { const asset = assets.find(asset => asset.notebookId === item.notebookId && asset.path === item.path); if (asset) setPreview(asset); else screen.setError(t('screen.missing')); }
  } };
  const row = screen.page.rows.find(row => row.id === addTo);
  return <div className={`workspace-route screen-main ${focusedLaneId ? 'screen-focused' : 'has-sidebar-drawer'}`}>
    {!focusedLaneId && <>
    <WorkspaceSidebarDrawer open={sidebar.open} onClose={() => sidebar.setOpen(false)} closeLabel={t('common.close')}>
      <WorkspaceSidebar label={t('screen.controls')} className="screen-sidebar" footer={<p className="screen-wheel-help">{t('screen.wheelHint')}</p>}>
        <div className="screen-sidebar-controls">
          <Button className="screen-sidebar-action" disabled={disabled || screen.page.rows.length >= 40} onClick={() => { sidebar.setOpen(false); setDialog('add'); }}><Plus size={16} /><span>{t('screen.addRow')}</span></Button>
          {screen.writable && <ReorderToggle active={reorder} disabled={disabled} onToggle={() => setReorder(value => !value)} />}
        </div>
        {rows.length > 0 && <ScreenLaneNavigation reorder={reorder} page={screen.page} disabled={disabled} notebooks={notebooks} notes={notes} assets={assets} folders={folders} selectedNotebookId={selectedNotebookId} onChange={screen.change} onSelect={id => { document.getElementById(`screen-lane-${id}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); sidebar.setOpen(false); }} />}
      </WorkspaceSidebar>
    </WorkspaceSidebarDrawer>
    <WorkspaceSidebarToggle label={t('screen.controls')} open={sidebar.open} onClick={() => sidebar.setOpen(open => !open)} />
    </>}
    <main className="screen-content">
      {focusedLaneId && <header className="screen-focus-header">
        <Button className="study-back" aria-label={t('screen.backToScreen')} onClick={returnToScreen}><ArrowLeft size={18} /><span>{t('screen.backToScreen')}</span></Button>
        {focusedRow && <div className="study-header-actions"><div className="study-undo-slot" ref={setStudyToolbar} /><Button size="icon" disabled={disabled} aria-label={`${t('screen.editRow')}: ${focusedRow.name}`} onClick={() => setEditing(focusedRow.id)}><Pencil size={18} /></Button></div>}
      </header>}
      <div className="screen-board-scroll">
      {study.error && <div className="screen-error" role="alert">{study.error}<Button  onClick={() => void study.reload()}>{t('study.reload')}</Button></div>}
      {assetError && <div role="alert" className="screen-error">{t('screen.assetsError')}
        <Button type="button"  aria-label={t('screen.retryAssets')} disabled={assetsLoading} onClick={() => setAssetAttempt(value => value + 1)}>{t('screen.retryAssets')}</Button>
      </div>}
      {screen.error && <div role="alert" className="screen-error">{screen.error}
        <Button  onClick={() => setDialog('reload')}>{t('screen.reload')}</Button>
        <Button  onClick={() => { const blob = new Blob([stringify(screen.page)], { type: 'application/yaml' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'screen-draft.yaml'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>{t('screen.exportDraft')}</Button>
      </div>}
      {screen.loading ? <p role="status">{t('screen.loading')}</p> : <>
        {!screen.writable && <p className="screen-dialog-hint">{t('screen.readOnly')}</p>}
        {focusedLaneId && !focusedRow && !switchingLane && <div className="screen-board-empty" role="status"><p>{t('screen.laneMissing')}</p></div>}
        {!focusedLaneId && !rows.length && <div className="screen-board-empty"><ScreenIcon size={36} /><h3>{t('screen.startTitle')}</h3><p>{t('screen.startHint')}</p>
          <Button variant="primary" disabled={disabled} onClick={() => setDialog('add')}><Plus size={16} />{t('screen.addRow')}</Button></div>}
        {focusedLaneId ? reviewRow && <section id={`screen-lane-${reviewRow.id}`} className="screen-study-session" aria-label={reviewRow.name}>
          <StudyLane toolbar={studyToolbar} key={reviewRow.id} row={reviewRow} notes={reviewNotes} allNotes={notes} controller={study} disabled={disabled || screen.dirty || screen.saving} onOpen={onOpenNote} />
        </section> : <DndContext sensors={sensors} collisionDetection={screenCollision} onDragStart={({ active }) => setDragging(screen.page.rows.flatMap(row => row.kind === 'custom' ? row.items : []).find(item => item.id === active.id))}
          onDragCancel={() => setDragging(undefined)} onDragEnd={({ active, over }) => {
            setDragging(undefined); if (!over || active.id === over.id || disabled || !reorder) return;
            const target = screen.page.rows.find(row => row.kind === 'custom' && (`lane:${row.id}` === over.id || row.items.some(item => item.id === over.id)));
            if (target?.study?.status) return;
            if (target?.kind === 'custom') screen.change(moveScreenItem(screen.page, String(active.id), target.id, over.id === `lane:${target.id}` ? target.items.length : target.items.findIndex(item => item.id === over.id)));
          }}>
          {rows.map(row => <Lane reorder={reorder} key={row.id} row={row} {...content} disabled={disabled} study={study}
            graph={row.view === 'graph' ? <GraphPage notebooks={notebooks} notes={notes} lane={row} screen={screen} editing={graphEditing} onOpenNote={onOpenNote} /> : undefined}
            onCreateNote={onCreateNote}
            onStudy={() => navigate(screenLaneRoute(row.id) + location.search)}
            onStudyChange={study => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id === row.id ? { ...value, study } : value) })} onAdd={() => setAddTo(row.id)}
            onView={view => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id === row.id ? { ...value, view } : value) })}
            onSort={sort => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id !== row.id ? value : {
              ...value, ...(value.kind === 'dynamic' ? { sort } : {}),
            }) })}
            onRemove={id => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.kind === 'custom' ? { ...value, items: value.items.filter(item => item.id !== id) } : value) })} />)}
          <DragOverlay>{dragging && <div className="screen-drag-overlay"><GripVertical size={16} />{screenItemTitle(dragging, notes, assets)}</div>}</DragOverlay>
        </DndContext>}
      </>}
    </div>
    </main>

    {editingRow && <ScreenEditRow row={editingRow} disabled={disabled} {...content} folders={folders} selectedNotebookId={selectedNotebookId} onClose={() => setEditing(undefined)}
      onApply={next => screen.change({ ...screen.page, rows: screen.page.rows.map(row => row.id === next.id ? next : row) })}
      onRemove={() => { screen.change({ ...screen.page, rows: screen.page.rows.filter(row => row.id !== editingRow.id) }); if (focusedLaneId === editingRow.id) navigate('/screen' + location.search); }} />}
    {dialog === 'add' && <ScreenAddRow notebooks={notebooks} notes={notes} assets={assets} folders={folders} selectedNotebookId={selectedNotebookId} onClose={() => setDialog(null)} onAdd={row => screen.change({ ...screen.page, rows: [...screen.page.rows, row] })} />}
    {dialog === 'reload' && <WorkspaceDialog title={t('screen.reload')} onClose={() => setDialog(null)}><p>{t('screen.reloadHint')}</p><div className="workspace-dialog-actions"><Button  onClick={() => setDialog(null)}>{t('common.cancel')}</Button><Button  onClick={() => { setDialog(null); void screen.reload(); }}>{t('screen.reload')}</Button></div></WorkspaceDialog>}
    {row?.kind === 'custom' && <ScreenAddItem {...content} folders={folders} rowName={row.name} notebookId={row.notebookId} onClose={() => setAddTo(null)} onAdd={item => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id === row.id && value.kind === 'custom' ? { ...value, items: [...value.items, item] } : value) })} />}
    {preview && <WorkspaceDialog title={preview.name} onClose={() => setPreview(undefined)} className="asset-preview-dialog"><div className="workspace-asset-preview">{/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(preview.name) ? <img src={preview.rawUrl} alt={preview.name} /> : <a href={preview.rawUrl} target="_blank" rel="noopener noreferrer">{preview.name}</a>}</div><div className="workspace-dialog-actions"><Button  onClick={() => navigate(`/assets?notebook=${encodeURIComponent(preview.notebookId)}&asset=${encodeURIComponent(preview.path)}`)}>{t('links.locateAsset')}</Button></div></WorkspaceDialog>}
  </div>;
}
