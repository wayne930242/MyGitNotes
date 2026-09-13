import { useState } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Zap } from 'lucide-react';
import { parseYouTubeUrl, type ScreenItem, type ScreenRow } from '@github-notes/core/screen-page';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { Select } from './Select.js';
import type { ScreenContentProps } from './ScreenCard.js';
import type { FolderItem } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { screenFolderOptions } from '../lib/screen-content.js';

export function ScreenAddRow({ notebooks, notes, assets, folders, selectedNotebookId, onAdd, onClose }: Pick<ScreenContentProps, 'notebooks' | 'notes' | 'assets'> & {
  folders: FolderItem[]; selectedNotebookId: string; onAdd: (row: ScreenRow) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState('custom'), [name, setName] = useState(''), [tag, setTag] = useState('');
  const [notebookId, setNotebook] = useState(selectedNotebookId), [folder, setFolder] = useState(''), [recursive, setRecursive] = useState(true);
  const [allNotebooks, setAllNotebooks] = useState(true);
  const nb = notebooks.find(nb => nb.id === notebookId);
  return <WorkspaceDialog title={t('screen.addRow')} onClose={onClose}>
    <form className="screen-form" onSubmit={event => {
      event.preventDefault();
      const base = { id: crypto.randomUUID(), name: name.trim() || t(kind === 'custom' ? 'screen.custom' : 'screen.dynamic'), view: 'small' as const };
      onAdd(kind === 'custom' ? { ...base, kind: 'custom', items: [] } : { ...base, kind: 'dynamic', source: kind === 'tag'
        ? { kind: 'tag', tag: tag.trim(), ...(allNotebooks ? {} : { notebookId }) }
        : { kind: 'folder', notebookId, path: folder || nb!.root, recursive } });
      onClose();
    }}>
      <label>{t('screen.rowName')}<input className="ui-control" value={name} maxLength={100} onChange={e => setName(e.target.value)} autoFocus /></label>
      <label>{t('screen.rowType')}<Select value={kind} onValueChange={setKind} options={[{ value: 'custom', label: t('screen.custom') }, { value: 'tag', label: t('screen.tagRow') }, { value: 'folder', label: t('screen.folderRow') }]} /></label>
      {kind === 'tag' && <><label>{t('screen.tag')}<input className="ui-control" value={tag} onChange={e => setTag(e.target.value)} list="screen-tags" required maxLength={200} /></label>
        <datalist id="screen-tags">{[...new Set(notes.flatMap(note => note.tags))].sort().map(tag => <option key={tag} value={tag} />)}</datalist>
        <label className="screen-checkbox"><input type="checkbox" checked={allNotebooks} onChange={e => setAllNotebooks(e.target.checked)} />{t('screen.allNotebooks')}</label></>}
      {(kind === 'folder' || kind === 'tag' && !allNotebooks) && <label>{t('sidebar.notebooks')}<Select value={notebookId} onValueChange={id => { setNotebook(id); setFolder(''); }} options={notebooks.map(nb => ({ value: nb.id, label: nb.title }))} /></label>}
      {kind === 'folder' && <><label>{t('folder.folders')}<Select value={folder || nb?.root || ''} onValueChange={setFolder} options={screenFolderOptions(nb, folders, assets).map(folder => ({ value: folder.path, label: folder.title }))} /></label>
        <label className="screen-checkbox"><input type="checkbox" checked={recursive} onChange={e => setRecursive(e.target.checked)} />{t('screen.recursive')}</label></>}
      <div className="workspace-dialog-actions"><button className="ui-button" type="button" onClick={onClose}>{t('common.cancel')}</button><button className="ui-button ui-button-primary" disabled={kind === 'folder' && !nb || kind === 'tag' && !tag.trim()}>{t('screen.addRow')}</button></div>
    </form>
  </WorkspaceDialog>;
}

function RowEditor({ row, onChange, onRemove }: { row: ScreenRow; onChange: (value: string) => void; onRemove: () => void }) {
  const { t } = useTranslation(); const sort = useSortable({ id: row.id });
  return <div ref={sort.setNodeRef} style={{ transform: CSS.Transform.toString(sort.transform), transition: sort.transition }} className="screen-row-editor">
    <button type="button" ref={sort.setActivatorNodeRef} {...sort.attributes} {...sort.listeners} className="screen-drag-handle ui-icon-button" aria-label={`${t('screen.moveRow')}: ${row.name}`}><GripVertical /></button>
    {row.kind === 'dynamic' && <Zap size={14} />}
    <input className="ui-control" aria-label={t('screen.rowName')} value={row.name} maxLength={100} onChange={e => onChange(e.target.value)} />
    <button type="button" className="ui-icon-button" aria-label={`${t('screen.removeRow')}: ${row.name}`} onClick={onRemove}><Trash2 size={16} /></button>
  </div>;
}

export function ScreenEditRows({ rows, onApply, onClose }: { rows: ScreenRow[]; onApply: (rows: ScreenRow[]) => void; onClose: () => void }) {
  const { t } = useTranslation(); const [draft, setDraft] = useState(rows);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  return <WorkspaceDialog title={t('screen.editRows')} onClose={onClose}>
    <p className="screen-dialog-hint">{t('screen.editRowsHint')}</p>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
      if (over && active.id !== over.id) setDraft(rows => arrayMove(rows, rows.findIndex(row => row.id === active.id), rows.findIndex(row => row.id === over.id)));
    }}><SortableContext items={draft.map(row => row.id)} strategy={verticalListSortingStrategy}>
      <div className="screen-row-editors">{draft.map(row => <RowEditor key={row.id} row={row}
        onChange={name => setDraft(rows => rows.map(value => value.id === row.id ? { ...value, name } : value))}
        onRemove={() => setDraft(rows => rows.filter(value => value.id !== row.id))} />)}</div>
    </SortableContext></DndContext>
    <div className="workspace-dialog-actions"><button className="ui-button" onClick={onClose}>{t('common.cancel')}</button><button className="ui-button ui-button-primary" disabled={draft.some(row => !row.name.trim())} onClick={() => { onApply(draft); onClose(); }}>{t('screen.apply')}</button></div>
  </WorkspaceDialog>;
}

