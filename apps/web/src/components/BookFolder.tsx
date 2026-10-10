import { useEffect } from 'react';
import { ExternalLink, Image as ImageIcon } from 'lucide-react';
import type { CompilationItem } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { type BookEntry, sectionAnchor } from '../lib/book-chapters.js';
import { useHeldOrder } from '../lib/compilation-editing.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useNoteList } from '../lib/use-note-queries.js';
import { BookSection } from './BookSection.js';
import type { CompilationAsset } from './CompilationCard.js';
import { LoadingStatus } from './LoadingStatus.js';
import { NoteListSentinel } from './NoteListSentinel.js';

export interface BookFolderProps {
  item: Extract<CompilationItem, { kind: 'folder'; }>;
  anchor: string;
  title: string;
  assets: CompilationAsset[];
  writable: boolean;
  onOpen: (item: CompilationItem, note?: NoteListItem) => void;
  onLiveTitle: (anchor: string, title: string | undefined) => void;
  /** Reports the note sections the folder lists, for the contents list; an empty list once the folder leaves the book. */
  onEntries: (chapterId: string, entries: BookEntry[]) => void;
}

/** A folder chapter: its notes as sub-sections in title order, a page of 200 at a time, then its assets as a compact list. */
export function BookFolder({ item, anchor, title, assets, writable, onOpen, onLiveTitle, onEntries }: BookFolderProps) {
  const { t } = useTranslation();
  const list = useNoteList({ notebookId: item.notebookId, folders: [item.path], descendants: true, sort: 'title', order: 'asc' }, { limit: 200, content: true });
  // While a section edits, its autosaves must not move it, so the folder holds its order like the book does.
  const members = useHeldOrder([...list.uncommitted, ...list.notes].map(note => ({ id: note.path, note }))).map(member => member.note);
  const memberAssets = assets.filter(asset => asset.notebookId === item.notebookId && asset.path.startsWith(`${item.path}/`));
  const signature = members.map(note => `${note.path}\n${note.title}`).join('\n\n');
  useEffect(() => {
    onEntries(item.id, members.map(note => ({ anchor: sectionAnchor(item, note.path), title: note.title, level: 1 })));
    return () => onEntries(item.id, []);
    // The signature stands for the member list: the entries are rebuilt from it, not from the note objects' identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, signature, onEntries]);
  const memberItem = (note: NoteListItem): CompilationItem => ({ id: item.id, kind: 'note', notebookId: note.notebookId, path: note.path });
  return (
    <>
      <div className='compilation-book-heading-row'>
        <h2 className='compilation-book-heading' data-book-anchor={anchor} tabIndex={-1}>
          <button type='button' className='compilation-book-title' title={title} onClick={() => onOpen(item)}>{title}</button>
        </h2>
        <button type='button' className='screen-open ui-icon-button' aria-label={`${t('links.open')}: ${title}`} onClick={() => onOpen(item)}>
          <ExternalLink size={13} />
        </button>
      </div>
      <div className='compilation-book-content'>
        {list.error && <p role='alert' className='screen-missing'>{list.error}</p>}
        {list.loading && <LoadingStatus className='screen-summary'>{t('notes.loading')}</LoadingStatus>}
        {members.map(note => <BookSection key={note.path} anchor={sectionAnchor(item, note.path)} slot={`${item.id}:${note.path}`} level={3} note={note} writable={writable} onOpenZoom={() => onOpen(memberItem(note), note)} onLiveTitle={onLiveTitle} />)}
        <NoteListSentinel hasMore={list.hasMore} loading={list.loadingMore} error={list.error} onLoadMore={list.loadMore} />
        {memberAssets.length > 0 && (
          <ul className='compilation-book-assets'>
            {memberAssets.map(asset => (
              <li key={asset.path}>
                <button
                  type='button'
                  onClick={() => onOpen({ id: item.id, kind: 'asset', notebookId: asset.notebookId, path: asset.path })}
                >
                  <ImageIcon size={14} aria-hidden='true' />
                  <span>{asset.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!members.length && !memberAssets.length && !list.loading && !list.error && <p className='screen-summary'>{t('screen.emptyFolder')}</p>}
      </div>
    </>
  );
}
