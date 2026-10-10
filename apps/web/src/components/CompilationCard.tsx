import { type ReactNode, useMemo, useState } from 'react';
import { ExternalLink, FileText, Folder, Image as ImageIcon, Play, Youtube } from 'lucide-react';
import type { CompilationItem, CompilationRow } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { AssetItem, NotebookConfig } from '../lib/types.js';
import { noteSummary } from '../lib/compilation-content.js';
import { renderNote } from '../lib/markdown.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useNoteEditing } from '../lib/note-editing.js';
import { youtubeLabels } from '../lib/youtube-embed.js';
import { useNoteList } from '../lib/use-note-queries.js';
import { NoteListSentinel } from './NoteListSentinel.js';
import { LoadingStatus } from './LoadingStatus.js';
import { InlineNoteSlot, type InlineNoteSlotParts } from './InlineNoteSlot.js';
import { NoteHtml } from './NoteHtml.js';

export type CompilationAsset = AssetItem & { notebookId: string; };
export interface CompilationContentProps {
  notebooks: NotebookConfig[];
  notes: NoteListItem[];
  assets: CompilationAsset[];
  onOpen: (item: CompilationItem, note?: NoteListItem) => void;
}
export function compilationItemTitle(item: CompilationItem, notes: NoteListItem[], assets: CompilationAsset[]): string {
  if (item.kind === 'youtube') return item.title || 'YouTube';
  return notes.find(note => note.path === item.path && note.notebookId === item.notebookId)?.title || assets.find(asset => asset.path === item.path && asset.notebookId === item.notebookId)?.name || item.path.split('/').pop() || item.path;
}

/** Where a click on a note card's chrome opens the note in zoom: not on a control, and not on the body, which its note slot handles. */
const CHROME_SKIPPED = 'a,button,input,select,textarea,summary,[role="button"],.compilation-inline-reading,.compilation-inline-editor';

