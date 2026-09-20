import { ReorderToggle } from './ReorderToggle.js';
import { lazy } from 'react';
const GraphPage = lazy(() => import('./GraphPage.js').then(module => ({ default: module.GraphPage })));
import type { ReactNode } from 'react';
import { Button } from './Button.js';
import './study.css';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { stringify } from 'yaml';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { ArrowLeft, GripVertical, Pencil, Plus } from 'lucide-react';
import { moveScreenItem, type ScreenItem, type ScreenRow } from '@mygitnotes/core/screen-page';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { FolderItem, NotebookConfig } from '../lib/types.js';
import { useNoteFacets } from '../lib/use-note-queries.js';
import { useLaneNotes } from '../lib/screen-queries.js';
import { screenLaneRoute } from '../lib/routes.js';
import { useStudyWorkspace } from '../lib/use-study-workspace.js';
import { StudyLane } from './StudyLane.js';
import { defaultStudyProgression, studyLaneStatuses } from '@mygitnotes/core/study-stages';
import { screenRowItems, studyRowItems } from '../lib/screen-content.js';
import type { ScreenController } from '../lib/use-screen-page.js';
import { ScreenIcon } from './ScreenIcon.js';
import { screenCollision, screenKeyboardCoordinates } from '../lib/screen-drag.js';
import { useTranslation } from '../lib/i18n/index.js';
import { type ScreenContentProps, screenItemTitle } from './ScreenCard.js';
import { ScreenAddItem, ScreenAddRow, ScreenEditRow } from './ScreenDialogs.js';
import { ScreenLaneNavigation } from './ScreenLaneNavigation.js';
import { useWorkspaceSidebarDrawer, WorkspaceSidebar, WorkspaceSidebarDrawer, WorkspaceSidebarToggle } from './WorkspaceChrome.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { ScreenLane } from './ScreenLane.js';
import { useScreenAssets, useScreenItemOpen } from './useScreenItemOpen.js';

export { createLaneNoteContext } from './ScreenLane.js';
export { screenViewTabs } from './ScreenLane.js';

