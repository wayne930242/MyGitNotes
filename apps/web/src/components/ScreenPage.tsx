import './study.css';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { stringify } from 'yaml';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, GripVertical, X, Zap, ChevronLeft, ChevronRight, LayoutGrid, Columns3, Columns2, SlidersHorizontal, BookOpen, Brain, Maximize2, ArrowLeft, Pencil } from 'lucide-react';
import { moveScreenItem, type ScreenItem, type ScreenRow } from '@github-notes/core/screen-page';
import type { NoteItem, NotebookConfig, FolderItem } from '../lib/types.js';
import { fetchAssets } from '../lib/api.js';
import { notebookRoute, screenLaneRoute } from '../lib/routes.js';
import { useStudyWorkspace, type StudyController } from '../lib/use-study-workspace.js';
import { StudyLane, type StudyLaneNavigation } from './StudyLane.js';
import { defaultStudyProgression } from '@github-notes/core/study-stages';
import { resolveNoteStatuses } from '@github-notes/core/note-status';
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

function MovableCard({ item, row, disabled, remove, ...content }: ScreenContentProps & {
  item: ScreenItem; row: ScreenRow; disabled: boolean; remove: () => void;
}) {
  const { t } = useTranslation();
  const sort = useSortable({ id: item.id, disabled, data: { rowId: row.id } });
  return <div ref={sort.setNodeRef} className="screen-card-slot" style={{ transform: CSS.Transform.toString(sort.transform), transition: sort.transition, opacity: sort.isDragging ? .3 : undefined }}>
    <ScreenCard {...content} item={item} view={row.view} controls={!disabled && <>
      <button type="button" ref={sort.setActivatorNodeRef} {...sort.attributes} {...sort.listeners} className="screen-drag-handle ui-icon-button" aria-label={`${t('screen.moveItem')}: ${screenItemTitle(item, content.notes, content.assets)}`}><GripVertical size={14} /></button>
      <button type="button" className="screen-remove ui-icon-button" aria-label={`${t('screen.unpin')}: ${screenItemTitle(item, content.notes, content.assets)}`} onClick={remove}><X size={12} /></button>
    </>} />
  </div>;
}

