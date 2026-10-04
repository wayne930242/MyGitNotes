import { useState } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { CompilationItem, CompilationRow } from '@mygitnotes/core/compilation';
import { compilationRowItems } from '../lib/compilation-content.js';
import { useLaneNotes } from '../lib/compilation-queries.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { NotebookConfig } from '../lib/types.js';
import { Button } from './Button.js';
import { type CompilationAsset, compilationItemTitle } from './CompilationCard.js';
import { LoadingStatus } from './LoadingStatus.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';

type DynamicRow = Extract<CompilationRow, { kind: 'dynamic'; }>;

interface CompilationOrderDialogProps {
  row: DynamicRow;
  notebooks: NotebookConfig[];
  assets: CompilationAsset[];
  disabled: boolean;
  /** Receives every member path, in the order the user set. */
  onSave: (order: string[]) => void;
  onClose: () => void;
}

interface OrderEntry {
  item: CompilationItem & { path: string; };
  title: string;
}

/** Sets a dynamic compilation's manual order: it opens on a snapshot of the current order and saves the rearranged paths. */
export function CompilationOrderDialog({ row, notebooks, assets, disabled, onSave, onClose }: CompilationOrderDialogProps) {
  const { t } = useTranslation();
  // Every member, whatever the study filter shows, so the saved order leaves none of them behind.
  const members = { ...row, study: undefined };
  const lane = useLaneNotes(members, { all: true });
  const [entries, setEntries] = useState<OrderEntry[] | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  // The snapshot is taken once, when the members arrive; later refetches do not reset what the user arranged.
  if (entries === null && !lane.loading && !lane.error) {
    const items = compilationRowItems(members, lane.notes, assets, notebooks).flatMap(item => item.kind === 'youtube' ? [] : [{ item, title: compilationItemTitle(item, lane.notes, assets) }]);
    setEntries(items);
  }

  return (
    <WorkspaceDialog title={`${t('compilation.editOrder')}: ${row.name}`} className='compilation-order-dialog' onClose={onClose}>
      <p className='screen-dialog-hint'>{t('compilation.orderHint')}</p>
      {lane.error && <p role='alert' className='screen-error'>{lane.error}</p>}
      {!entries ? !lane.error && <LoadingStatus>{t('screen.loading')}</LoadingStatus> : entries.length === 0 ? <p className='screen-dialog-hint'>{t('compilation.orderEmpty')}</p> : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (!over || active.id === over.id) return;
            setEntries(current => {
              if (!current) return current;
              const from = current.findIndex(entry => entry.item.id === active.id);
              const to = current.findIndex(entry =>
                entry.item.id === over.id
              );
              return from < 0 || to < 0 ? current : arrayMove(current, from, to);
            });
          }}
        >
          <SortableContext items={entries.map(entry => entry.item.id)} strategy={verticalListSortingStrategy}>
            <ol className='compilation-order-list' aria-label={t('compilation.editOrder')}>{entries.map((entry, index) => <OrderRow key={entry.item.id} entry={entry} index={index} />)}</ol>
          </SortableContext>
        </DndContext>
      )}
      <div className='workspace-dialog-actions'>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant='primary'
          disabled={disabled || !entries?.length}
          onClick={() => {
            if (!entries) return;
            onSave(entries.map(entry => entry.item.path));
            onClose();
          }}
        >
          {t('compilation.orderSave')}
        </Button>
      </div>
    </WorkspaceDialog>
  );
}

function OrderRow({ entry, index }: { entry: OrderEntry; index: number; }) {
  const { t } = useTranslation();
  const sort = useSortable({ id: entry.item.id });
  /* eslint-disable react/refs -- dnd-kit sortable bindings are callback refs and render state, forwarded to the row and its handle. */
  return (
    <li ref={sort.setNodeRef} className='compilation-order-row' data-dragging={sort.isDragging || undefined} style={{ transform: CSS.Transform.toString(sort.transform), transition: sort.transition }}>
      <Button type='button' size='icon' ref={sort.setActivatorNodeRef} {...sort.attributes} {...sort.listeners} className='screen-drag-handle' aria-label={`${t('screen.moveItem')}: ${entry.title}`}>
        <GripVertical size={16} aria-hidden='true' />
      </Button>
      <span className='compilation-order-index'>{index + 1}</span>
      <span className='compilation-order-title'>{entry.title}</span>
    </li>
  );
  /* eslint-enable react/refs */
}
