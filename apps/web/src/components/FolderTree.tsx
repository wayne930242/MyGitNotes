import { useEffect, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { Folder, FolderPlus, GripVertical, MoreHorizontal, ArrowRight, Trash2, FileText } from 'lucide-react';
import type { FolderCommand } from '@github-notes/core';
import type { FolderItem } from '../lib/types.js';
import { folderDropCommand, folderParent } from '../lib/folder-drag.js';
import { useTranslation } from '../lib/i18n/index.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { Select } from './Select.js';

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
export function FolderTree({ reorder = false, folders, notebookId, selected, onSelect, writable, beforeChange, onChanged, indexFolders, onOpenIndex }: {
  reorder?: boolean;
  folders: FolderItem[]; notebookId: string; selected: string | null; onSelect: (folder: string | null) => void;
  indexFolders: string[]; onOpenIndex: (folder: string, revision?: string) => Promise<void>;
  writable: boolean; beforeChange?: () => void; onChanged?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<{ kind: 'manage' | 'create' | 'move' | 'delete'; path: string }>();
  const [createIndex, setCreateIndex] = useState(false);
  const [parent, setParent] = useState(''), [name, setName] = useState(''), [before, setBefore] = useState('');
  const [revision, setRevision] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [dragging, setDragging] = useState<string>();
  const list = folders.filter(folder => folder.notebookId === notebookId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const refresh = async () => {
    const response = await fetch('/api/folder-manager'); const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('folder.failed'));
    setRevision(data.revision); return data.revision as string;
  };
  useEffect(() => { setDialog(undefined); setError(''); setRevision(''); if (writable) void refresh().catch(error => setError(error.message)); }, [notebookId, folders, writable]);
  const open = (kind: 'manage' | 'create' | 'move' | 'delete', path: string) => {
    setCreateIndex(false); setError(''); setName(''); setBefore(''); setParent(kind === 'create' ? path : folderParent(path)); setDialog({ kind, path });
  };
  const mutate = async (command: FolderCommand) => {
    if (busy || !writable) return;
    setBusy(true); setError('');
    let createdPath: string | undefined;
    try {
      beforeChange?.();
      const response = await fetch('/api/folder-manager', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, revision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('folder.failed'));
      if (command.kind === 'create') createdPath = data.selectedPath;
      setRevision(data.revision); setDialog(undefined);
      await onChanged?.();
      if (command.kind === 'create' && createIndex) await onOpenIndex(data.selectedPath, data.revision);
      else onSelect(data.selectedPath || null);
    } catch (error) {
      if (createdPath) setDialog({ kind: 'manage', path: createdPath });
      setError(createdPath ? t('folder.indexFailed', { error: (error as Error).message }) : (error as Error).message);
    }
    finally { setBusy(false); }
  };
  const openIndex = async (path: string) => {
    if (busy || !writable) return;
    setBusy(true); setError('');
    try { await onOpenIndex(path); setDialog(undefined); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const disabled = !writable || busy || !revision;
  const target = dialog && list.find(folder => folder.path === dialog.path);
  const destinationOptions = [{ value: '', label: t('folder.notebookRoot') }, ...list.filter(folder => dialog?.kind === 'create' || folder.path !== dialog?.path && !folder.path.startsWith(dialog?.path + '/')).map(folder => ({ value: folder.path, label: folder.path.split('/').slice(0, -1).concat(folder.title).join(' / ') }))];
  const errorMessage = error && <div role="alert" className="folder-error">{error}<button type="button" className="ui-button" onClick={() => { void refresh().then(() => { setError(''); return onChanged?.(); }).catch(error => setError(error.message)); }}>{t('folder.reload')}</button></div>;
  return <section aria-label={t('folder.folders')}>
    <div className="folder-tree-heading"><h4>{t('folder.folders')}</h4>{writable && <button type="button" className="ui-icon-button" disabled={busy} aria-label={t('folder.create')} onClick={() => open('create', selected || '')}><FolderPlus size={16} /></button>}</div>
    {!dialog && errorMessage}
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={({ active }) => setDragging(String(active.id))} onDragCancel={() => setDragging(undefined)} onDragEnd={({ active, over }) => {
      setDragging(undefined); if (!over || disabled || !reorder) return;
      const data = over.data.current;
      const command = folderDropCommand(notebookId, String(active.id), data?.path || '', data?.position || 'inside', list);
      if (command) void mutate(command);
    }}>
      <DropZone path="" position="inside" disabled={disabled || !reorder}><button type="button" className={`folder-tree-root ${selected === null ? 'is-selected' : ''}`} aria-pressed={selected === null} onClick={() => onSelect(null)}>{t('folder.allFolders')}</button></DropZone>
      {list.map(folder => <TreeItem reorder={reorder} key={folder.path} folder={folder} disabled={disabled} selected={selected === folder.path} onSelect={() => onSelect(folder.path)} onManage={() => open('manage', folder.path)} />)}
      <DragOverlay>{dragging && <div className="screen-drag-overlay"><Folder size={16} />{list.find(folder => folder.path === dragging)?.title}</div>}</DragOverlay>
    </DndContext>
    {dialog && <WorkspaceDialog title={dialog.kind === 'manage' ? target?.title || dialog.path : t(`folder.${dialog.kind}`)} onClose={() => { if (!busy) setDialog(undefined); }}>
      {dialog.kind === 'manage' ? <div className="folder-dialog-actions">
        <button className="ui-button" disabled={busy} onClick={() => void openIndex(dialog.path)}><FileText size={16} />{t(indexFolders.includes(dialog.path) ? 'folder.editIndex' : 'folder.createIndex')}</button>
        <button className="ui-button" disabled={busy} onClick={() => open('create', dialog.path)}><FolderPlus size={16} />{t('folder.createChild')}</button>
        <button className="ui-button" disabled={busy} onClick={() => open('move', dialog.path)}><ArrowRight size={16} />{t('folder.move')}</button>
        <button className="ui-button ui-button-danger" disabled={busy} onClick={() => open('delete', dialog.path)}><Trash2 size={16} />{t('folder.delete')}</button>
        {errorMessage}
      </div> : <form className="screen-form" onSubmit={event => {
        event.preventDefault();
        void mutate(dialog.kind === 'create' ? { kind: 'create', notebookId, parent, name: name.trim(), title: name.trim() } : dialog.kind === 'delete' ? { kind: 'delete', notebookId, path: dialog.path, destination: parent } : { kind: 'move', notebookId, path: dialog.path, parent, ...(before ? { before } : {}) });
      }}>
        {dialog.kind === 'create' ? <label>{t('folder.name')}<input autoFocus className="ui-control" value={name} onChange={event => setName(event.target.value)} required maxLength={120} /></label> : <p className="screen-dialog-hint">{target?.title || dialog.path}</p>}
        {dialog.kind === 'create' && <label className="screen-checkbox"><input type="checkbox" name="createIndex" checked={createIndex} disabled={busy} onChange={event => setCreateIndex(event.target.checked)} />{t('folder.createIndexAfter')}</label>}
        {dialog.kind === 'delete' && <p>{t('folder.deleteHint')}</p>}
        <label>{t(dialog.kind === 'delete' ? 'folder.moveContentsTo' : 'folder.parent')}<Select aria-label={t(dialog.kind === 'delete' ? 'folder.moveContentsTo' : 'folder.parent')} value={parent} onValueChange={value => { setParent(value); setBefore(''); }} options={destinationOptions} disabled={busy} /></label>
        {dialog.kind === 'move' && <label>{t('folder.position')}<Select aria-label={t('folder.position')} value={before} onValueChange={setBefore} options={[{ value: '', label: t('folder.last') }, ...list.filter(folder => folderParent(folder.path) === parent && folder.path !== dialog.path).map(folder => ({ value: folder.path, label: t('folder.before', { name: folder.title }) }))]} disabled={busy} /></label>}
        {errorMessage}
        <div className="workspace-dialog-actions"><button type="button" className="ui-button" disabled={busy} onClick={() => setDialog(undefined)}>{t('common.cancel')}</button><button className="ui-button ui-button-primary" type="submit" disabled={disabled || dialog.kind === 'create' && !name.trim()}>{t(busy ? 'screen.saving' : dialog.kind === 'delete' ? 'folder.confirmDelete' : 'common.save')}</button></div>
      </form>}
    </WorkspaceDialog>}
  </section>;
}
