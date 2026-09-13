import { useState } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pencil, Zap } from 'lucide-react';
import { moveScreenRow, type ScreenPage, type ScreenRow } from '@github-notes/core/screen-page';
import { useTranslation } from '../lib/i18n/index.js';
import { ScreenIcon } from './ScreenIcon.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';

function LaneLink({ row, disabled, onSelect, onRename }: { row: ScreenRow; disabled: boolean; onSelect: () => void; onRename: () => void }) {
  const { t } = useTranslation();
  const sort = useSortable({ id: row.id, disabled });
  return <div ref={sort.setNodeRef} className="screen-sidebar-lane" style={{ transform: CSS.Transform.toString(sort.transform), transition: sort.transition, opacity: sort.isDragging ? .5 : undefined }}>
    <button type="button" ref={sort.setActivatorNodeRef} {...sort.attributes} {...sort.listeners} disabled={disabled} className="screen-drag-handle ui-icon-button" aria-label={`${t('screen.moveRow')}: ${row.name}`}><GripVertical size={14} /></button>
    <button type="button" className="screen-sidebar-action" onClick={onSelect}>{row.kind === 'dynamic' ? <Zap size={15} /> : <ScreenIcon size={15} />}<span>{row.name}</span></button>
    <button type="button" className="ui-icon-button" disabled={disabled} title={t('screen.renameRow')} aria-label={`${t('screen.renameRow')}: ${row.name}`} onClick={onRename}><Pencil size={14} /></button>
  </div>;
}

export function ScreenLaneNavigation({ page, disabled, onChange, onSelect }: { page: ScreenPage; disabled: boolean; onChange: (page: ScreenPage) => void; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<{id: string; name: string}>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const close = () => { setEditing(undefined); setConfirmRemove(false); };
  return <>
    <nav aria-label={t('screen.lanes')} className="screen-sidebar-lanes">
      <h4>{t('screen.lanes')}</h4>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({active,over}) => {
        if (disabled || !over || active.id === over.id) return;
        const index = page.rows.findIndex(row => row.id === over.id);
        if (index >= 0) onChange(moveScreenRow(page, String(active.id), index));
      }}><SortableContext items={page.rows.map(row => row.id)} strategy={verticalListSortingStrategy}>
        {page.rows.map(row => <LaneLink key={row.id} row={row} disabled={disabled} onSelect={() => onSelect(row.id)} onRename={() => { setEditing({id:row.id,name:row.name}); setConfirmRemove(false); }} />)}
      </SortableContext></DndContext>
    </nav>
    {editing && <WorkspaceDialog title={t('screen.renameRow')} onClose={close}>
      <form className="screen-form" onSubmit={event => {
        event.preventDefault();
        if (disabled || !editing.name.trim()) return;
        onChange({...page, rows:page.rows.map(row => row.id === editing.id ? {...row,name:editing.name.trim()} : row)}); close();
      }}>
        <label>{t('screen.rowName')}<input autoFocus className="ui-control" aria-label={t('screen.rowName')} value={editing.name} maxLength={100} onChange={event => setEditing({...editing,name:event.target.value})} /></label>
        {confirmRemove && <p className="screen-dialog-hint">{t('screen.removeRowHint')}</p>}
        <div className="workspace-dialog-actions">
          <button type="button" className="ui-button" disabled={disabled} onClick={() => {
            if (!confirmRemove) { setConfirmRemove(true); return; }
            onChange({...page,rows:page.rows.filter(row=>row.id!==editing.id)}); close();
          }}>{t(confirmRemove ? 'screen.confirmRemoveRow' : 'screen.removeRow')}</button>
          <button type="button" className="ui-button" onClick={close}>{t('common.cancel')}</button>
          <button className="ui-button ui-button-primary" disabled={disabled || !editing.name.trim()}>{t('screen.apply')}</button>
        </div>
      </form>
    </WorkspaceDialog>}
  </>;
}
