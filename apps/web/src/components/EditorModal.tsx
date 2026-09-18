import React, { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { NoteItem } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useNoteEditing } from '../lib/note-editing.js';
import { NoteEditor } from './NoteEditor.js';

interface EditorModalProps {
  note: NoteItem | null;
  /** The committed version of `note` when it carries a staged draft. */
  committed?: NoteItem;
  /** The note's body is still being read; the editor waits instead of opening an empty document. */
  loading?: boolean;
  isOpen: boolean;
}

/** Zoom: the full-screen frame around a note's editor. */
export const EditorModal: React.FC<EditorModalProps> = ({ note, committed, loading, isOpen }) => {
  if (!isOpen) return null;
  if (!note) return loading ? <EditorModalLoading /> : null;
  return <ZoomFrame key={note.path} note={note} committed={committed} />;
};

/** Shown while a note's body is read; the editor never starts from a missing body. */
const EditorModalLoading: React.FC = () => {
  const { t } = useTranslation();
  return <div className="viewport-overlay fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <p role="status" className="px-6 py-4 rounded-xl text-sm" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}>
      {t('notes.loadingNote')}
    </p>
  </div>;
};

const ZoomFrame: React.FC<{ note: NoteItem; committed?: NoteItem }> = ({ note, committed }) => {
  const editing = useNoteEditing();
  const { setZoom, hosts } = editing;
  // A host that already edits this note lends its editor, so both places keep one session, cursor and undo history.
  useSyncExternalStore(hosts.subscribe, hosts.snapshot);
  const [canBorrow] = useState(() => Boolean(hosts.owner(note.path)));
  const borrowed = canBorrow && Boolean(hosts.owner(note.path));
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    setZoom({ path: note.path, borrowed, slot });
    return () => setZoom(null);
  }, [setZoom, note.path, borrowed, slot]);
  const props = editing.editorProps(note, committed);
  return (
    <div className="note-overlay viewport-overlay fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 animate-fadeIn">
      <div role="dialog" aria-modal="true" aria-label="Note editor" className="note-dialog ui-dialog shadow-2xl w-full max-w-none h-full flex flex-col overflow-hidden transition-colors">
        {borrowed
          ? <div ref={setSlot} className="note-editor-slot" />
          : <NoteEditor key={`${props.draftScope}:${note.path}`} {...props} note={note} frame="zoom" active
            onClose={editing.closeZoom} onAddToFocus={editing.addToFocus(note)} />}
      </div>
    </div>
  );
};
