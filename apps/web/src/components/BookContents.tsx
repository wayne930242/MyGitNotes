import { useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import type { BookEntry } from '../lib/book-chapters.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';

export interface BookContentsProps {
  entries: readonly BookEntry[];
  /** The anchor of the entry in view. */
  active: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onJump: (anchor: string) => void;
}

/** The contents list: a landmark of buttons, one for each chapter and folder note section, that keeps the entry in view visible. */
export function BookContents({ entries, active, hasMore, loadingMore, onLoadMore, onJump }: BookContentsProps) {
  const { t } = useTranslation();
  const nav = useRef<HTMLElement>(null);
  // The list scrolls itself, not the page, to keep the highlighted entry visible.
  useEffect(() => {
    const list = nav.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!list || !current) return;
    const bounds = list.getBoundingClientRect(), entry = current.getBoundingClientRect();
    if (entry.top < bounds.top) list.scrollTop -= bounds.top - entry.top;
    else if (entry.bottom > bounds.bottom) list.scrollTop += entry.bottom - bounds.bottom;
  }, [active]);
  return (
    <nav ref={nav} className='compilation-book-contents' aria-label={t('book.contents')}>
      <ol>
        {entries.map(entry => (
          <li key={entry.anchor} data-level={entry.level}>
            <button type='button' aria-current={entry.anchor === active ? 'location' : undefined} title={entry.title} onClick={() => onJump(entry.anchor)}>
              <span>{entry.title}</span>
              {entry.missing && <AlertCircle size={13} role='img' aria-label={t('screen.missing')} />}
            </button>
          </li>
        ))}
      </ol>
      {hasMore && <Button type='button' className='compilation-book-load-more' disabled={loadingMore} onClick={onLoadMore}>{t('book.loadMore')}</Button>}
    </nav>
  );
}