function Lane({ row, focused, disabled, studyBlocked, study, onFocus, onStudyChange, onView, onSort, onAdd, onRemove, ...content }: ScreenContentProps & {
  row: ScreenRow; focused: boolean; disabled: boolean; studyBlocked: boolean; onFocus: () => void; onView: (view: ScreenRow['view']) => void; onAdd: () => void; onRemove: (id: string) => void;
  onSort: (sort: SortConfig | 'due' | 'manual') => void; study: StudyController; onStudyChange: (study: NonNullable<ScreenRow['study']>) => void;
}) {
  const { t } = useTranslation(); const host = useRef<HTMLElement>(null), strip = useRef<HTMLDivElement>(null);
  const studyNavigation = useRef<StudyLaneNavigation>(null);
  const [navigation, setNavigation] = useState({ previous: false, next: false });
  const [queryOpen, setQueryOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 30000); return () => clearInterval(timer); }, []);
  const items = studyRowItems(screenRowItems(row, content.notes, content.assets, content.notebooks), row, content.notes, study.study, clock);
  const query = row.study || { filter: 'all' as const, dueFirst: false };
  const filtered = query.filter !== 'all' || query.dueFirst || Boolean(query.status);
  const studying = row.view === 'reading' || row.view === 'study';
  const drop = useDroppable({ id: `lane:${row.id}`, disabled: disabled || filtered || row.kind !== 'custom', data: { rowId: row.id, empty: row.kind === 'custom' && !row.items.length } });
  const statuses = [...new Set(content.notebooks.flatMap(notebook => resolveNoteStatuses(notebook, content.notes.filter(note => note.notebookId === notebook.id).map(note => note.status))))];
  useAltWheelHorizontalScroll(host, strip);
  const scroll = (direction: number) => strip.current?.scrollBy({ left: direction * strip.current.clientWidth * .8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  const source = row.kind === 'dynamic' ? row.source.kind === 'tag' ? `#${row.source.tag}` : row.source.path : '';
  return <section id={`screen-lane-${row.id}`} ref={host} className={`screen-lane screen-view-${row.view} ${row.kind === 'dynamic' ? 'screen-lane-dynamic' : ''}`} aria-label={row.name}>
    <header className="screen-lane-header"><div className="screen-lane-heading"><h3>{row.name}</h3><span className="screen-count">{items.length}</span>
      {row.kind === 'dynamic' && <span className="screen-dynamic-label" title={t('screen.dynamicHint')}><Zap size={12} />{t('screen.dynamic')} · {source}</span>}
      <button className="screen-lane-focus ui-icon-button" type="button" onClick={onFocus} aria-label={`${t('screen.focusLane')}: ${row.name}`} title={t('screen.focusLane')}><Maximize2 size={18} /></button></div>
      <div className="screen-lane-actions">
        <button type="button" className={`screen-lane-query-toggle ui-icon-button ${filtered ? 'is-active' : ''}`}
          aria-label={`${t('screen.filtersAndSort')}: ${row.name}`} title={t('screen.filtersAndSort')}
          aria-expanded={queryOpen} aria-controls={`screen-query-${row.id}`} onClick={() => setQueryOpen(open => !open)}><SlidersHorizontal size={18} /></button>
        <div id={`screen-query-${row.id}`} className="screen-lane-query" data-open={queryOpen}>
          {studying && <label className="screen-lane-filter">{t('study.filter')}<select className="ui-control" disabled={disabled} value={query.filter} onChange={event => onStudyChange({ ...query, filter: event.target.value as typeof query.filter })}>
            {(['all', 'due', 'future', 'paused'] as const).map(value => <option key={value} value={value}>{t(`study.filter.${value}`)}</option>)}
          </select></label>}
          <label className="screen-lane-filter">{t('study.status')}<select className="ui-control" disabled={disabled} value={query.status || ''} onChange={event => onStudyChange({ ...query, status: event.target.value || undefined })}>
            <option value="">{t('study.filter.all')}</option>{statuses.map(status => <option key={status} value={status}>{status}</option>)}
          </select></label>
          <label className="screen-lane-sort"><span>{t('sort.select')}</span><Select className="screen-sort-select" aria-label={`${t('sort.select')}: ${row.name}`} disabled={disabled}
            value={query.dueFirst ? 'due' : row.kind === 'custom' ? 'manual' : `${row.sort?.field || 'title'}:${row.sort?.order || 'asc'}`}
            onValueChange={value => {
              if (value === 'due' || value === 'manual') onSort(value);
              else { const [field, order] = value.split(':') as [SortConfig['field'], SortConfig['order']]; onSort({ field, order }); }
            }}
            options={[{ value: 'due', label: t('study.dueFirst') }, ...(row.kind === 'custom' ? [{ value: 'manual', label: t('screen.manualOrder') }] : ([
              ['updated:desc','sort.updatedDesc'], ['updated:asc','sort.updatedAsc'],
              ['created:desc','sort.createdDesc'], ['created:asc','sort.createdAsc'],
              ['title:asc','sort.titleAsc'], ['title:desc','sort.titleDesc'], ['status:asc','sort.status'],
            ] as const).map(([value,label]) => ({value,label:t(label)})))]} /></label>
        </div>
        <Select className="screen-view-select" aria-label={`${t('screen.view')}: ${row.name}`} value={row.view} disabled={disabled} onValueChange={value => onView(value as ScreenRow['view'])}
          options={(['thumbnail', 'small', 'medium', 'reading', 'study'] as const).map(value => ({ value, label: t(`screen.${value}`) }))} />
        <div className="screen-view-tabs" role="group" aria-label={`${t('screen.view')}: ${row.name}`}>
        {([{value:'thumbnail',icon:LayoutGrid},{value:'small',icon:Columns3},{value:'medium',icon:Columns2},{value:'reading',icon:BookOpen},{value:'study',icon:Brain}] as const).map(({value,icon:Icon}) => <button key={value} type="button" disabled={disabled} className="ui-icon-button" title={t(`screen.${value}`)} aria-label={t(`screen.${value}`)} aria-pressed={row.view === value} onClick={() => onView(value)}><Icon size={16} /></button>)}
      </div>
        {row.kind === 'custom' && <button type="button" className="ui-icon-button" disabled={disabled} onClick={onAdd} aria-label={`${t('screen.addItem')}: ${row.name}`}><Plus size={16} /></button>}
        <button type="button" className={`screen-lane-scroll ui-icon-button ${studying ? 'screen-study-navigation' : ''}`} disabled={studying && !navigation.previous} aria-label={`${t(studying ? 'study.previousCard' : 'screen.scrollLeft')}: ${row.name}`} onClick={() => studying ? studyNavigation.current?.previous() : scroll(-1)}><ChevronLeft size={16} /></button>
        <button type="button" className={`screen-lane-scroll ui-icon-button ${studying ? 'screen-study-navigation' : ''}`} disabled={studying && !navigation.next} aria-label={`${t(studying ? 'study.nextCard' : 'screen.scrollRight')}: ${row.name}`} onClick={() => studying ? studyNavigation.current?.next() : scroll(1)}><ChevronRight size={16} /></button>
      </div>
    </header>
    {studying ? <StudyLane ref={studyNavigation} focused={focused} onNavigationChange={setNavigation} row={row} controller={study} disabled={disabled || studyBlocked} allNotes={content.notes}
      notes={items.flatMap(item => item.kind === 'note' ? content.notes.filter(note => note.path === item.path && note.notebookId === item.notebookId) : [])}
      onOpen={note => content.onOpen({ id: note.path, kind: 'note', notebookId: note.notebookId, path: note.path })} /> : <div ref={drop.setNodeRef} className={drop.isOver ? 'screen-drop-target' : ''}>
      <div ref={strip} className="screen-lane-strip" tabIndex={0} aria-label={`${row.name} · ${t('screen.items')}`}>
        {row.kind === 'custom' ? <SortableContext items={items.map(item => item.id)} strategy={horizontalListSortingStrategy}>
          {items.map(item => <MovableCard key={item.id} {...content} item={item} row={row} disabled={disabled || filtered} remove={() => onRemove(item.id)} />)}
        </SortableContext> : items.map(item => <div className="screen-card-slot" key={item.id}><ScreenCard {...content} item={item} view={row.view} /></div>)}
        {!items.length && <div className="screen-lane-empty">{t(row.kind === 'custom' ? 'screen.emptyCustom' : 'screen.emptyDynamic')}
          {row.kind === 'custom' && !disabled && <button className="ui-button" onClick={onAdd}><Plus size={14} />{t('screen.addItem')}</button>}</div>}
      </div>
    </div>}
  </section>;
}

export function ScreenPage({ notebooks, notes, folders, selectedNotebookId, screen, onOpenNote, onStudySaved, focusedLaneId }: {
  notebooks: NotebookConfig[]; notes: NoteItem[]; folders: FolderItem[]; selectedNotebookId: string; screen: ScreenController;
  focusedLaneId?: string | null; onOpenNote: (note: NoteItem) => void; onStudySaved: (note?: NoteItem) => void;
}) {
  const { t } = useTranslation(); const navigate = useNavigate(); const location = useLocation();
  const sidebar = useWorkspaceSidebarDrawer();
  const study = useStudyWorkspace(onStudySaved);
  const [assets, setAssets] = useState<ScreenAsset[]>([]), [assetError, setAssetError] = useState(false);
  const [assetAttempt, setAssetAttempt] = useState(0), [assetsLoading, setAssetsLoading] = useState(false);
  const [editing, setEditing] = useState<string>();
  const focusedRow = screen.page.rows.find(row => row.id === focusedLaneId);
  const editingRow = screen.page.rows.find(row => row.id === editing);
  const returnToScreen = () => navigate(`/screen${location.search}#screen-lane-${focusedLaneId}`);
  useEffect(() => {
    if (!focusedLaneId && location.hash.startsWith('#screen-lane-')) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [focusedLaneId, location.hash, screen.loading]);
  const [dialog, setDialog] = useState<'add' | 'reload' | null>(null), [addTo, setAddTo] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScreenAsset>(), [dragging, setDragging] = useState<ScreenItem>();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: screenKeyboardCoordinates }));
  useEffect(() => {
    let active = true; setAssetsLoading(true);
    void Promise.allSettled(notebooks.map(async nb => (await fetchAssets(nb.id)).map(asset => ({ ...asset, notebookId: nb.id })))).then(results => {
      if (!active) return;
      setAssets(previous => results.flatMap((result,index) => result.status === 'fulfilled' ? result.value : previous.filter(asset => asset.notebookId === notebooks[index].id)));
      setAssetError(results.some(result => result.status === 'rejected')); setAssetsLoading(false);
    });
    return () => { active = false; };
  }, [notebooks, notes, assetAttempt]);
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
          <button className="screen-sidebar-action" disabled={disabled || screen.page.rows.length >= 40} onClick={() => { sidebar.setOpen(false); setDialog('add'); }}><Plus size={16} />{t('screen.addRow')}</button>
        </div>
        {screen.page.rows.length > 0 && <ScreenLaneNavigation page={screen.page} disabled={disabled} notebooks={notebooks} notes={notes} assets={assets} folders={folders} selectedNotebookId={selectedNotebookId} onChange={screen.change} onSelect={id => { document.getElementById(`screen-lane-${id}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); sidebar.setOpen(false); }} />}
      </WorkspaceSidebar>
    </WorkspaceSidebarDrawer>
    <WorkspaceSidebarToggle label={t('screen.controls')} open={sidebar.open} onClick={() => sidebar.setOpen(open => !open)} />
    </>}
    <main className="screen-content">
      {focusedLaneId && <header className="screen-focus-header">
        <button className="ui-button" onClick={returnToScreen}><ArrowLeft size={18} />{t('screen.backToScreen')}</button>
        <h2>{focusedRow?.name || t('screen.focusLane')}</h2>
        {focusedRow && <button className="ui-icon-button" disabled={disabled} aria-label={`${t('screen.editRow')}: ${focusedRow.name}`} onClick={() => setEditing(focusedRow.id)}><Pencil size={18} /></button>}
      </header>}
      <div className="screen-board-scroll">
      {study.error && <div className="screen-error" role="alert">{study.error}<button className="ui-button" onClick={() => void study.reload()}>{t('study.reload')}</button></div>}
      {assetError && <div role="alert" className="screen-error">{t('screen.assetsError')}
        <button type="button" className="ui-button" aria-label={t('screen.retryAssets')} disabled={assetsLoading} onClick={() => setAssetAttempt(value => value + 1)}>{t('screen.retryAssets')}</button>
      </div>}
      {screen.error && <div role="alert" className="screen-error">{screen.error}
        <button className="ui-button" onClick={() => setDialog('reload')}>{t('screen.reload')}</button>
        <button className="ui-button" onClick={() => { const blob = new Blob([stringify(screen.page)], { type: 'application/yaml' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'screen-draft.yaml'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>{t('screen.exportDraft')}</button>
      </div>}
      {screen.loading ? <p role="status">{t('screen.loading')}</p> : <>
        {!screen.writable && <p className="screen-dialog-hint">{t('screen.readOnly')}</p>}
        {focusedLaneId && !focusedRow && <div className="screen-board-empty" role="status"><p>{t('screen.laneMissing')}</p></div>}
        {!focusedLaneId && !screen.page.rows.length && <div className="screen-board-empty"><ScreenIcon size={36} /><h3>{t('screen.startTitle')}</h3><p>{t('screen.startHint')}</p>
          <button className="ui-button ui-button-primary" disabled={disabled} onClick={() => setDialog('add')}><Plus size={16} />{t('screen.addRow')}</button></div>}
        <DndContext sensors={sensors} collisionDetection={screenCollision} onDragStart={({ active }) => setDragging(screen.page.rows.flatMap(row => row.kind === 'custom' ? row.items : []).find(item => item.id === active.id))}
          onDragCancel={() => setDragging(undefined)} onDragEnd={({ active, over }) => {
            setDragging(undefined); if (!over || active.id === over.id || disabled) return;
            const target = screen.page.rows.find(row => row.kind === 'custom' && (`lane:${row.id}` === over.id || row.items.some(item => item.id === over.id)));
            if (target?.study && (target.study.filter !== 'all' || target.study.dueFirst || target.study.status)) return;
            if (target?.kind === 'custom') screen.change(moveScreenItem(screen.page, String(active.id), target.id, over.id === `lane:${target.id}` ? target.items.length : target.items.findIndex(item => item.id === over.id)));
          }}>
          {screen.page.rows.filter(row => !focusedLaneId || row.id === focusedLaneId).map(row => <Lane key={row.id} row={row} focused={Boolean(focusedLaneId)} {...content} disabled={disabled} studyBlocked={screen.dirty || screen.saving} study={study}
            onFocus={() => navigate(screenLaneRoute(row.id) + location.search)}
            onStudyChange={study => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id === row.id ? { ...value, study } : value) })} onAdd={() => setAddTo(row.id)}
            onView={view => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id === row.id ? { ...value, view, ...(['reading', 'study'].includes(view) && !value.progression ? { progression: defaultStudyProgression([...new Set(notebooks.flatMap(notebook => resolveNoteStatuses(notebook)))]) } : {}) } : value) })}
            onSort={sort => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id !== row.id ? value : {
              ...value, study: { ...(value.study || { filter: 'all' as const }), dueFirst: sort === 'due' },
              ...(value.kind === 'dynamic' && typeof sort !== 'string' ? { sort } : {}),
            }) })}
            onRemove={id => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.kind === 'custom' ? { ...value, items: value.items.filter(item => item.id !== id) } : value) })} />)}
          <DragOverlay>{dragging && <div className="screen-drag-overlay"><GripVertical size={16} />{screenItemTitle(dragging, notes, assets)}</div>}</DragOverlay>
        </DndContext>
      </>}
    </div>
    </main>

    {editingRow && <ScreenEditRow row={editingRow} disabled={disabled} {...content} folders={folders} selectedNotebookId={selectedNotebookId} onClose={() => setEditing(undefined)}
      onApply={next => screen.change({ ...screen.page, rows: screen.page.rows.map(row => row.id === next.id ? next : row) })}
      onRemove={() => { screen.change({ ...screen.page, rows: screen.page.rows.filter(row => row.id !== editingRow.id) }); if (focusedLaneId === editingRow.id) navigate('/screen' + location.search); }} />}
    {dialog === 'add' && <ScreenAddRow notebooks={notebooks} notes={notes} assets={assets} folders={folders} selectedNotebookId={selectedNotebookId} onClose={() => setDialog(null)} onAdd={row => screen.change({ ...screen.page, rows: [...screen.page.rows, row] })} />}
    {dialog === 'reload' && <WorkspaceDialog title={t('screen.reload')} onClose={() => setDialog(null)}><p>{t('screen.reloadHint')}</p><div className="workspace-dialog-actions"><button className="ui-button" onClick={() => setDialog(null)}>{t('common.cancel')}</button><button className="ui-button" onClick={() => { setDialog(null); void screen.reload(); }}>{t('screen.reload')}</button></div></WorkspaceDialog>}
    {row?.kind === 'custom' && <ScreenAddItem {...content} folders={folders} rowName={row.name} selectedNotebookId={selectedNotebookId} onClose={() => setAddTo(null)} onAdd={item => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id === row.id && value.kind === 'custom' ? { ...value, items: [...value.items, item] } : value) })} />}
    {preview && <WorkspaceDialog title={preview.name} onClose={() => setPreview(undefined)} className="asset-preview-dialog"><div className="workspace-asset-preview">{/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(preview.name) ? <img src={preview.rawUrl} alt={preview.name} /> : <a href={preview.rawUrl} target="_blank" rel="noopener noreferrer">{preview.name}</a>}</div><div className="workspace-dialog-actions"><button className="ui-button" onClick={() => navigate(`/assets?notebook=${encodeURIComponent(preview.notebookId)}&asset=${encodeURIComponent(preview.path)}`)}>{t('links.locateAsset')}</button></div></WorkspaceDialog>}
  </div>;
}
