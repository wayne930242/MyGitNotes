import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { List } from 'lucide-react';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import { bookChapters, bookEntries, type BookEntry } from '../lib/book-chapters.js';
import { useHeldOrder } from '../lib/compilation-editing.js';
import { compilationRowItems, studyRowItems } from '../lib/compilation-content.js';
import { useLaneNotes } from '../lib/compilation-queries.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useScrollSpy } from '../lib/scroll-spy.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { BookChapter } from './BookChapter.js';
import { BookContents } from './BookContents.js';
import { BookDrawer } from './BookDrawer.js';
import { Button } from './Button.js';
import type { CompilationContentProps } from './CompilationCard.js';
import { CompilationHeader, type CompilationHeaderProps } from './CompilationHeader.js';
import { LoadingStatus } from './LoadingStatus.js';
import { NoteListSentinel } from './NoteListSentinel.js';

type BookHeader = Omit<CompilationHeaderProps, 'row' | 'count' | 'notebooks' | 'scrollButton'>;

/** The compilation is narrower than this and the contents list moves into a drawer; the same number is in the book's container query in `workspace.css`. */
const BOOK_DRAWER_BELOW = 720;

const headings = (root: HTMLElement | null, anchor: string) => [...(root?.querySelectorAll<HTMLElement>('[data-book-anchor]') ?? [])].find(element => element.dataset.bookAnchor === anchor);

/**
 * The book arrangement: a contents list beside every item in order as one long document. Notes show their
 * full Markdown and edit in place; assets show a preview, YouTube the player and folders their notes as
 * sub-sections. The body scrolls inside the compilation and the contents follow it.
 */
export function CompilationBook({ row, notebooks, assets, onOpen, study, facets, extra, ...header }: Omit<CompilationContentProps, 'notes'> & BookHeader & { row: CompilationRow; study: StudyController; facets?: Record<string, NotebookFacets>; extra?: ReactNode; }) {
  const { t } = useTranslation();
  const laneNotes = useLaneNotes(row, { content: true });
  const ordinaryRow = { ...row, study: { ...row.study, filter: 'all' as const, dueFirst: false } };
  const items = useHeldOrder(studyRowItems(compilationRowItems(row, laneNotes.notes, assets, notebooks), ordinaryRow, laneNotes.notes, study.study));
  const chapters = bookChapters(items, laneNotes.notes, assets, laneNotes.loading);
  const [sections, setSections] = useState<ReadonlyMap<string, readonly BookEntry[]>>(new Map());
  const [liveTitles, setLiveTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const entries = bookEntries(chapters, sections, liveTitles);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [book, setBook] = useState<HTMLElement | null>(null);
  const [drawer, setDrawer] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const active = useScrollSpy(body, entries.map(entry => entry.anchor).join('\n'));
  const writable = !header.readOnly;

  const onEntries = useCallback((chapterId: string, next: BookEntry[]) => {
    setSections(current => {
      const same = (current.get(chapterId) ?? []).length === next.length && next.every((entry, index) => current.get(chapterId)![index].anchor === entry.anchor && current.get(chapterId)![index].title === entry.title);
      if (same || (!next.length && !current.has(chapterId))) return current;
      const copy = new Map(current);
      if (next.length) copy.set(chapterId, next);
      else copy.delete(chapterId);
      return copy;
    });
  }, []);
  const onLiveTitle = useCallback((anchor: string, title: string | undefined) => {
    setLiveTitles(current => {
      if (current.get(anchor) === title) return current;
      const copy = new Map(current);
      if (title === undefined) copy.delete(anchor);
      else copy.set(anchor, title);
      return copy;
    });
  }, []);

  // A jump puts the heading at the top of the body, smoothly unless the reader asked for less motion, and focuses it where it is.
  const jump = (anchor: string) => {
    const heading = headings(body, anchor);
    if (!body || !heading) return;
    const top = body.scrollTop + heading.getBoundingClientRect().top - body.getBoundingClientRect().top;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    body.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
    heading.focus({ preventScroll: true });
  };
  const closeDrawer = () => {
    setDrawer(false);
    opener.current?.focus();
  };
  // A drawer left open while the compilation widens would cover a list that is now beside the book.
  useEffect(() => {
    if (!drawer || !book || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width >= BOOK_DRAWER_BELOW) setDrawer(false);
    });
    observer.observe(book);
    return () => observer.disconnect();
  }, [drawer, book]);
  const contents = { entries, active, hasMore: laneNotes.hasMore, loadingMore: laneNotes.loadingMore, onLoadMore: laneNotes.loadMore };

  return (
    <section ref={setBook} id={`screen-lane-${row.id}`} className='screen-lane compilation-book-view' aria-label={row.name}>
      <CompilationHeader row={row} count={chapters.length} notebooks={notebooks} facets={facets} extra={extra} {...header} />
      <div className='compilation-book-bar'>
        <Button ref={opener} type='button' className='compilation-book-contents-button' aria-haspopup='dialog' aria-expanded={drawer} onClick={() => setDrawer(true)}>
          <List size={14} aria-hidden='true' />
          <span>{t('book.contents')}</span>
        </Button>
      </div>
      <div className='compilation-book-layout'>
        <BookContents {...contents} onJump={jump} />
        <div ref={setBody} className='compilation-book' aria-label={`${row.name} · ${t('screen.items')}`}>
          {chapters.map(chapter => <BookChapter key={chapter.id} chapter={chapter} assets={assets} writable={writable} onOpen={onOpen} onLiveTitle={onLiveTitle} onEntries={onEntries} />)}
          {laneNotes.error && <p role='alert' className='screen-error'>{laneNotes.error}</p>}
          {laneNotes.loading && <LoadingStatus className='screen-lane-empty'>{t('notes.loading')}</LoadingStatus>}
          <NoteListSentinel hasMore={laneNotes.hasMore} loading={laneNotes.loadingMore} error={laneNotes.error} onLoadMore={laneNotes.loadMore} className='screen-lane-sentinel' />
          {!chapters.length && !laneNotes.loading && <div className='screen-lane-empty'>{t(row.kind === 'custom' ? 'screen.emptyCustom' : 'screen.emptyDynamic')}</div>}
        </div>
      </div>
      {drawer && book && (
        <BookDrawer
          {...contents}
          container={book}
          onJump={anchor => {
            setDrawer(false);
            jump(anchor);
          }}
          onClose={closeDrawer}
        />
      )}
    </section>
  );
}
