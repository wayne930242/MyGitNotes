import { ReorderToggle } from './ReorderToggle.js';
import { useEffect, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { Folder, FolderPlus, GripVertical, MoreHorizontal } from 'lucide-react';
import type { FolderCommand } from '@mygitnotes/core';
import type { FolderItem } from '../lib/types.js';
import { folderDropCommand } from '../lib/folder-drag.js';
import { useTranslation } from '../lib/i18n/index.js';

function DropZone({ path, position, disabled, children }: { path: string; position: 'before' | 'after' | 'inside'; disabled: boolean; children?: React.ReactNode }) {
  const drop = useDroppable({ id: `${position}:${path}`, disabled, data: { path, position } });
  return <div ref={drop.setNodeRef} data-folder-drop={`${position}:${path}`} className={`${position === 'inside' ? 'folder-drop-body' : 'folder-drop-line'} ${drop.isOver ? 'is-over' : ''}`}>{children}</div>;
}
function TreeItem({ folder, reorder, disabled, selected, onSelect, onManage }: { folder: FolderItem; reorder: boolean; disabled: boolean; selected: boolean; onSelect: () => void; onManage: () => void }) {
  const { t } = useTranslation();
  const drag = useDraggable({ id: folder.path, disabled: disabled || !reorder });
  return <div ref={drag.setNodeRef} className={`folder-tree-item ${selected ? 'is-selected' : ''}`} style={{ marginLeft: (folder.path.split('/').length - 1) * 14, opacity: drag.isDragging ? .35 : undefined }}>
    <DropZone path={folder.path} position="before" disabled={disabled || !reorder} />
    <DropZone path={folder.path} position="inside" disabled={disabled || !reorder}>
      {!disabled && reorder && <button type="button" className="folder-grip" ref={drag.setActivatorNodeRef} {...drag.listeners} {...drag.attributes} aria-label={`${t('folder.move')}: ${folder.title}`}><GripVertical size={12} /></button>}
      <button type="button" className="folder-tree-select" aria-pressed={selected} title={folder.description || folder.path} onClick={onSelect}><Folder size={16} /><span>{folder.title}</span></button>
      {!disabled && <button type="button" className="folder-manage" aria-label={`${t('folder.manage')}: ${folder.title}`} onClick={onManage}><MoreHorizontal size={15} /></button>}
    </DropZone>
    <DropZone path={folder.path} position="after" disabled={disabled || !reorder} />
  </div>;
}
export function FolderTree({ onManageFiles, reorder = false, onToggleReorder, selectedPaths, allFoldersSelected, onFilterFolder, folders, notebookId, selected, onSelect, writable, beforeChange, onChanged }: {
  onManageFiles: (path: string) => void;
  reorder?: boolean;
  onToggleReorder?: () => void;
  selectedPaths?: string[];
  allFoldersSelected?: boolean;
  onFilterFolder?: (folder: string | null) => void;
  folders: FolderItem[]; notebookId: string; selected: string | null; onSelect: (folder: string | null) => void;
  writable: boolean; beforeChange?: () => void; onChanged?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [revision, setRevision] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [dragging, setDragging] = useState<string>();
  const selectFolder = onFilterFolder || onSelect;
  const isSelected = (path: string | null) => selectedPaths ? path === null ? (allFoldersSelected ?? selectedPaths.length === 0) : selectedPaths.includes(path) : selected === path;
  const list = folders.filter(folder => folder.notebookId === notebookId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const refresh = async () => {
    const response = await fetch('/api/folder-manager'); const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('folder.failed'));
    setRevision(data.revision); return data.revision as string;
  };
  useEffect(() => { setError(''); setRevision(''); if (writable) void refresh().catch(error => setError(error.message)); }, [notebookId, folders, writable]);
  const mutate = async (command: FolderCommand) => {
    if (busy || !writable) return;
    setBusy(true); setError('');
    try {
      beforeChange?.();
      const response = await fetch('/api/folder-manager', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, revision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('folder.failed'));
      setRevision(data.revision);
      await onChanged?.();
      onSelect(data.selectedPath || null);
    } catch (error) {
      setError((error as Error).message);
    }
    finally { setBusy(false); }
  };
  const disabled = !writable || busy || !revision;
  const errorMessage = error && <div role="alert" className="folder-error">{error}<button type="button" className="ui-button" onClick={() => { void refresh().then(() => { setError(''); return onChanged?.(); }).catch(error => setError(error.message)); }}>{t('folder.reload')}</button></div>;
  return <section aria-label={t('folder.folders')}>
    <div className="folder-tree-heading"><h4>{t('folder.folders')}</h4>{writable && <div className="folder-heading-actions">{onToggleReorder && <ReorderToggle active={reorder} onToggle={onToggleReorder} disabled={busy} />}<button type="button" className="ui-icon-button" disabled={busy} aria-label={t('folder.create')} onClick={() => onManageFiles(selected || '')}><FolderPlus size={16} /></button></div>}</div>
    {errorMessage}
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={({ active }) => setDragging(String(active.id))} onDragCancel={() => setDragging(undefined)} onDragEnd={({ active, over }) => {
      setDragging(undefined); if (!over || disabled || !reorder) return;
      const data = over.data.current;
      const command = folderDropCommand(notebookId, String(active.id), data?.path || '', data?.position || 'inside', list);
      if (command) void mutate(command);
    }}>
      <DropZone path="" position="inside" disabled={disabled || !reorder}><button type="button" className={`folder-tree-root ${isSelected(null) ? 'is-selected' : ''}`} aria-pressed={isSelected(null)} onClick={() => selectFolder(null)}>{t('folder.allFolders')}</button></DropZone>
      {list.map(folder => <TreeItem reorder={reorder} key={folder.path} folder={folder} disabled={disabled} selected={isSelected(folder.path)} onSelect={() => selectFolder(folder.path)} onManage={() => onManageFiles(folder.path)} />)}
      <DragOverlay>{dragging && <div className="screen-drag-overlay"><Folder size={16} />{list.find(folder => folder.path === dragging)?.title}</div>}</DragOverlay>
    </DndContext>
  </section>;
}
