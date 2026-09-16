import { useEffect, useRef, useState } from 'react';
import { Folder, File, FolderPlus, Upload, CornerLeftUp, FolderInput, Trash2, Download, X, Copy } from 'lucide-react';
import { r2PreviewType } from '@mygitnotes/core/r2-references';
import { Button } from './Button.js';
import { Preview } from './FilePreview.js';
import { copyToClipboard } from '../lib/clipboard.js';
import { createR2Folder, deleteR2, fetchR2References, moveR2, r2RawUrl, uploadR2, type R2Listing, type R2References } from '../lib/r2-api.js';
import { useTranslation } from '../lib/i18n/index.js';

export interface R2PanelProps {
  notebookId: string;
  listing: R2Listing;
  /** Current folder key without a trailing slash; the notebook root is the prefix without its slash. */
  directory: string;
  mutable: boolean;
  showHidden: boolean;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<boolean>;
  onNavigate: (directory: string) => void;
  onRefresh: () => Promise<R2Listing | undefined>;
  /** Guards unsaved workspace edits before a move rewrites notes. */
  beforeChange?: () => Promise<void>;
  /** Reloads workspace views after a move rewrote notes. */
  onNotesChanged: () => Promise<void>;
  onInsert?: (reference: string) => void;
}
type Operation = 'mkdir' | 'move' | 'delete';
const parentOf = (key: string) => key.slice(0, key.lastIndexOf('/'));
const basename = (key: string) => key.slice(key.lastIndexOf('/') + 1);

/** Markdown for an R2 reference: previewable media embed, anything else links. */
export function r2Reference(key: string) {
  const label = basename(key).replace(/[\\[\]]/g, '\\$&');
  return `${r2PreviewType(key).kind === 'file' ? '' : '!'}[${label}](<r2:${key}>)`;
}

/** R2 folder listings derived from flat object keys. */
export function r2Folders(listing: R2Listing, showHidden: boolean) {
  const root = listing.prefix.slice(0, -1), folders = new Set<string>();
  for (const { key } of listing.objects) {
    const parts = key.split('/');
    for (let index = 2; index < parts.length; index++) {
      const folder = parts.slice(0, index).join('/');
      if (showHidden || !basename(folder).startsWith('.')) folders.add(folder);
    }
  }
  return { root, folders: [...folders].sort() };
}

