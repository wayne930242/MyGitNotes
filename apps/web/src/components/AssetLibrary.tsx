import React, { useEffect, useId, useState } from 'react';
import { Check, File, Folder, Image as ImageIcon, Upload, X } from 'lucide-react';
import type { AssetItem } from '../lib/types.js';
import { copyToClipboard } from '../lib/clipboard.js';
import { useTranslation } from '../lib/i18n/index.js';

export interface AssetLibraryProps {
  assets: AssetItem[];
  initialAssetPath?: string;
  initialDirectory?: string;
  renderHeader?: (busy: boolean) => React.ReactNode;
  renderSidebar?: (navigation: { folders: string[]; directory: string; busy: boolean; onSelectDirectory: (directory: string) => void }) => React.ReactNode;
  onUploadAsset?: (file: File, directory: string) => Promise<AssetItem>;
  onDeleteAsset?: (asset: AssetItem) => Promise<void>;
  onMoveAsset?: (asset: AssetItem, directory: string) => Promise<AssetItem>;
  onInsert?: (asset: AssetItem) => void;
  onBusyChange?: (busy: boolean) => void;
}
const button = 'ui-button';
const imageFile = (name: string) => /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(name);

export function AssetLibrary({ assets, initialAssetPath, initialDirectory, onUploadAsset, onDeleteAsset, onMoveAsset, onInsert, renderHeader, renderSidebar, onBusyChange }: AssetLibraryProps) {
  const { t } = useTranslation();
  const [directory, setDirectory] = useState('');
  useEffect(() => { if (initialDirectory !== undefined) { setDirectory(initialDirectory); setSelectedPath(''); } }, [initialDirectory]);
  const [selectedPath, setSelectedPath] = useState('');
  const [destination, setDestination] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const [copiedRef, setCopiedRef] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<AssetItem | null>(null);
  const folderList = useId();
  useEffect(() => {
    if (!initialAssetPath) return;
    const asset = assets.find(item => item.path === initialAssetPath);
    if (asset) { setDirectory(asset.directory || ''); setSelectedPath(asset.path); }
  }, [initialAssetPath, assets]);
  const selected = assets.find(a => a.path === selectedPath);
  const folders = [...new Set(assets.flatMap(a => {
    const parts = (a.directory || '').split('/'); return parts.map((_, i) => parts.slice(0,i+1).join('/'));
  }))].sort();
  const visible = assets.filter(a => (a.directory || '') === directory);
  useEffect(() => { setConfirmDelete(false); setDestination(selected?.directory || ''); }, [selectedPath]);
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);
  useEffect(() => {
    if (!preview) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setPreview(null); } };
    document.addEventListener('keydown', close, true);
    return () => document.removeEventListener('keydown', close, true);
  }, [preview]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !onUploadAsset) return;
    await run(async () => { const asset = await onUploadAsset(file, directory); setSelectedPath(asset.path); });
  };
  const selectDirectory = (value: string) => { if (!busy) { setDirectory(value); setSelectedPath(''); } };
  return <>
    {renderSidebar?.({ folders, directory, busy, onSelectDirectory: selectDirectory })}
    <div className={renderSidebar ? 'workspace-content' : undefined}>
    {renderHeader?.(busy)}
    <div className={renderSidebar ? 'workspace-scroll' : undefined}>
    <div className="asset-library flex flex-col gap-4 theme-text min-h-0 min-w-0">
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs flex-1 min-w-40"><span className="flex gap-1 items-center mb-1"><Folder className="w-3.5 h-3.5" />{t('assets.folder')}</span>
        <input aria-label="Asset folder" list={folderList} value={directory} disabled={busy} placeholder={t('assets.rootPlaceholder')} onChange={e => { setDirectory(e.target.value); setSelectedPath(''); }} className="ui-control w-full" />
      </label>
      <datalist id={folderList}>{folders.map(folder => <option key={folder} value={folder} />)}</datalist>
      <button className={button} disabled={busy} onClick={() => { setDirectory(''); setSelectedPath(''); }}>{t('assets.root')}</button>
      <label aria-disabled={!onUploadAsset || busy} className={`${button} ${onUploadAsset && !busy ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}>
        <Upload className="w-3.5 h-3.5" />{busy ? t('assets.working') : t('assets.uploadAsset')}
        <input aria-label={t('assets.uploadAsset')} type="file" disabled={!onUploadAsset || busy} onChange={upload} className="sr-only" />
      </label>
    </div>
    {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    {!renderSidebar && <div className="flex flex-wrap gap-2">{folders.filter(f => f && f !== directory).map(folder => <button key={folder} className="ui-button" disabled={busy} onClick={() => { setDirectory(folder); setSelectedPath(''); }}>{folder}</button>)}</div>}
    {visible.length === 0 ? <p className="text-sm theme-muted py-10 text-center">{t('assets.emptyFolder')}</p> : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {visible.map(asset => <button key={asset.path} aria-label={`Select ${asset.name}`} aria-pressed={selectedPath === asset.path} disabled={busy} onClick={() => { setSelectedPath(asset.path); setConfirmDelete(false); }} className="asset-tile relative border rounded-xl overflow-hidden text-left transition hover:shadow-sm" style={{ backgroundColor:'var(--color-surface)',borderColor:selectedPath === asset.path ? 'var(--color-primary)' : 'var(--color-border)',boxShadow:selectedPath === asset.path ? '0 0 0 1px var(--color-primary)' : undefined }}>
        <div className="h-28 bg-black/5 dark:bg-white/5 flex items-center justify-center">{imageFile(asset.name) ? <img src={asset.rawUrl} alt={asset.name} className="w-full h-full object-cover" /> : <File className="w-9 h-9 theme-muted" />}</div>
        <div className="p-2.5"><div className="text-xs font-medium truncate" title={asset.name}>{asset.name}</div><div className="text-[10px] theme-muted mt-1">{(asset.size/1024).toFixed(1)} KB</div></div>
        {selectedPath === asset.path && <Check className="absolute right-2 top-2 w-5 h-5 bg-white text-emerald-600 rounded-full" />}
      </button>)}
    </div>}
    {selected && <div className="border-t theme-border pt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs mr-auto truncate max-w-48">{selected?.name || t('assets.selectAsset')}</span>
      <button className={button} disabled={!selected || busy} onClick={() => selected && setPreview(selected)}>{t('assets.view')}</button>
      <button className={button} disabled={!selected || busy} onClick={() => selected && void run(async () => {
        const ok = await copyToClipboard(selected.markdownRef);
        if (ok) {
          setCopiedRef(true);
          setTimeout(() => setCopiedRef(false), 2000);
        }
      })}>{copiedRef ? t('assets.copied') : t('assets.copyReference')}</button>
      <button className={`${button} ui-button-danger`} disabled={!selected || !onDeleteAsset || busy} onClick={() => {
        if (!selected || !onDeleteAsset) return;
        if (!confirmDelete) { setConfirmDelete(true); return; }
        void run(async () => { await onDeleteAsset(selected); setSelectedPath(''); setConfirmDelete(false); });
      }}>{confirmDelete ? t('assets.confirmDelete') : t('common.delete')}</button>
      {onInsert && <button className={`${button} ui-button-primary`} disabled={!selected || busy} onClick={() => selected && onInsert(selected)}>{t('assets.insert')}</button>}
    </div>}
    {onMoveAsset && selected && <div className="flex gap-2 items-center">
      <input aria-label="Move asset to folder" list={folderList} placeholder={t('assets.destinationPlaceholder')} value={destination} disabled={!selected || busy} onChange={e => setDestination(e.target.value)} className="ui-control min-w-0 flex-1" />
      <button className={button} disabled={!selected || busy || destination === (selected.directory || '')} onClick={() => selected && void run(async () => { const moved = await onMoveAsset(selected, destination); setDirectory(destination); setSelectedPath(moved.path); })}>{t('assets.move')}</button>
    </div>}
    {preview && <div role="dialog" aria-label="Asset preview" aria-modal="true" className="viewport-overlay fixed inset-0 z-[70] bg-slate-950/80 flex items-center justify-center p-6" onClick={() => setPreview(null)}>
      <div className="ui-dialog overflow-hidden min-w-0 max-w-4xl max-h-[85dvh] shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="p-3 flex items-center gap-4 border-b theme-border"><ImageIcon className="w-4 h-4" /><span className="text-sm mr-auto min-w-0 truncate">{preview.name}</span><a href={preview.rawUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline shrink-0">{t('assets.openOriginal')}</a><button aria-label="Close asset preview" onClick={() => setPreview(null)} className="ui-icon-button"><X className="w-5 h-5" /></button></div>
        {imageFile(preview.name) ? <img src={preview.rawUrl} alt={preview.name} className="max-h-[70vh] max-w-full object-contain" /> : <p className="p-10 text-sm">{t('assets.openToViewFormat')}</p>}
      </div>
    </div>}
  </div>
  </div>
  </div>
  </>;
}
