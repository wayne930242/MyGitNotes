import { useEffect, useRef } from 'react';
import { Button } from './Button.js';
import { useTranslation } from '../lib/i18n/index.js';
import { LoadingStatus } from './LoadingStatus.js';

/** Loads the next page once the end of a note list scrolls into view. */
export function NoteListSentinel({ hasMore, loading, error, onLoadMore, className = '' }: { hasMore: boolean; loading: boolean; error?: string; onLoadMore: () => void; className?: string; }) {
  const { t } = useTranslation();
  const anchor = useRef<HTMLDivElement>(null);
  const load = useRef(onLoadMore);
  /* eslint-disable react/refs -- Keep the current callback in a ref for an imperative listener without recreating its subscription. */
  load.current = onLoadMore;
  /* eslint-enable react/refs */
  useEffect(() => {
    const element = anchor.current;
    // A failed page waits for the retry button: re-observing a visible sentinel would ask again
    // on every failure, in a loop.
    if (!hasMore || error || !element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) load.current();
    }, { rootMargin: '200px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, loading, error]);
  if (!hasMore && !loading && !error) return null;
  return (
    <div ref={anchor} className={`note-list-sentinel ${className}`.trim()} data-note-sentinel={hasMore ? 'more' : 'end'}>
      {error
        ? (
          <p role='alert' className='note-list-sentinel-error'>
            {error}
            <Button type='button' onClick={onLoadMore} disabled={loading}>{t('notes.retryPage')}</Button>
          </p>
        )
        : loading
        ? <LoadingStatus>{t('notes.loadingMore')}</LoadingStatus>
        : <p role='status'>{t('notes.moreAvailable')}</p>}
    </div>
  );
}