export function ScreenAddItem({ rowName, notebooks, notes, assets, folders, selectedNotebookId, onAdd, onClose }: Omit<ScreenContentProps, 'onOpen'> & {
  rowName: string; folders: FolderItem[]; selectedNotebookId: string; onAdd: (item: ScreenItem) => void; onClose: () => void;
}) {
  const { t } = useTranslation(); const [kind, setKind] = useState('note');
  const [notebookId, setNotebook] = useState(selectedNotebookId), [query, setQuery] = useState(''), [youtube, setYoutube] = useState(''), [title, setTitle] = useState('');
  const nb = notebooks.find(nb => nb.id === notebookId);
  const options = kind === 'note' ? notes.filter(note => note.notebookId === notebookId).map(note => ({ path: note.path, title: note.title }))
    : kind === 'asset' ? assets.filter(asset => asset.notebookId === notebookId).map(asset => ({ path: asset.path, title: asset.name }))
    : screenFolderOptions(nb, folders, assets);
  const video = parseYouTubeUrl(youtube);
  return <WorkspaceDialog title={`${t('screen.addItem')} · ${rowName}`} onClose={onClose}>
    <div className="screen-form">
      <label>{t('screen.itemType')}<Select value={kind} onValueChange={setKind} options={[{ value: 'note', label: t('nav.notes') }, { value: 'folder', label: t('folder.folders') }, { value: 'asset', label: t('nav.assets') }, { value: 'youtube', label: 'YouTube' }]} /></label>
      {kind === 'youtube' ? <><label>YouTube URL<input autoFocus className="ui-control" type="url" value={youtube} onChange={e => setYoutube(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></label>
        <label>{t('screen.videoTitle')}<input className="ui-control" maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></label>
        {youtube && !video && <p className="screen-form-error">{t('screen.invalidVideo')}</p>}
        <div className="workspace-dialog-actions"><button className="ui-button ui-button-primary" disabled={!video} onClick={() => { if (video) { onAdd({ id: crypto.randomUUID(), kind: 'youtube', ...video, title: title.trim() || 'YouTube' }); onClose(); } }}>{t('screen.pin')}</button></div>
      </> : <><label>{t('sidebar.notebooks')}<Select value={notebookId} onValueChange={id => { setNotebook(id); setQuery(''); }} options={notebooks.map(nb => ({ value: nb.id, label: nb.title }))} /></label>
        <input className="ui-control" type="search" aria-label={t('screen.findItem')} placeholder={t('screen.findItem')} value={query} onChange={e => setQuery(e.target.value)} />
        <div className="screen-item-options">{options.filter(option => `${option.title} ${option.path}`.toLowerCase().includes(query.toLowerCase())).map(option => <button className="screen-item-option" key={option.path} onClick={() => {
          onAdd({ id: crypto.randomUUID(), kind: kind as 'note' | 'asset' | 'folder', notebookId, path: option.path }); onClose();
        }}><span>{option.title}</span><small>{option.path}</small></button>)}</div></>}
    </div>
  </WorkspaceDialog>;
}