export function R2Panel({ notebookId, listing, directory, mutable, showHidden, busy, run, onNavigate, onRefresh, beforeChange, onNotesChanged, onInsert }: R2PanelProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(''), [operation, setOperation] = useState<Operation>();
  const [name, setName] = useState(''), [destination, setDestination] = useState(''), [references, setReferences] = useState<R2References>();
  const [copied, setCopied] = useState(false);
  const operationForm = useRef<HTMLFormElement>(null);
  const { root, folders } = r2Folders(listing, showHidden);
  const visible = (key: string) => showHidden || !key.slice(root.length + 1).split('/').some(part => part.startsWith('.'));
  const selectedObject = listing.objects.find(object => object.key === selected);
  const target = selectedObject ? selected : directory, directoryTarget = !selectedObject;
  const childFolders = folders.filter(folder => parentOf(folder) === directory);
  const files = listing.objects.filter(object => parentOf(object.key) === directory && visible(object.key)).sort((a, b) => a.key.localeCompare(b.key));
  useEffect(() => { setSelected(''); setOperation(undefined); }, [directory]);
  useEffect(() => { if (operation) operationForm.current?.scrollIntoView({ block: 'nearest' }); }, [operation]);
  const open = (kind: Operation) => void run(async () => {
    setOperation(kind); setReferences(undefined);
    setName(kind === 'move' ? basename(target) : ''); setDestination(parentOf(target));
    if (kind !== 'mkdir') setReferences(await fetchR2References(notebookId, target, directoryTarget));
  });
  const finish = async (next: string, select = '') => {
    setOperation(undefined);
    await onRefresh();
    onNavigate(next); setSelected(select);
  };
  const submit = () => void run(async () => {
    if (operation === 'mkdir') { const folder = `${directory}/${name.trim()}`; await createR2Folder(notebookId, folder); await finish(folder); }
    else if (operation === 'move') {
      const moved = `${destination}/${name.trim()}`;
      await beforeChange?.();
      const result = await moveR2(notebookId, target, moved, directoryTarget);
      if (result.notes.length) await onNotesChanged();
      await finish(directoryTarget ? moved : destination, directoryTarget ? '' : moved);
    } else if (operation === 'delete') { await deleteR2(notebookId, target, directoryTarget); await finish(directoryTarget ? parentOf(target) : directory); }
  });
  const upload = (file?: globalThis.File) => file && void run(async () => {
    const key = `${directory}/${file.name}`;
    await uploadR2(notebookId, key, file);
    await onRefresh(); setSelected(key);
  });
  const relative = (key: string) => key === root ? 'R2' : `R2/${key.slice(root.length + 1)}`;
  const destinations = [root, ...folders].filter(folder => !directoryTarget || folder !== target && !folder.startsWith(target + '/'));
  const rawUrl = selectedObject ? r2RawUrl(notebookId, selectedObject.key) : '';
  const presentation = selectedObject ? r2PreviewType(selectedObject.key).kind : 'file';
  const label = operation === 'mkdir' ? t('files.mkdir') : operation === 'move' ? t(directoryTarget ? 'files.r2MoveFolder' : 'files.move') : operation === 'delete' ? t(directoryTarget ? 'files.r2DeleteFolder' : 'files.delete') : '';
  return <section className={`file-content ${selectedObject ? 'has-selection' : ''}`}>
    <div className="file-actions">
      {mutable && <>
        <button type="button" className="ui-button" disabled={busy} onClick={() => { setSelected(''); setOperation('mkdir'); setName(''); }}><FolderPlus size={15} />{t('files.mkdir')}</button>
        <label className="ui-button" aria-disabled={busy}><Upload size={15} />{t('files.upload')}<input type="file" aria-label={t('files.upload')} disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; upload(file); }} className="sr-only" /></label>
        {directory !== root && !selectedObject && <>
          <button type="button" className="ui-button" disabled={busy} onClick={() => open('move')}><FolderInput size={15} />{t('files.r2MoveFolder')}</button>
          <button type="button" className="ui-button ui-button-danger" disabled={busy} onClick={() => open('delete')}><Trash2 size={15} />{t('files.r2DeleteFolder')}</button>
        </>}
      </>}
    </div>
    <p className="file-storage-hint">{mutable ? t('files.r2Hint') : t('files.r2PickerHint')}</p>
    <div className="file-list" aria-label={t('files.list')}>
      {directory !== root && <div className="file-row file-navigation-row"><button type="button" className="file-row-name" aria-label={t('files.up')} title={t('files.up')} disabled={busy} onClick={() => onNavigate(parentOf(directory))}><CornerLeftUp size={18} /><span>..</span></button></div>}
      {childFolders.map(folder => <div key={folder} className="file-row">
        <button type="button" disabled={busy} className="file-row-name" title={folder} aria-label={`${t('files.openFolder')}: ${basename(folder)}`} onClick={() => onNavigate(folder)}><Folder size={18} /><span>{basename(folder)}</span><small>{t('files.directory')}</small></button>
      </div>)}
      {files.map(object => <div key={object.key} className={`file-row ${selected === object.key ? 'is-selected' : ''}`}>
        <button type="button" disabled={busy} className="file-row-name" title={object.key} aria-label={`${t('files.select')}: ${basename(object.key)}`} onClick={() => { setSelected(object.key); setOperation(undefined); }}><File size={18} /><span>{basename(object.key)}</span><small>{`${(object.size / 1024).toFixed(1)} KB`}</small></button>
      </div>)}
      {!childFolders.length && !files.length && <p className="file-empty">{t('files.empty')}</p>}
    </div>
    {selectedObject && <section className="file-detail" aria-label={t('files.details')}>
      <div className="file-detail-heading"><div className="file-detail-title"><strong>{basename(selectedObject.key)}</strong><div className="file-detail-icons">
        <a className="ui-icon-button" href={rawUrl + '&download=1'} aria-label={t('files.download')} title={t('files.download')}><Download size={18} /></a>
        <button type="button" className="ui-icon-button" aria-label={t('files.close')} title={t('files.close')} disabled={busy} onClick={() => { setSelected(''); setOperation(undefined); }}><X size={18} /></button>
      </div></div><code>{`r2:${selectedObject.key}`}</code></div>
      <div className="file-actions">
        <button type="button" className="ui-button" disabled={busy} onClick={() => void copyToClipboard(r2Reference(selectedObject.key)).then(ok => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); } })}><Copy size={15} />{copied ? t('files.r2Copied') : t('files.r2CopyReference')}</button>
        {mutable && <>
          <button type="button" className="ui-button" disabled={busy} onClick={() => open('move')}><FolderInput size={15} />{t('files.move')}</button>
          <button type="button" className="ui-button ui-button-danger" disabled={busy} onClick={() => open('delete')}><Trash2 size={15} />{t('common.delete')}</button>
        </>}
        {onInsert && <Button type="button" variant="primary" disabled={busy} onClick={() => onInsert(r2Reference(selectedObject.key))}>{t('files.r2Insert')}</Button>}
      </div>
      <Preview key={selectedObject.key} entry={{ path: selectedObject.key, name: basename(selectedObject.key), directory: false, size: selectedObject.size, hidden: false, presentation }} url={rawUrl} />
    </section>}
    {operation && mutable && <form ref={operationForm} className="file-operation" aria-label={label} onSubmit={event => { event.preventDefault(); submit(); }}>
      <h3>{label}</h3>
      {operation !== 'mkdir' && <p><code>{relative(target)}</code></p>}
      {operation !== 'delete' && <label>{t('files.name')}<input className="ui-control" autoFocus required maxLength={200} pattern="[^/\\\\]+" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>}
      {operation === 'move' && <>
        <label>{t('files.destination')}<select className="ui-control" value={destination} disabled={busy} onChange={event => setDestination(event.target.value)}>{destinations.map(folder => <option key={folder} value={folder}>{relative(folder)}</option>)}</select></label>
        <p className="file-destination">{t('files.newPath')}: <code>{relative(destination)}/{name}</code></p>
      </>}
      {operation === 'delete' && references && directoryTarget && <><p>{t('files.r2DeleteObjects', { count: references.objects.length })}</p><ul className="file-affected">{references.objects.map(key => <li key={key}><code>{key.slice(target.length + 1)}</code></li>)}</ul></>}
      {operation !== 'mkdir' && (references ? references.notes.length > 0 && <>
        <p>{t(operation === 'move' ? 'files.r2MoveReferences' : 'files.r2DeleteReferences', { count: references.notes.length })}</p>
        <ul className="file-affected">{references.notes.map(note => <li key={note}><code>{note}</code></li>)}</ul>
      </> : <p role="status">{t('files.loading')}</p>)}
      <div className="file-actions"><button type="button" className="ui-button" disabled={busy} onClick={() => setOperation(undefined)}>{t('common.cancel')}</button><Button type="submit" variant={operation === 'delete' ? 'danger' : 'primary'} disabled={busy || operation !== 'mkdir' && !references || operation === 'move' && `${destination}/${name.trim()}` === target}>{operation === 'delete' ? t('files.confirmDelete') : t('common.save')}</Button></div>
    </form>}
  </section>;
}
