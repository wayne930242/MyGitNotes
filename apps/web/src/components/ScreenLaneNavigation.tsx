import { useState } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pencil, Zap } from 'lucide-react';
import { moveScreenRow, type ScreenPage, type ScreenRow } from '@github-notes/core/screen-page';
import { useTranslation } from '../lib/i18n/index.js';
import { ScreenIcon } from './ScreenIcon.js';
import { ScreenEditRow } from './ScreenDialogs.js';
import type { ScreenAsset } from './ScreenCard.js';
import type { FolderItem, NoteItem, NotebookConfig } from '../lib/types.js';

function LaneLink({ row, disabled, onSelect, onEdit }: { row: ScreenRow; disabled: boolean; onSelect: () => void; onEdit: () => void }) {
  const { t } = useTranslation();
  const sort = useSortable({ id: row.id, disabled });
  return <div ref={sort.setNodeRef} className="screen-sidebar-lane" style={{ transform: CSS.Transform.toString(sort.transform), transition: sort.transition, opacity: sort.isDragging ? .5 : undefined }}>
    <button type="button" ref={sort.setActivatorNodeRef} {...sort.attributes} {...sort.listeners} disabled={disabled} className="screen-drag-handle ui-icon-button" aria-label={`${t('screen.moveRow')}: ${row.name}`}><GripVertical size={14} /></button>
    <button type="button" className="screen-sidebar-action" onClick={onSelect}>{row.kind === 'dynamic' ? <Zap size={15} /> : <ScreenIcon size={15} />}<span>{row.name}</span></button>
    <button type="button" className="ui-icon-button" disabled={disabled} title={t('screen.editRow')} aria-label={`${t('screen.editRow')}: ${row.name}`} onClick={onEdit}><Pencil size={14} /></button>
  </div>;
}

export function ScreenLaneNavigation({ page, disabled, notebooks, notes, assets, folders, selectedNotebookId, onChange, onSelect }: {
  page: ScreenPage;
  disabled: boolean;
  notebooks: NotebookConfig[];
  notes: NoteItem[];
  assets: ScreenAsset[];
  folders: FolderItem[];
  selectedNotebookId: string;
  onChange: (page: ScreenPage) => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string>();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const close = () => setEditing(undefined);
  const editingRow = page.rows.find(row => row.id === editing);
  return <>
    <nav aria-label={t('screen.lanes')} className="screen-sidebar-lanes">
      <h4>{t('screen.lanes')}</h4>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({active,over}) => {
        if (disabled || !over || active.id === over.id) return;
        const index = page.rows.findIndex(row => row.id === over.id);
        if (index >= 0) onChange(moveScreenRow(page, String(active.id), index));
      }}><SortableContext items={page.rows.map(row => row.id)} strategy={verticalListSortingStrategy}>
        {page.rows.map(row => <LaneLink key={row.id} row={row} disabled={disabled} onSelect={() => onSelect(row.id)} onEdit={() => setEditing(row.id)} />)}
      </SortableContext></DndContext>
    </nav>
    {editingRow && <ScreenEditRow row={editingRow} disabled={disabled} notebooks={notebooks} notes={notes} assets={assets} folders={folders} selectedNotebookId={selectedNotebookId} onClose={close}
      onApply={next => { if (!disabled) onChange({ ...page, rows: page.rows.map(row => row.id === next.id ? next : row) }); }}
      onRemove={() => { if (!disabled) onChange({ ...page, rows: page.rows.filter(row => row.id !== editingRow.id) }); }} />}
  </>;
}