export function ScreenPage({ notebooks, folders, selectedNotebookId, screen, onOpenNote, onStudySaved, focusedLaneId, onCreateNote, focusSection, onAddLaneToFocus }: { notebooks: NotebookConfig[]; folders: FolderItem[]; selectedNotebookId: string; screen: ScreenController; focusedLaneId?: string | null; onOpenNote: (note: NoteListItem) => void; onStudySaved: () => void; onCreateNote?: (context?: { notebookId?: string; folder?: string; tag?: string; }) => void; focusSection?: ReactNode; onAddLaneToFocus?: (row: ScreenRow) => void; }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const sidebar = useWorkspaceSidebarDrawer();
  const setSidebarOpen = sidebar.setOpen;
  const [reorder, setReorder] = useState(false);
  const [reorderScope, setReorderScope] = useState({ selectedNotebookId, focusedLaneId });
  if (reorderScope.selectedNotebookId !== selectedNotebookId || reorderScope.focusedLaneId !== focusedLaneId) {
    setReorderScope({ selectedNotebookId, focusedLaneId });
    setReorder(false);
  }
  const study = useStudyWorkspace(onStudySaved);
  const { assets, error: assetError, loading: assetsLoading, retry: retryAssets } = useScreenAssets(notebooks, selectedNotebookId);
  const [studyToolbar, setStudyToolbar] = useState<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<string>();
  const rows = screen.page.rows.filter(row => row.notebookId === selectedNotebookId);
  const focusedRow = rows.find(row => row.id === focusedLaneId);
  const laneNotebookId = screen.page.rows.find(row => row.id === focusedLaneId)?.notebookId;
  const switchingLane = Boolean(laneNotebookId && laneNotebookId !== selectedNotebookId && notebooks.some(notebook => notebook.id === laneNotebookId));
  useEffect(() => {
    if (!switchingLane || !laneNotebookId) return;
    const query = new URLSearchParams(location.search);
    query.set('notebook', laneNotebookId);
    navigate(`${location.pathname}?${query}${location.hash}`, { replace: true });
  }, [switchingLane, laneNotebookId, location.pathname, location.search, location.hash, navigate]);
  const editingRow = screen.page.rows.find(row => row.id === editing);
  const returnToScreen = () => {
    const query = new URLSearchParams(location.search);
    query.delete('mode');
    query.delete('studyFilter');
    navigate(`/screen${query.size ? '?' + query.toString() : ''}#screen-lane-${focusedLaneId}`);
  };
  const reviewRow = focusedRow && { ...focusedRow, progression: focusedRow.progression || defaultStudyProgression(studyLaneStatuses(focusedRow, notebooks)), study: { ...focusedRow.study, filter: focusedRow.study?.filter || 'all', dueFirst: true } };
  const facets = useNoteFacets(false);
  // A study session orders its whole queue, so the focused lane reads every member at once.
  const reviewLane = useLaneNotes(focusedLaneId ? reviewRow : undefined, { all: true });
  const reviewItems = reviewRow ? studyRowItems(screenRowItems(reviewRow, reviewLane.notes, [], notebooks), reviewRow, reviewLane.notes, study.study) : [];
  const reviewNotes = reviewItems.flatMap(item => item.kind === 'note' ? reviewLane.notes.filter(note => note.notebookId === item.notebookId && note.path === item.path) : []);
  useEffect(() => {
    if (!focusedLaneId && location.hash.startsWith('#screen-lane-')) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [focusedLaneId, location.hash, screen.loading]);
  const [dialog, setDialog] = useState<'add' | 'reload' | null>(null), [addTo, setAddTo] = useState<string | null>(null);
  const [dragging, setDragging] = useState<ScreenItem>();
  // Only a custom lane's cards are draggable, so its own note titles name the dragged item.
  const draggedLane = screen.page.rows.find(row => row.kind === 'custom' && row.items.some(item => item.id === dragging?.id));
  const draggedNotes = useLaneNotes(dragging ? draggedLane : undefined);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: screenKeyboardCoordinates }));

  useEffect(() => {
    if (focusedLaneId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '[' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], .cm-content')) return;
        event.preventDefault();
        setSidebarOpen(open => !open);
      }
    };
    const onToggle = () => setSidebarOpen(open => !open);
    window.addEventListener('keydown', onKey);
    window.addEventListener('toggle-screen-sidebar', onToggle);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('toggle-screen-sidebar', onToggle);
    };
  }, [focusedLaneId, setSidebarOpen]);

  const disabled = !screen.writable || screen.loading;
  const itemOpen = useScreenItemOpen({ notebooks, assets, onOpenNote, onMissing: () => screen.setError(t('screen.missing')) });
  const content: Omit<ScreenContentProps, 'notes'> = { notebooks, assets, onOpen: itemOpen.open };
  const row = screen.page.rows.find(row => row.id === addTo);
  return (
    <div className={`workspace-route screen-main ${focusedLaneId ? 'screen-focused' : 'has-sidebar-drawer'}`}>
      {!focusedLaneId && (
        <>
          <WorkspaceSidebarDrawer open={sidebar.open} onClose={() => sidebar.setOpen(false)} closeLabel={t('common.close')}>
            <WorkspaceSidebar label={t('screen.controls')} className='screen-sidebar' footer={<p className='screen-wheel-help'>{t('screen.wheelHint')}</p>}>
              <div className='screen-sidebar-controls'>
                <Button
                  className='screen-sidebar-action'
                  disabled={disabled || screen.page.rows.length >= 40}
                  onClick={() => {
                    sidebar.setOpen(false);
                    setDialog('add');
                  }}
                >
                  <Plus size={16} />
                  <span>{t('screen.addRow')}</span>
                </Button>
                {screen.writable && <ReorderToggle active={reorder} disabled={disabled} onToggle={() => setReorder(value => !value)} />}
              </div>
              {rows.length > 0 && (
                <ScreenLaneNavigation
                  reorder={reorder}
                  page={screen.page}
                  disabled={disabled}
                  notebooks={notebooks}
                  assets={assets}
                  folders={folders}
                  selectedNotebookId={selectedNotebookId}
                  onChange={screen.change}
                  onSelect={id => {
                    document.getElementById(`screen-lane-${id}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
                    sidebar.setOpen(false);
                  }}
                />
              )}
            </WorkspaceSidebar>
          </WorkspaceSidebarDrawer>
          <WorkspaceSidebarToggle label={t('screen.controls')} open={sidebar.open} onClick={() => setSidebarOpen(open => !open)} />
        </>
      )}
      <main className='screen-content'>
        {focusedLaneId && (
          <header className='screen-focus-header'>
            <Button className='study-back' aria-label={t('screen.backToScreen')} onClick={returnToScreen}>
              <ArrowLeft size={18} />
              <span>{t('screen.backToScreen')}</span>
            </Button>
            {focusedRow && (
              <div className='study-header-actions'>
                <div className='study-undo-slot' ref={setStudyToolbar} />
                <Button size='icon' disabled={disabled} aria-label={`${t('screen.editRow')}: ${focusedRow.name}`} onClick={() => setEditing(focusedRow.id)}>
                  <Pencil size={18} />
                </Button>
              </div>
            )}
          </header>
        )}
        <div className='screen-board-scroll'>
          {study.error && (
            <div className='screen-error' role='alert'>
              {study.error}
              <Button onClick={() => void study.reload()}>{t('study.reload')}</Button>
            </div>
          )}
          {assetError && (
            <div role='alert' className='screen-error'>
              {t('screen.assetsError')}
              <Button
                type='button'
                aria-label={t('screen.retryAssets')}
                disabled={assetsLoading}
                onClick={() => retryAssets()}
              >
                {t('screen.retryAssets')}
              </Button>
            </div>
          )}
          {screen.error && (
            <div role='alert' className='screen-error'>
              {screen.error}
              <Button onClick={() => setDialog('reload')}>{t('screen.reload')}</Button>
              <Button
                onClick={() => {
                  const blob = new Blob([stringify(screen.page)], { type: 'application/yaml' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'screen-draft.yaml';
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                {t('screen.exportDraft')}
              </Button>
            </div>
          )}
          {screen.loading ? <p role='status'>{t('screen.loading')}</p> : (
            <>
              {!focusedLaneId && focusSection}
              {!screen.writable && <p className='screen-dialog-hint'>{t('screen.readOnly')}</p>}
              {focusedLaneId && !focusedRow && !switchingLane && (
                <div className='screen-board-empty' role='status'>
                  <p>{t('screen.laneMissing')}</p>
                </div>
              )}
              {!focusedLaneId && !rows.length && (
                <div className='screen-board-empty'>
                  <ScreenIcon size={36} />
                  <h3>{t('screen.startTitle')}</h3>
                  <p>{t('screen.startHint')}</p>
                  <Button variant='primary' disabled={disabled} onClick={() => setDialog('add')}>
                    <Plus size={16} />
                    {t('screen.addRow')}
                  </Button>
                </div>
              )}
              {focusedLaneId ? reviewRow && <section id={`screen-lane-${reviewRow.id}`} className='screen-study-session' aria-label={reviewRow.name}>{reviewLane.error && <p role='alert' className='screen-error'>{reviewLane.error}</p>}{reviewLane.loading ? <p role='status'>{t('notes.loading')}</p> : <StudyLane toolbar={studyToolbar} key={reviewRow.id} row={reviewRow} notes={reviewNotes} controller={study} disabled={disabled || screen.dirty || screen.saving} onOpen={onOpenNote} />}</section> : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={screenCollision}
                  onDragStart={({ active }) =>
                    setDragging(screen.page.rows.flatMap(row => row.kind === 'custom' ? row.items : []).find(item => item.id === active.id))}
                  onDragCancel={() => setDragging(undefined)}
                  onDragEnd={({ active, over }) => {
                    setDragging(undefined);
                    if (!over || active.id === over.id || disabled || !reorder) return;
                    const target = screen.page.rows.find(row => row.kind === 'custom' && (`lane:${row.id}` === over.id || row.items.some(item => item.id === over.id)));
                    if (target?.study?.status) {
                      return;
                    }
                    if (target?.kind === 'custom') {
                      screen.change(moveScreenItem(
                        screen.page,
                        String(active.id),
                        target.id,
                        over.id === `lane:${target.id}` ? target.items.length : target.items.findIndex(item => item.id === over.id),
                      ));
                    }
                  }}
                >
                  {rows.map(row => (
                    <ScreenLane
                      reorder={reorder}
                      key={row.id}
                      row={row}
                      {...content}
                      facets={facets.facets}
                      disabled={disabled}
                      study={study}
                      graph={row.view === 'graph' ? <GraphPage notebooks={notebooks} lane={row} screen={screen} /> : undefined}
                      onCreateNote={onCreateNote}
                      onAddToFocus={onAddLaneToFocus
                        ? () => onAddLaneToFocus(row)
                        : undefined}
                      onStudy={() => navigate(screenLaneRoute(row.id) + location.search)}
                      onStudyChange={study => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id === row.id ? { ...value, study } : value) })}
                      onAdd={() => setAddTo(row.id)}
                      onView={view => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id === row.id ? { ...value, view } : value) })}
                      onSort={sort => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id !== row.id ? value : { ...value, ...(value.kind === 'dynamic' ? { sort } : {}) }) })}
                      onRemove={id =>
                        screen.change({
                          ...screen.page,
                          rows: screen.page.rows.map(value =>
                            value.kind === 'custom'
                              ? { ...value, items: value.items.filter(item => item.id !== id) }
                              : value
                          ),
                        })}
                    />
                  ))}
                  <DragOverlay>
                    {dragging && (
                      <div className='screen-drag-overlay'>
                        <GripVertical size={16} />
                        {screenItemTitle(dragging, draggedNotes.notes, assets)}
                      </div>
                    )}
                  </DragOverlay>
                </DndContext>
              )}
            </>
          )}
        </div>
      </main>
      {editingRow && (
        <ScreenEditRow
          row={editingRow}
          disabled={disabled}
          notebooks={notebooks}
          assets={assets}
          folders={folders}
          selectedNotebookId={selectedNotebookId}
          onClose={() => setEditing(undefined)}
          onApply={next => screen.change({ ...screen.page, rows: screen.page.rows.map(row => row.id === next.id ? next : row) })}
          onRemove={() => {
            screen.change({ ...screen.page, rows: screen.page.rows.filter(row => row.id !== editingRow.id) });
            if (focusedLaneId === editingRow.id) navigate('/screen' + location.search);
          }}
        />
      )}
      {dialog === 'add' && <ScreenAddRow notebooks={notebooks} assets={assets} folders={folders} selectedNotebookId={selectedNotebookId} onClose={() => setDialog(null)} onAdd={row => screen.change({ ...screen.page, rows: [...screen.page.rows, row] })} />}
      {dialog === 'reload' && (
        <WorkspaceDialog title={t('screen.reload')} onClose={() => setDialog(null)}>
          <p>{t('screen.reloadHint')}</p>
          <div className='workspace-dialog-actions'>
            <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => {
                setDialog(null);
                void screen.reload();
              }}
            >
              {t('screen.reload')}
            </Button>
          </div>
        </WorkspaceDialog>
      )}
      {row?.kind === 'custom' && <ScreenAddItem notebooks={notebooks} assets={assets} folders={folders} rowName={row.name} notebookId={row.notebookId} onClose={() => setAddTo(null)} onAdd={item => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id === row.id && value.kind === 'custom' ? { ...value, items: [...value.items, item] } : value) })} />}
      {itemOpen.preview}
    </div>
  );
}
