import React, { useEffect, useId, useState } from 'react';
import { Check, File, Folder, Image as ImageIcon, Upload, X } from 'lucide-react';
import type { AssetItem } from '../lib/types.js';

export interface AssetLibraryProps {
  assets: AssetItem[];
  onUploadAsset?: (file: File, directory: string) => Promise<AssetItem>;
  onDeleteAsset?: (asset: AssetItem) => Promise<void>;
  onMoveAsset?: (asset: AssetItem, directory: string) => Promise<AssetItem>;
  onInsert?: (asset: AssetItem) => void;
}
const button = 'px-3 py-1.5 rounded-lg border text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-black/5 dark:hover:bg-white/10';
const imageFile = (name: string) => /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(name);

export function AssetLibrary({ assets, onUploadAsset, onDeleteAsset, onMoveAsset, onInsert }: AssetLibraryProps) {
  const [directory, setDirectory] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [destination, setDestination] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<AssetItem | null>(null);
  const folderList = useId();
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
  return <div className="asset-library flex flex-col gap-4 text-slate-800 dark:text-slate-200 min-h-0 min-w-0">
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs flex-1 min-w-40"><span className="flex gap-1 items-center mb-1"><Folder className="w-3.5 h-3.5" />Folder</span>
        <input aria-label="Asset folder" list={folderList} value={directory} disabled={busy} placeholder="Root (or enter a folder path)" onChange={e => { setDirectory(e.target.value); setSelectedPath(''); }} className="w-full px-3 py-2 rounded-lg border bg-transparent dark:border-slate-700" />
      </label>
      <datalist id={folderList}>{folders.map(folder => <option key={folder} value={folder} />)}</datalist>
      <button className={button} disabled={busy} onClick={() => { setDirectory(''); setSelectedPath(''); }}>Root</button>
      <label className={`${button} flex items-center gap-1.5 ${onUploadAsset && !busy ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}>
        <Upload className="w-3.5 h-3.5" />{busy ? 'Working…' : 'Upload asset'}
        <input aria-label="Upload asset" type="file" disabled={!onUploadAsset || busy} onChange={upload} className="hidden" />
      </label>
    </div>
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    <div className="flex flex-wrap gap-2">{folders.filter(f => f && f !== directory).map(folder => <button key={folder} className="text-xs underline text-slate-500" disabled={busy} onClick={() => { setDirectory(folder); setSelectedPath(''); }}>{folder}</button>)}</div>
    {visible.length === 0 ? <p className="text-sm text-slate-400 py-10 text-center">No assets in this folder.</p> : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 overflow-y-auto">
      {visible.map(asset => <button key={asset.path} aria-label={`Select ${asset.name}`} aria-pressed={selectedPath === asset.path} disabled={busy} onClick={() => { setSelectedPath(asset.path); setConfirmDelete(false); }} className="relative border rounded-xl overflow-hidden text-left transition hover:shadow-md" style={{ backgroundColor:'var(--color-sidebar)',borderColor:selectedPath === asset.path ? 'var(--color-primary)' : 'var(--color-border)',boxShadow:selectedPath === asset.path ? '0 0 0 1px var(--color-primary)' : undefined }}>
        <div className="h-28 bg-black/5 dark:bg-white/5 flex items-center justify-center">{imageFile(asset.name) ? <img src={asset.rawUrl} alt={asset.name} className="w-full h-full object-cover" /> : <File className="w-9 h-9 text-slate-400" />}</div>
        <div className="p-2.5"><div className="text-xs font-medium truncate" title={asset.name}>{asset.name}</div><div className="text-[10px] text-slate-400 mt-1">{(asset.size/1024).toFixed(1)} KB</div></div>
        {selectedPath === asset.path && <Check className="absolute right-2 top-2 w-5 h-5 bg-white text-emerald-600 rounded-full" />}
      </button>)}
    </div>}
    <div className="border-t pt-3 flex flex-wrap items-center gap-2 dark:border-slate-700">
      <span className="text-xs mr-auto truncate max-w-48">{selected?.name || 'Select an asset'}</span>
      <button className={button} disabled={!selected || busy} onClick={() => selected && setPreview(selected)}>View</button>
      <button className={button} disabled={!selected || busy} onClick={() => selected && void run(() => navigator.clipboard.writeText(selected.markdownRef))}>Copy reference</button>
      <button className={`${button} text-rose-600`} disabled={!selected || !onDeleteAsset || busy} onClick={() => {
        if (!selected || !onDeleteAsset) return;
        if (!confirmDelete) { setConfirmDelete(true); return; }
        void run(async () => { await onDeleteAsset(selected); setSelectedPath(''); setConfirmDelete(false); });
      }}>{confirmDelete ? 'Confirm delete' : 'Delete'}</button>
      {onInsert && <button className={`${button} text-white`} style={{ backgroundColor:'var(--color-primary)' }} disabled={!selected || busy} onClick={() => selected && onInsert(selected)}>Insert</button>}
    </div>
    {onMoveAsset && <div className="flex gap-2 items-center">
      <input aria-label="Move asset to folder" list={folderList} placeholder="Destination folder (empty = root)" value={destination} disabled={!selected || busy} onChange={e => setDestination(e.target.value)} className="min-w-0 flex-1 px-3 py-2 rounded-lg border text-xs bg-transparent dark:border-slate-700" />
      <button className={button} disabled={!selected || busy || destination === (selected.directory || '')} onClick={() => selected && void run(async () => { const moved = await onMoveAsset(selected, destination); setDirectory(destination); setSelectedPath(moved.path); })}>Move</button>
    </div>}
    {preview && <div role="dialog" aria-label="Asset preview" aria-modal="true" className="viewport-overlay fixed inset-0 z-[70] bg-slate-950/80 flex items-center justify-center p-6" onClick={() => setPreview(null)}>
      <div className="bg-white dark:bg-slate-900 rounded-xl overflow-hidden min-w-0 max-w-4xl max-h-[85dvh] shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="p-3 flex items-center gap-4 border-b dark:border-slate-700"><ImageIcon className="w-4 h-4" /><span className="text-sm mr-auto min-w-0 truncate">{preview.name}</span><a href={preview.rawUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline shrink-0">Open original</a><button aria-label="Close asset preview" onClick={() => setPreview(null)}><X className="w-5 h-5" /></button></div>
        {imageFile(preview.name) ? <img src={preview.rawUrl} alt={preview.name} className="max-h-[70vh] max-w-full object-contain" /> : <p className="p-10 text-sm">Open the original file to view this format.</p>}
      </div>
    </div>}
  </div>;
}
