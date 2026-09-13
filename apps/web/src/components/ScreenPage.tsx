import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { stringify } from 'yaml';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, GripVertical, X, Zap, ChevronLeft, ChevronRight, LayoutGrid, Columns3, Columns2, PanelLeft } from 'lucide-react';
import { moveScreenItem, type ScreenItem, type ScreenRow } from '@github-notes/core/screen-page';
import type { NoteItem, NotebookConfig, FolderItem } from '../lib/types.js';
import { fetchAssets } from '../lib/api.js';
import { notebookRoute } from '../lib/routes.js';
import { screenRowItems } from '../lib/screen-content.js';
import type { ScreenController } from '../lib/use-screen-page.js';
import { ScreenIcon } from './ScreenIcon.js';
import { screenCollision, screenKeyboardCoordinates } from '../lib/screen-drag.js';
import { useTranslation } from '../lib/i18n/index.js';
import { ScreenCard, screenItemTitle, type ScreenContentProps, type ScreenAsset } from './ScreenCard.js';
import { ScreenAddRow, ScreenAddItem } from './ScreenDialogs.js';
import { ScreenLaneNavigation } from './ScreenLaneNavigation.js';
import { WorkspaceSidebar } from './WorkspaceChrome.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';

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

function Lane({ row, disabled, onView, onAdd, onRemove, ...content }: ScreenContentProps & {
  row: ScreenRow; disabled: boolean; onView: (view: ScreenRow['view']) => void; onAdd: () => void; onRemove: (id: string) => void;
}) {
  const { t } = useTranslation(); const host = useRef<HTMLElement>(null), strip = useRef<HTMLDivElement>(null);
  const drop = useDroppable({ id: `lane:${row.id}`, disabled: disabled || row.kind !== 'custom', data: { rowId: row.id, empty: row.kind === 'custom' && !row.items.length } });
  const items = screenRowItems(row, content.notes, content.assets);
  useEffect(() => {
    const element = host.current!, scroller = strip.current!;
    const wheel = (event: WheelEvent) => {
      if (!event.altKey || event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientWidth : 1);
      event.preventDefault(); scroller.scrollLeft += delta;
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const scroll = (direction: number) => strip.current?.scrollBy({ left: direction * strip.current.clientWidth * .8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  const source = row.kind === 'dynamic' ? row.source.kind === 'tag' ? `#${row.source.tag}` : row.source.path : '';
  return <section id={`screen-lane-${row.id}`} ref={host} className={`screen-lane screen-view-${row.view} ${row.kind === 'dynamic' ? 'screen-lane-dynamic' : ''}`} aria-label={row.name}>
    <header className="screen-lane-header"><div className="screen-lane-heading"><h3>{row.name}</h3><span className="screen-count">{items.length}</span>
      {row.kind === 'dynamic' && <span className="screen-dynamic-label" title={t('screen.dynamicHint')}><Zap size={12} />{t('screen.dynamic')} · {source}</span>}</div>
      <div className="screen-lane-actions"><div className="screen-view-tabs" role="group" aria-label={`${t('screen.view')}: ${row.name}`}>
        {([{value:'thumbnail',icon:LayoutGrid},{value:'small',icon:Columns3},{value:'medium',icon:Columns2}] as const).map(({value,icon:Icon}) => <button key={value} type="button" disabled={disabled} className="ui-icon-button" title={t(`screen.${value}`)} aria-label={t(`screen.${value}`)} aria-pressed={row.view === value} onClick={() => onView(value)}><Icon size={16} /></button>)}
      </div>
        {row.kind === 'custom' && <button type="button" className="ui-icon-button" disabled={disabled} onClick={onAdd} aria-label={`${t('screen.addItem')}: ${row.name}`}><Plus size={16} /></button>}
        <button type="button" className="ui-icon-button" aria-label={`${t('screen.scrollLeft')}: ${row.name}`} onClick={() => scroll(-1)}><ChevronLeft size={16} /></button>
        <button type="button" className="ui-icon-button" aria-label={`${t('screen.scrollRight')}: ${row.name}`} onClick={() => scroll(1)}><ChevronRight size={16} /></button>
      </div>
    </header>
    <div ref={drop.setNodeRef} className={drop.isOver ? 'screen-drop-target' : ''}>
      <div ref={strip} className="screen-lane-strip" tabIndex={0} aria-label={`${row.name} · ${t('screen.items')}`}>
        {row.kind === 'custom' ? <SortableContext items={items.map(item => item.id)} strategy={horizontalListSortingStrategy}>
          {items.map(item => <MovableCard key={item.id} {...content} item={item} row={row} disabled={disabled} remove={() => onRemove(item.id)} />)}
        </SortableContext> : items.map(item => <div className="screen-card-slot" key={item.id}><ScreenCard {...content} item={item} view={row.view} /></div>)}
        {!items.length && <div className="screen-lane-empty">{t(row.kind === 'custom' ? 'screen.emptyCustom' : 'screen.emptyDynamic')}
          {row.kind === 'custom' && !disabled && <button className="ui-button" onClick={onAdd}><Plus size={14} />{t('screen.addItem')}</button>}</div>}
      </div>
    </div>
  </section>;
}

export function ScreenPage({ notebooks, notes, folders, selectedNotebookId, screen, onOpenNote }: {
  notebooks: NotebookConfig[]; notes: NoteItem[]; folders: FolderItem[]; selectedNotebookId: string; screen: ScreenController;
  onOpenNote: (note: NoteItem) => void;
}) {
  const { t } = useTranslation(); const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    if (!sidebarOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSidebarOpen(false); };
    document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close);
  }, [sidebarOpen]);
  const [assets, setAssets] = useState<ScreenAsset[]>([]), [assetError, setAssetError] = useState(false);
  const [assetAttempt, setAssetAttempt] = useState(0), [assetsLoading, setAssetsLoading] = useState(false);
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
  return <div className="workspace-route screen-main">
    {sidebarOpen && <button className="notebook-backdrop mobile-only absolute inset-0 z-20 bg-slate-950/40" aria-label={t('common.close')} onClick={() => setSidebarOpen(false)} />}
    <div className={`notebook-panel screen-sidebar-panel ${sidebarOpen ? 'is-open' : ''}`}>
      <WorkspaceSidebar label={t('screen.controls')} className="screen-sidebar" footer={<p className="screen-wheel-help">{t('screen.wheelHint')}</p>}>
        <div className="screen-sidebar-controls">
          <button className="screen-sidebar-action" disabled={disabled || screen.page.rows.length >= 40} onClick={() => { setSidebarOpen(false); setDialog('add'); }}><Plus size={16} />{t('screen.addRow')}</button>
        </div>
        {screen.page.rows.length > 0 && <ScreenLaneNavigation page={screen.page} disabled={disabled} onChange={screen.change} onSelect={id => { document.getElementById(`screen-lane-${id}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); setSidebarOpen(false); }} />}
      </WorkspaceSidebar>
    </div>
    <main className="screen-content">
      <button className="mobile-only screen-mobile-toggle ui-button" aria-label={t('screen.controls')} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(open => !open)}><PanelLeft size={16} />{t('screen.lanes')}</button>
      <div className="screen-board-scroll">
      {assetError && <div role="alert" className="screen-error">{t('screen.assetsError')}
        <button type="button" className="ui-button" aria-label={t('screen.retryAssets')} disabled={assetsLoading} onClick={() => setAssetAttempt(value => value + 1)}>{t('screen.retryAssets')}</button>
      </div>}
      {screen.error && <div role="alert" className="screen-error">{screen.error}
        <button className="ui-button" onClick={() => setDialog('reload')}>{t('screen.reload')}</button>
        <button className="ui-button" onClick={() => { const blob = new Blob([stringify(screen.page)], { type: 'application/yaml' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'screen-draft.yaml'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>{t('screen.exportDraft')}</button>
      </div>}
      {screen.loading ? <p role="status">{t('screen.loading')}</p> : <>
        {!screen.writable && <p className="screen-dialog-hint">{t('screen.readOnly')}</p>}
        {!screen.page.rows.length && <div className="screen-board-empty"><ScreenIcon size={36} /><h3>{t('screen.startTitle')}</h3><p>{t('screen.startHint')}</p>
          <button className="ui-button ui-button-primary" disabled={disabled} onClick={() => setDialog('add')}><Plus size={16} />{t('screen.addRow')}</button></div>}
        <DndContext sensors={sensors} collisionDetection={screenCollision} onDragStart={({ active }) => setDragging(screen.page.rows.flatMap(row => row.kind === 'custom' ? row.items : []).find(item => item.id === active.id))}
          onDragCancel={() => setDragging(undefined)} onDragEnd={({ active, over }) => {
            setDragging(undefined); if (!over || active.id === over.id || disabled) return;
            const target = screen.page.rows.find(row => row.kind === 'custom' && (`lane:${row.id}` === over.id || row.items.some(item => item.id === over.id)));
            if (target?.kind === 'custom') screen.change(moveScreenItem(screen.page, String(active.id), target.id, over.id === `lane:${target.id}` ? target.items.length : target.items.findIndex(item => item.id === over.id)));
          }}>
          {screen.page.rows.map(row => <Lane key={row.id} row={row} {...content} disabled={disabled} onAdd={() => setAddTo(row.id)}
            onView={view => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id === row.id ? { ...value, view } : value) })}
            onRemove={id => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.kind === 'custom' ? { ...value, items: value.items.filter(item => item.id !== id) } : value) })} />)}
          <DragOverlay>{dragging && <div className="screen-drag-overlay"><GripVertical size={16} />{screenItemTitle(dragging, notes, assets)}</div>}</DragOverlay>
        </DndContext>
      </>}
    </div>
    </main>
    {dialog === 'add' && <ScreenAddRow notebooks={notebooks} notes={notes} assets={assets} folders={folders} selectedNotebookId={selectedNotebookId} onClose={() => setDialog(null)} onAdd={row => screen.change({ ...screen.page, rows: [...screen.page.rows, row] })} />}
    {dialog === 'reload' && <WorkspaceDialog title={t('screen.reload')} onClose={() => setDialog(null)}><p>{t('screen.reloadHint')}</p><div className="workspace-dialog-actions"><button className="ui-button" onClick={() => setDialog(null)}>{t('common.cancel')}</button><button className="ui-button" onClick={() => { setDialog(null); void screen.reload(); }}>{t('screen.reload')}</button></div></WorkspaceDialog>}
    {row?.kind === 'custom' && <ScreenAddItem {...content} folders={folders} rowName={row.name} selectedNotebookId={selectedNotebookId} onClose={() => setAddTo(null)} onAdd={item => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id === row.id && value.kind === 'custom' ? { ...value, items: [...value.items, item] } : value) })} />}
    {preview && <WorkspaceDialog title={preview.name} onClose={() => setPreview(undefined)} className="asset-preview-dialog"><div className="workspace-asset-preview">{/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(preview.name) ? <img src={preview.rawUrl} alt={preview.name} /> : <a href={preview.rawUrl} target="_blank" rel="noopener noreferrer">{preview.name}</a>}</div><div className="workspace-dialog-actions"><button className="ui-button" onClick={() => navigate(`/assets?notebook=${encodeURIComponent(preview.notebookId)}&asset=${encodeURIComponent(preview.path)}`)}>{t('links.locateAsset')}</button></div></WorkspaceDialog>}
  </div>;
}
