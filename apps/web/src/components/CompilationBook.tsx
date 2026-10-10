import type { ReactNode } from 'react';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import { useLaneNotes } from '../lib/compilation-queries.js';
import { compilationRowItems, studyRowItems } from '../lib/compilation-content.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { useTranslation } from '../lib/i18n/index.js';
import { CompilationCard, type CompilationContentProps } from './CompilationCard.js';
import { CompilationHeader, type CompilationHeaderProps } from './CompilationHeader.js';
import { LoadingStatus } from './LoadingStatus.js';
import { NoteListSentinel } from './NoteListSentinel.js';

type BookHeader = Omit<CompilationHeaderProps, 'row' | 'count' | 'notebooks' | 'scrollButton'>;

/**
 * The book arrangement: every item in order as one long document. Notes show their full Markdown,
 * assets a preview, YouTube the player and folders their notes as links; sections are read-only and
 * their title bars open the item.
 */
export function CompilationBook({ row, notebooks, assets, onOpen, study, facets, extra, ...header }: Omit<CompilationContentProps, 'notes'> & BookHeader & { row: CompilationRow; study: StudyController; facets?: Record<string, NotebookFacets>; extra?: ReactNode; }) {
  const { t } = useTranslation();
  const laneNotes = useLaneNotes(row, { content: true });
  const content: CompilationContentProps = { notebooks, assets, onOpen, notes: laneNotes.notes };
  const ordinaryRow = { ...row, study: { ...row.study, filter: 'all' as const, dueFirst: false } };
  const items = studyRowItems(compilationRowItems(row, content.notes, content.assets, content.notebooks), ordinaryRow, content.notes, study.study);
  return (
    <section id={`screen-lane-${row.id}`} className='screen-lane compilation-book-view' aria-label={row.name}>
      <CompilationHeader row={row} count={items.length} notebooks={notebooks} facets={facets} extra={extra} {...header} />
      <div className='compilation-book' aria-label={`${row.name} · ${t('screen.items')}`}>
        {items.map(item => <CompilationCard key={item.id} {...content} item={item} view='book' />)}
        {laneNotes.error && <p role='alert' className='screen-error'>{laneNotes.error}</p>}
        {laneNotes.loading && <LoadingStatus className='screen-lane-empty'>{t('notes.loading')}</LoadingStatus>}
        <NoteListSentinel hasMore={laneNotes.hasMore} loading={laneNotes.loadingMore} error={laneNotes.error} onLoadMore={laneNotes.loadMore} className='screen-lane-sentinel' />
        {!items.length && !laneNotes.loading && <div className='screen-lane-empty'>{t(row.kind === 'custom' ? 'screen.emptyCustom' : 'screen.emptyDynamic')}</div>}
      </div>
    </section>
  );
}
