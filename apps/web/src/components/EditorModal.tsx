import { noteRefKey } from '@mygitnotes/core/note-query';
import React, { type ReactNode, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { isCompilationPath } from '@mygitnotes/core/compilation';
import { NoteItem } from '../lib/types.js';
import type { NoteRef } from '@mygitnotes/core/note-query';
import { useTranslation } from '../lib/i18n/index.js';
import { useNoteEditing } from '../lib/note-editing.js';
import { usePanelContext } from '../lib/panel-context.js';
import { NoteEditor } from './NoteEditor.js';
import { LoadingStatus } from './LoadingStatus.js';

interface EditorModalProps {
  note: NoteItem | null;
  /** The committed version of `note` when it carries a staged draft. */
  committed?: NoteItem;
  /** The note's body is still being read; the editor waits instead of opening an empty document. */
  loading?: boolean;
  isOpen: boolean;
  /** The view of the compilation at `path`; a compilation opens here instead of an editor. */
  renderCompilation: (path: string) => ReactNode;
  /** The zoomed compilation this note was opened from, kept mounted and hidden behind the note's zoom. */
  behind?: NoteRef | null;
}

/** Zoom: the full-screen frame around a note's editor. */
export const EditorModal: React.FC<EditorModalProps> = ({ note, committed, loading, isOpen, renderCompilation, behind }) => {
  if (!isOpen) return null;
  const compilation = note && isCompilationPath(note.path) ? note : null;
  // The compilation keeps one place and one key whether it is shown or waits behind a note, so opening a note from it
  // does not unmount its view: editing state, scroll position and a section's editor survive, and zoom can borrow that editor.
  const shown = compilation ?? behind ?? null;
  return <>{shown && <CompilationFrame key={noteRefKey(shown)} hidden={!compilation}>{renderCompilation(shown.path)}</CompilationFrame>}{!compilation && (note ? <ZoomFrame key={noteRefKey(note)} note={note} committed={committed} /> : loading ? <EditorModalLoading /> : null)}</>;
};

/** Shown while a note's body is read; the editor never starts from a missing body. */
const EditorModalLoading: React.FC = () => {
  const { t } = useTranslation();
  const { setHasOpenNote } = usePanelContext();
  // Loading is already zoom: the workspace rail hides as it does behind the editor, instead of floating above the overlay.
  useLayoutEffect(() => {
    setHasOpenNote(true);
    return () => setHasOpenNote(false);
  }, [setHasOpenNote]);
  return (
    <div className='viewport-overlay fixed inset-0 z-50 bg-scrim/60 backdrop-blur-sm flex items-center justify-center p-4'>
      <LoadingStatus className='px-6 py-4 rounded-xl text-sm' style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}>{t('notes.loadingNote')}</LoadingStatus>
    </div>
  );
};

/** Zoom for a compilation: the same full-screen frame, around its view. */
const CompilationFrame: React.FC<{ children: ReactNode; hidden?: boolean; }> = ({ children, hidden = false }) => (
  <div className='note-overlay viewport-overlay fixed inset-0 z-50 bg-scrim/60 backdrop-blur-sm flex items-center justify-center p-3 animate-fadeIn' style={hidden ? { visibility: 'hidden' } : undefined} data-behind={hidden || undefined}>
    <div role='dialog' aria-modal='true' aria-label='Compilation' className='note-dialog ui-dialog shadow-2xl w-full max-w-none h-full flex flex-col overflow-hidden transition-colors'>{children}</div>
  </div>
);

const ZoomFrame: React.FC<{ note: NoteItem; committed?: NoteItem; }> = ({ note, committed }) => {
  const editing = useNoteEditing();
  const { setZoom, hosts } = editing;
  // A host that already edits this note lends its editor, so both places keep one session, cursor and undo history.
  useSyncExternalStore(hosts.subscribe, hosts.snapshot);
  const key = noteRefKey(note);
  const [canBorrow] = useState(() => Boolean(hosts.owner(key)));
  const borrowed = canBorrow && Boolean(hosts.owner(key));
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    setZoom({ key, borrowed, slot });
    return () => setZoom(null);
  }, [setZoom, key, borrowed, slot]);
  const props = editing.editorProps(note, committed);
  return (
    <div className='note-overlay viewport-overlay fixed inset-0 z-50 bg-scrim/60 backdrop-blur-sm flex items-center justify-center p-3 animate-fadeIn'>
      <div role='dialog' aria-modal='true' aria-label='Note editor' className='note-dialog ui-dialog shadow-2xl w-full max-w-none h-full flex flex-col overflow-hidden transition-colors'>{borrowed ? <div ref={setSlot} className='note-editor-slot' /> : <NoteEditor key={`${props.draftScope}:${key}`} {...props} note={note} frame='zoom' active onClose={editing.closeZoom} onAddToFocus={editing.addToFocus(note)} onMove={editing.moveNote?.(note)} onRename={editing.renameNote?.(note) && (title => editing.renameNote?.({ ...note, title })?.())} />}</div>
    </div>
  );
};
