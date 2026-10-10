import { useEffect, useMemo } from 'react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { useTranslation } from '../lib/i18n/index.js';
import { useNoteEditing } from '../lib/note-editing.js';
import { renderNote } from '../lib/markdown.js';
import { youtubeLabels } from '../lib/youtube-embed.js';
import { InlineNoteSlot, type InlineNoteSlotParts } from './InlineNoteSlot.js';
import { LoadingStatus } from './LoadingStatus.js';
import { NoteHtml } from './NoteHtml.js';

export interface BookSectionProps {
  /** The heading's anchor in the book body. */
  anchor: string;
  /** The compilation's editing slot id for this section. */
  slot: string;
  /** 2 for a chapter, 3 for a note listed under a folder chapter. */
  level: 2 | 3;
  note: NoteListItem;
  /** Whether the compilation can be edited; the note's own repository must allow it too. */
  writable: boolean;
  /** The title of the note in zoom, from the section heading or the body where editing is not offered. */
  onOpenZoom: () => void;
  /** Reports the editor's current title while the section edits, and `undefined` once it stops, for the contents list. */
  onLiveTitle: (anchor: string, title: string | undefined) => void;
}

/** The frame of a section: its heading row, then the note. It reports the live title upward, which a render prop cannot do. */
function SectionFrame({ anchor, level, parts, onOpenZoom, onLiveTitle }: Pick<BookSectionProps, 'anchor' | 'level' | 'onOpenZoom' | 'onLiveTitle'> & { parts: InlineNoteSlotParts; }) {
  const { editing, title, controls, body, frameProps } = parts;
  useEffect(() => {
    onLiveTitle(anchor, editing ? title : undefined);
    return () => onLiveTitle(anchor, undefined);
  }, [anchor, editing, title, onLiveTitle]);
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section className='compilation-book-section' data-level={level} {...frameProps}>
      <div className='compilation-book-heading-row'>
        <Heading className='compilation-book-heading' data-book-anchor={anchor} tabIndex={-1}>
          <button type='button' className='compilation-book-title' title={title} onClick={onOpenZoom}>{title}</button>
        </Heading>
        {controls}
      </div>
      {body}
    </section>
  );
}

/** A note as a section of the book: its Markdown as it renders elsewhere, or its editor in place. */
export function BookSection({ anchor, slot, level, note, writable, onOpenZoom, onLiveTitle }: BookSectionProps) {
  const { t } = useTranslation();
  const { editorProps } = useNoteEditing();
  const tableLabel = t('preview.scrollableTable');
  /* eslint-disable react/preserve-manual-memoization -- Memoization follows the note content/path and display inputs used by the renderer. */
  const html = useMemo(() => typeof note.content === 'string' ? renderNote(note.content, note.path, tableLabel, youtubeLabels(t), note.notebookId) : '', [note.content, note.path, note.notebookId, tableLabel, t]);
  /* eslint-enable react/preserve-manual-memoization */
  const reading = typeof note.content === 'string' ? <NoteHtml className='prose-custom screen-markdown' html={html} notebookId={note.notebookId} /> : <LoadingStatus className='screen-summary'>{t('notes.loading')}</LoadingStatus>;
  return <InlineNoteSlot slot={slot} notebookId={note.notebookId} path={note.path} title={note.title} writable={writable && !editorProps({ ...note, content: note.content ?? '' }).readOnly} layout='grow' reading={reading} onOpenZoom={onOpenZoom}>{parts => <SectionFrame anchor={anchor} level={level} parts={parts} onOpenZoom={onOpenZoom} onLiveTitle={onLiveTitle} />}</InlineNoteSlot>;
}
