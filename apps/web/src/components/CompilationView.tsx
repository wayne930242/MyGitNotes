import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Copy, GripVertical, LayoutGrid, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { type CompilationItem, type CompilationRow, moveCompilationItem } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { useNoteEditing } from '../lib/note-editing.js';
import { useCompilationActions } from '../lib/compilation-actions.js';
import { planCompilationCopy } from '../lib/compilation-copy.js';
import { screenCollision, screenKeyboardCoordinates } from '../lib/compilation-drag.js';
import { useLaneNotes } from '../lib/compilation-queries.js';
import { useTranslation } from '../lib/i18n/index.js';
import { usePanelContext } from '../lib/panel-context.js';
import { compilationStudyRoute } from '../lib/routes.js';
import type { FolderItem, NotebookConfig } from '../lib/types.js';
import { useNoteFacets } from '../lib/use-note-queries.js';
import { useCompilation } from '../lib/use-compilation.js';
import { useStudyWorkspace } from '../lib/use-study-workspace.js';
import { Button } from './Button.js';
import { type CompilationContentProps, compilationItemTitle } from './CompilationCard.js';
import { CompilationAddItem, CompilationEditRow } from './CompilationDialogs.js';
import { CompilationLane } from './CompilationLane.js';
import { CompilationOrderDialog } from './CompilationOrderDialog.js';
import { CompilationStack } from './CompilationStack.js';
import { LoadingStatus } from './LoadingStatus.js';
import { ReorderToggle } from './ReorderToggle.js';
import { useCompilationAssets, useCompilationItemOpen } from './useCompilationItemOpen.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';

const GraphPage = lazy(() => import('./GraphPage.js').then(module => ({ default: module.GraphPage })));
const ignoreSaved = () => {};

export interface CompilationViewProps {
  notebookId: string;
  path: string;
  notebooks: NotebookConfig[];
  folders: FolderItem[];
  /** `zoom` is the full-screen dialog; `pane` fills a Focus pane. */
  frame: 'zoom' | 'pane';
  /** Opens a pinned note where the host opens notes. */
  onOpenNote: (note: NoteListItem) => void;
  /** Opens a pinned folder inside the Notes page; false lets the item navigate to it. */
  onOpenFolder?: (item: Extract<CompilationItem, { kind: 'folder'; }>) => boolean;
  /** Closes the view: the zoom dialog, or the Focus tab once the file is deleted. */
  onClose?: () => void;
}