export function CompilationCard({ item, view, controls, writable = false, ...content }: CompilationContentProps & { item: CompilationItem; view: CompilationRow['view']; controls?: ReactNode; /** Whether a note card offers editing in place: write access, and not reorder mode. */ writable?: boolean; }) {
  const { t } = useTranslation();
  const { editorProps } = useNoteEditing();
  const [playing, setPlaying] = useState(false);
  const note = item.kind === 'note' ? content.notes.find(note => note.path === item.path && note.notebookId === item.notebookId) : undefined;
  const asset = item.kind === 'asset' ? content.assets.find(asset => asset.path === item.path && asset.notebookId === item.notebookId) : undefined;
  const notebook = item.kind !== 'youtube' ? content.notebooks.find(nb => nb.id === item.notebookId) : undefined;
  const title = compilationItemTitle(item, content.notes, content.assets);
  const tableLabel = t('preview.scrollableTable');
  /* eslint-disable react/preserve-manual-memoization -- Memoization follows the note content/path and display inputs used by the renderer. */
  const html = useMemo(() => note?.content && view !== 'thumbnail' ? renderNote(note.content, note.path, tableLabel, youtubeLabels(t), note.notebookId) : '', [note?.content, note?.path, note?.notebookId, view, tableLabel, t]);
  /* eslint-enable react/preserve-manual-memoization */
  const icon = item.kind === 'note' ? <FileText /> : item.kind === 'folder' ? <Folder /> : item.kind === 'asset' ? <ImageIcon /> : <Youtube />;
  // A pinned folder lists its visible notes straight from the server, a page at a time.
  const folderNotes = useNoteList(item.kind === 'folder' ? { notebookId: item.notebookId, folders: [item.path], descendants: true, sort: 'title', order: 'asc' } : null, { limit: 200 });
  const members = item.kind === 'folder' ? [...folderNotes.uncommitted, ...folderNotes.notes] : [];
  const memberAssets = item.kind === 'folder' ? content.assets.filter(asset => asset.notebookId === item.notebookId && asset.path.startsWith(`${item.path}/`)) : [];
  const reading = note ? typeof note.content !== 'string' ? <LoadingStatus className='screen-summary'>{t('notes.loading')}</LoadingStatus> : view === 'thumbnail' ? <p className='screen-summary'>{noteSummary(note.content)}</p> : <NoteHtml className='prose-custom screen-markdown' html={html} notebookId={note.notebookId} /> : null;
  const card = (slot?: InlineNoteSlotParts) => {
    return (
      <article
        {...slot?.frameProps}
        className={`screen-card screen-item-${item.kind}`}
        data-screen-item={item.id}
        onClick={event => {
          if (note && !slot?.editing && !(event.target as HTMLElement).closest(CHROME_SKIPPED) && !window.getSelection()?.toString()) content.onOpen(item, note);
        }}
      >
        <header className='screen-card-header'>
          {controls}
          {icon}
          <button type='button' className='screen-card-title' title={slot?.title ?? title} onClick={() => content.onOpen(item, note)}>{slot?.title ?? title}</button>
          {slot?.controls}
          {item.kind !== 'note' && (
            <button type='button' className='screen-open ui-icon-button' aria-label={`${t('links.open')}: ${title}`} onClick={() => content.onOpen(item, note)}>
              <ExternalLink size={13} />
            </button>
          )}
        </header>
        <div className={slot ? 'screen-card-content screen-card-note' : 'screen-card-content'} tabIndex={0} aria-label={slot?.title ?? title}>
          {slot ? slot.body : item.kind === 'folder'
            ? (
              <div className='screen-folder-list'>
                {folderNotes.error && <p role='alert' className='screen-missing'>{folderNotes.error}</p>}
                {folderNotes.loading && <LoadingStatus className='screen-summary'>{t('notes.loading')}</LoadingStatus>}
                {members.length
                  ? members.map(note => (
                    <button key={note.path} type='button' onClick={() => content.onOpen({ id: item.id, kind: 'note', notebookId: note.notebookId, path: note.path }, note)}>
                      <FileText size={14} />
                      <span>{note.title}</span>
                    </button>
                  ))
                  : !memberAssets.length && !folderNotes.loading && !folderNotes.error && <p className='screen-summary'>{t('screen.emptyFolder')}</p>}
                {memberAssets.map(asset => (
                  <button key={asset.path} type='button' onClick={() => content.onOpen({ id: item.id, kind: 'asset', notebookId: asset.notebookId, path: asset.path })}>
                    <ImageIcon size={14} />
                    <span>{asset.name}</span>
                  </button>
                ))}
                <NoteListSentinel hasMore={folderNotes.hasMore} loading={folderNotes.loadingMore} error={folderNotes.error} onLoadMore={folderNotes.loadMore} />
              </div>
            )
            : item.kind === 'asset' && asset
            ? /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(asset.name)
              ? (
                <button type='button' className='screen-image-button' onClick={() => content.onOpen(item)} aria-label={`${t('screen.preview')}: ${title}`}>
                  <img src={asset.rawUrl} alt={asset.name} loading='lazy' />
                </button>
              )
              : (
                <div className='screen-file'>
                  <FileText size={38} />
                  <p>{asset.name}</p>
                  <small>{Math.ceil(asset.size / 1024)}{' KB'}</small>
                </div>
              )
            : item.kind === 'youtube'
            ? playing ? <iframe title={title} src={`https://www.youtube-nocookie.com/embed/${item.videoId}?start=${item.start}&playsinline=1&autoplay=1&rel=0`} allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share' allowFullScreen referrerPolicy='strict-origin-when-cross-origin' /> : (
              <button type='button' className='screen-youtube-poster' onClick={() => setPlaying(true)} aria-label={`${t('screen.play')}: ${title}`}>
                <img src={`https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`} alt='' loading='lazy' />
                <span>
                  <Play fill='currentColor' />
                  {t('screen.play')}
                </span>
              </button>
            )
            : <p className='screen-missing'>{t('screen.missing')}</p>}
        </div>
        <footer className='screen-card-footer' title={item.kind === 'youtube' ? item.videoId : item.path}>
          <span>{notebook?.title || (item.kind === 'youtube' ? 'YouTube' : t('screen.missing'))}</span>
        </footer>
      </article>
    );
  };
  // A note card is a note slot: it reads, or edits in place; every other kind of card keeps its own actions.
  return note ? <InlineNoteSlot slot={item.id} notebookId={note.notebookId} path={note.path} title={title} writable={writable && !editorProps({ ...note, content: note.content ?? '' }).readOnly} layout='fill' reading={reading} onOpenZoom={() => content.onOpen(item, note)}>{parts => card(parts)}</InlineNoteSlot> : card();
}
