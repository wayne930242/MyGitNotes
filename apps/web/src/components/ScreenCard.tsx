import { useMemo, useState, type ReactNode } from 'react';
import { ExternalLink, FileText, Folder, Image as ImageIcon, Play, Youtube } from 'lucide-react';
import type { ScreenItem, ScreenRow } from '@mygitnotes/core/screen-page';
import type { AssetItem, NoteItem, NotebookConfig } from '../lib/types.js';
import { noteSummary } from '../lib/screen-content.js';
import { renderNote } from '../lib/markdown.js';
import { useTranslation } from '../lib/i18n/index.js';
import { isNoteHidden } from '@mygitnotes/core/note-status';

export type ScreenAsset = AssetItem & { notebookId: string };
export interface ScreenContentProps {
  notebooks: NotebookConfig[]; notes: NoteItem[]; assets: ScreenAsset[];
  onOpen: (item: ScreenItem) => void;
}
export function screenItemTitle(item: ScreenItem, notes: NoteItem[], assets: ScreenAsset[]): string {
  if (item.kind === 'youtube') return item.title || 'YouTube';
  return notes.find(note => note.path === item.path && note.notebookId === item.notebookId)?.title
    || assets.find(asset => asset.path === item.path && asset.notebookId === item.notebookId)?.name
    || item.path.split('/').pop() || item.path;
}

export function ScreenCard({ item, view, controls, ...content }: ScreenContentProps & {
  item: ScreenItem; view: ScreenRow['view']; controls?: ReactNode;
}) {
  const { t } = useTranslation(); const [playing, setPlaying] = useState(false);
  const note = item.kind === 'note' ? content.notes.find(note => note.path === item.path && note.notebookId === item.notebookId) : undefined;
  const asset = item.kind === 'asset' ? content.assets.find(asset => asset.path === item.path && asset.notebookId === item.notebookId) : undefined;
  const notebook = item.kind !== 'youtube' ? content.notebooks.find(nb => nb.id === item.notebookId) : undefined;
  const title = screenItemTitle(item, content.notes, content.assets);
  const tableLabel = t('preview.scrollableTable');
  const html = useMemo(() => note && view !== 'thumbnail' ? renderNote(note.content, note.path, tableLabel) : '', [note?.content, note?.path, view, tableLabel]);
  const icon = item.kind === 'note' ? <FileText /> : item.kind === 'folder' ? <Folder /> : item.kind === 'asset' ? <ImageIcon /> : <Youtube />;
  const members = item.kind === 'folder' ? content.notes.filter(note => note.notebookId === item.notebookId && note.path.startsWith(`${item.path}/`) && !isNoteHidden({ ...note.metadata, status: note.status })) : [];
  const memberAssets = item.kind === 'folder' ? content.assets.filter(asset => asset.notebookId === item.notebookId && asset.path.startsWith(`${item.path}/`)) : [];
  return <article className={`screen-card screen-item-${item.kind}`} data-screen-item={item.id} onClick={event => {
    if (note && !(event.target as HTMLElement).closest('a,button,input,select,textarea,summary,[role="button"]') && !window.getSelection()?.toString()) content.onOpen(item);
  }}>
    <header className="screen-card-header">{controls}{icon}<button type="button" className="screen-card-title" title={title} onClick={() => content.onOpen(item)}>{title}</button>
      {item.kind !== 'note' && <button type="button" className="screen-open ui-icon-button" aria-label={`${t('links.open')}: ${title}`} onClick={() => content.onOpen(item)}><ExternalLink size={13} /></button>}
    </header>
    <div className="screen-card-content" tabIndex={0} aria-label={title}>
      {note ? view === 'thumbnail' ? <p className="screen-summary">{noteSummary(note.content)}</p>
        : <div className="prose-custom screen-markdown" data-markdown-view dangerouslySetInnerHTML={{ __html: html }} />
        : item.kind === 'folder' ? <div className="screen-folder-list">
          {members.length ? members.map(note => <button key={note.path} type="button" onClick={() => content.onOpen({ id: item.id, kind: 'note', notebookId: note.notebookId, path: note.path })}>
            <FileText size={14} /><span>{note.title}</span>
          </button>) : !memberAssets.length && <p className="screen-summary">{t('screen.emptyFolder')}</p>}
          {memberAssets.map(asset => <button key={asset.path} type="button" onClick={() => content.onOpen({ id: item.id, kind: 'asset', notebookId: asset.notebookId, path: asset.path })}><ImageIcon size={14} /><span>{asset.name}</span></button>)}
        </div>
        : item.kind === 'asset' && asset ? /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(asset.name)
          ? <button type="button" className="screen-image-button" onClick={() => content.onOpen(item)} aria-label={`${t('screen.preview')}: ${title}`}><img src={asset.rawUrl} alt={asset.name} loading="lazy" /></button>
          : <div className="screen-file"><FileText size={38} /><p>{asset.name}</p><small>{Math.ceil(asset.size / 1024)} KB</small></div>
        : item.kind === 'youtube' ? playing ? <iframe title={title} src={`https://www.youtube-nocookie.com/embed/${item.videoId}?start=${item.start}&playsinline=1&autoplay=1&rel=0`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          : <button type="button" className="screen-youtube-poster" onClick={() => setPlaying(true)} aria-label={`${t('screen.play')}: ${title}`}>
            <img src={`https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`} alt="" loading="lazy" /><span><Play fill="currentColor" />{t('screen.play')}</span>
          </button>
        : <p className="screen-missing">{t('screen.missing')}</p>}
    </div>
    <footer className="screen-card-footer" title={item.kind === 'youtube' ? item.videoId : item.path}><span>{notebook?.title || (item.kind === 'youtube' ? 'YouTube' : t('screen.missing'))}</span></footer>
  </article>;
}