/** One open compilation: its header, then the lane, stack or graph arrangement. Edits write the file through the note actions. */
export function CompilationView({ notebookId, path, notebooks, folders, frame, onOpenNote, onOpenFolder, onClose }: CompilationViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const editing = useNoteEditing();
  const actions = useCompilationActions();
  const compilation = useCompilation({ notebookId, path }, notebooks);
  const study = useStudyWorkspace(actions.repository(notebookId), ignoreSaved);
  const { assets, error: assetError } = useCompilationAssets(notebooks, notebookId);
  const facets = useNoteFacets(false);
  const [dialog, setDialog] = useState<'edit' | 'add' | 'delete' | 'order' | null>(null);
  const [reorder, setReorder] = useState(false);
  const [dragging, setDragging] = useState<CompilationItem>();
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState('');
  const row = compilation.page.rows[0] as CompilationRow | undefined;
  const itemOpen = useCompilationItemOpen({ notebooks, assets, onOpenNote, onMissing: () => setMissing(true) });
  const draggedNotes = useLaneNotes(dragging ? row : undefined);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: screenKeyboardCoordinates }));
  const disabled = !compilation.writable || compilation.loading;
  const { setHasOpenNote } = usePanelContext();
  // Like a zoomed note, a zoomed compilation hides the workspace rail before the first paint, so both dialogs share the same edges.
  useLayoutEffect(() => {
    if (frame !== 'zoom') return;
    setHasOpenNote(true);
    return () => setHasOpenNote(false);
  }, [frame, setHasOpenNote]);

  // In zoom the Escape key closes the view, unless a dialog of its own is open.
  useEffect(() => {
    if (frame !== 'zoom' || !onClose) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelectorAll('[role="dialog"]').length > 1) return;
      void editing.flushEditors().then(saved => saved && onClose());
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [frame, onClose, editing]);

  const open: CompilationContentProps['onOpen'] = (item, note) => {
    setMissing(false);
    if (item.kind === 'folder' && onOpenFolder?.(item)) return;
    itemOpen.open(item, note);
  };
  const copy = async () => {
    if (!row) return;
    try {
      const next = await planCompilationCopy(row);
      await actions.create(notebookId, next.path, next.content, next.metadata);
      setNotice(t('compilation.copied', { title: next.title }));
    } catch (error) {
      compilation.setError((error as Error).message);
    }
  };
  const remove = async () => {
    if (!compilation.note) return;
    setDialog(null);
    try {
      await actions.remove(compilation.note);
      onClose?.();
    } catch (error) {
      compilation.setError((error as Error).message);
    }
  };
  const startStudy = async () => {
    if (await editing.flushEditors()) navigate(compilationStudyRoute(notebookId, path));
  };
  const change = (next: CompilationRow) => compilation.change({ rows: [next] });
  const addToFocus = compilation.note ? editing.addToFocus({ ...compilation.note, content: compilation.note.content ?? '' }) : undefined;

  const view = (current: CompilationRow) => {
    const common = {
      row: current,
      notebooks,
      assets,
      onOpen: open,
      disabled,
      readOnly: !compilation.writable,
      study,
      facets: facets.facets,
      onStudy: () => void startStudy(),
      onView: (next: CompilationRow['view']) => change({ ...current, view: next }),
      onStudyChange: (value: NonNullable<CompilationRow['study']>) => change({ ...current, study: value }),
      onAdd: () => setDialog('add'),
      extra: (
        <>
          {!disabled && current.kind === 'custom' && current.view !== 'stack' && current.view !== 'graph' && <ReorderToggle active={reorder} disabled={disabled} onToggle={() => setReorder(value => !value)} />}
          {(compilation.writable || addToFocus) && (
            // Secondary actions share one menu so the header stays on one line in a narrow Focus pane.
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className='ui-icon-button' aria-label={`${t('compilation.more')}: ${current.name}`} title={t('compilation.more')}>
                <MoreHorizontal size={16} aria-hidden='true' />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className='focus-menu'
                  align='end'
                  sideOffset={4}
                  collisionPadding={8}
                  onEscapeKeyDown={event => event.stopPropagation()}
                >
                  {addToFocus && (
                    <DropdownMenu.Item onSelect={addToFocus}>
                      <LayoutGrid size={14} aria-hidden='true' />
                      <span>{t('focus.addTo')}</span>
                    </DropdownMenu.Item>
                  )}
                  {compilation.writable && (
                    <>
                      <DropdownMenu.Item disabled={disabled} onSelect={() => setDialog('edit')}>
                        <Pencil size={14} aria-hidden='true' />
                        <span>{t('screen.editRow')}</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item disabled={disabled} onSelect={() => void copy()}>
                        <Copy size={14} aria-hidden='true' />
                        <span>{t('compilation.copy')}</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item disabled={disabled} onSelect={() => setDialog('delete')}>
                        <Trash2 size={14} aria-hidden='true' />
                        <span>{t('compilation.delete')}</span>
                      </DropdownMenu.Item>
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </>
      ),
      onSort: (sort: NonNullable<Extract<CompilationRow, { kind: 'dynamic'; }>['sort']>) => current.kind === 'dynamic' && change({ ...current, sort }),
      onEditOrder: current.kind === 'dynamic' && compilation.writable ? () => setDialog('order') : undefined,
      onCreateNote: actions.createNote,
    };
    if (current.view === 'stack') return <CompilationStack {...common} />;
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={screenCollision}
        onDragStart={({ active }) =>
          setDragging(
            current.kind === 'custom'
              ? current.items.find(item => item.id === active.id)
              : undefined,
          )}
        onDragCancel={() => setDragging(undefined)}
        onDragEnd={({ active, over }) => {
          setDragging(undefined);
          if (!over || active.id === over.id || disabled || !reorder || current.kind !== 'custom' || current.study?.status) return;
          compilation.change(moveCompilationItem(compilation.page, String(active.id), current.id, over.id === `lane:${current.id}` ? current.items.length : current.items.findIndex(item => item.id === over.id)));
        }}
      >
        <CompilationLane
          {...common}
          reorder={reorder}
          onRemove={id => current.kind === 'custom' && change({ ...current, items: current.items.filter(item => item.id !== id) })}
          graph={current.view === 'graph'
            ? (
              <Suspense fallback={<p role='status'>{t('graph.title')}</p>}>
                <GraphPage notebooks={notebooks} lane={current} screen={compilation} />
              </Suspense>
            )
            : undefined}
        />
        <DragOverlay>
          {dragging && (
            <div className='screen-drag-overlay'>
              <GripVertical size={16} />
              {compilationItemTitle(dragging, draggedNotes.notes, assets)}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    );
  };

  return (
    <div className='compilation-view' data-frame={frame} data-arrangement={row?.view}>
      {frame === 'zoom' && onClose && (
        <div className='compilation-frame-bar'>
          <Button type='button' size='icon' aria-label={t('common.close')} title={t('common.close')} onClick={() => void editing.flushEditors().then(saved => saved && onClose())}>
            <X size={18} />
          </Button>
        </div>
      )}
      <div className='compilation-body'>
        {compilation.error && <p role='alert' className='screen-error'>{compilation.error}</p>}
        {assetError && <p role='alert' className='screen-error'>{t('screen.assetsError')}</p>}
        {missing && <p role='alert' className='screen-error'>{t('screen.missing')}</p>}
        {notice && <p role='status' className='screen-dialog-hint'>{notice}</p>}
        {compilation.loading ? <LoadingStatus>{t('screen.loading')}</LoadingStatus> : compilation.missing ? <p role='alert' className='screen-error'>{t('compilation.notFound')}</p> : !row
          ? (
            <div className='screen-board-empty' role='alert'>
              <h3>{compilation.invalid[0]?.title ?? path.split('/').pop()}</h3>
              <p>{t('compilation.invalid')}</p>
              <p className='screen-form-error'>{compilation.invalid[0]?.error}</p>
            </div>
          )
          : view(row)}
      </div>
      {row && dialog === 'edit' && <CompilationEditRow row={row} disabled={disabled} notebooks={notebooks} assets={assets} folders={folders} selectedNotebookId={notebookId} onClose={() => setDialog(null)} onApply={change} onRemove={() => setDialog('delete')} />}
      {row?.kind === 'custom' && dialog === 'add' && <CompilationAddItem notebooks={notebooks} assets={assets} folders={folders} rowName={row.name} notebookId={row.notebookId} onClose={() => setDialog(null)} onAdd={item => change({ ...row, items: [...row.items, item] })} />}
      {row?.kind === 'dynamic' && dialog === 'order' && <CompilationOrderDialog row={row} notebooks={notebooks} assets={assets} disabled={disabled} onClose={() => setDialog(null)} onSave={order => change({ ...row, sort: { field: 'manual', order: 'asc' }, manualOrder: order })} />}
      {row && dialog === 'delete' && (
        <WorkspaceDialog title={t('compilation.delete')} onClose={() => setDialog(null)}>
          <p>{t('compilation.deleteHint', { title: row.name })}</p>
          <div className='workspace-dialog-actions'>
            <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
            <Button variant='primary' onClick={() => void remove()}>{t('compilation.delete')}</Button>
          </div>
        </WorkspaceDialog>
      )}
      {itemOpen.preview}
    </div>
  );
}
