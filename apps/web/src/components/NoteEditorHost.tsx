import React, { useEffect, useId, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Pencil } from 'lucide-react';
import type { NoteItem } from '../lib/types.js';
import { useNoteEditing } from '../lib/note-editing.js';
import { useNoteLookup } from '../lib/use-note-queries.js';
import { renderNote } from '../lib/markdown.js';
import { useTranslation } from '../lib/i18n/index.js';
import { NoteEditor, type NoteEditorHandle, type NoteEditorProps } from './NoteEditor.js';
import { youtubeLabels } from '../lib/youtube-embed.js';

export interface HostedNoteEditorProps {
  path: string;
  frame: 'pane' | 'compact';
  active: boolean;
  documentPanel?: NoteEditorProps['documentPanel'];
  editorRef?: React.Ref<NoteEditorHandle>;
  onSession?: NoteEditorProps['onSession'];
  onCaret?: NoteEditorProps['onCaret'];
}

/**
 * A place that shows a note's editor: a Focus pane or a graph card. A note has one mounted editor across
 * these hosts and zoom. The owning host renders it into a stable element so zoom can borrow it without
 * remounting; while zoom shows the note the other hosts say so, and otherwise they show a preview with a
 * control that moves editing there.
 */
export const HostedNoteEditor: React.FC<HostedNoteEditorProps> = ({ path, frame, active, documentPanel, editorRef, onSession, onCaret }) => {
  const { t } = useTranslation();
  const editing = useNoteEditing();
  const { hosts } = editing;
  const id = useId();
  useSyncExternalStore(hosts.subscribe, hosts.snapshot);
  useLayoutEffect(() => {
    hosts.register(path, id);
    return () => hosts.release(path, id);
  }, [hosts, path, id]);
  const owner = hosts.owner(path) === id;
  const lookup = useNoteLookup([path], true);
  const found = lookup.notes[0], committed = lookup.committed[0];
  const loaded = found && typeof found.content === 'string' ? found as NoteItem : null;
  const zoom = editing.zoom?.path === path ? editing.zoom : null;
  const lending = owner && Boolean(zoom?.borrowed);
  const showsEditor = owner && (!zoom || lending);
  // Like zoom, the editor keeps the note it opened and follows only its own saves.
  const [pinned, setPinned] = useState<NoteItem | null>(null);
  useEffect(() => {
    if (!showsEditor) setPinned(null);
    else if (!pinned && loaded) setPinned(loaded);
  }, [showsEditor, pinned, loaded]);
  const note = (showsEditor && pinned) || loaded;

  const zoomSlot = lending ? zoom!.slot : null;
  const [host] = useState(() => {
    const element = document.createElement('div');
    element.className = 'note-editor-host';
    return element;
  });
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const parent = zoomSlot ?? slot;
    if (!parent) return;
    parent.appendChild(host);
    return () => host.remove();
  }, [zoomSlot, slot, host]);

  if (zoom && !lending) return <p className='note-editor-placeholder' role='status'>{t('focus.editingInZoom')}</p>;
  if (!note) return <p className='note-editor-placeholder' role={lookup.error ? 'alert' : 'status'}>{lookup.error || t('notes.loadingNote')}</p>;
  if (!owner) return <NotePreview note={note} onClaim={() => void editing.claimEditor(path, id)} />;
  const props = editing.editorProps(note, committed && typeof committed.content === 'string' ? committed as NoteItem : undefined);
  return (
    <>
      <div ref={setSlot} className='note-editor-slot' />
      {lending && <p className='note-editor-placeholder' role='status'>{t('focus.editingInZoom')}</p>}
      {createPortal(
        <NoteEditor
          ref={editorRef}
          key={`${props.draftScope}:${path}`}
          {...props}
          note={note}
          onSave={async params => {
            const saved = await props.onSave(params);
            setPinned(current => current?.path === saved.path ? saved : current);
            return saved;
          }}
          frame={lending ? 'zoom' : frame}
          active={lending || (active && !editing.zoom)}
          documentPanel={lending ? undefined : documentPanel}
          onClose={lending ? editing.closeZoom : undefined}
          onAddToFocus={lending ? editing.addToFocus(note) : undefined}
          onSession={onSession}
          onCaret={onCaret}
        />,
        host,
      )}
    </>
  );
};

/** The note as another host is editing it, with the control that moves editing here. */
const NotePreview: React.FC<{ note: NoteItem; onClaim: () => void; }> = ({ note, onClaim }) => {
  const { t } = useTranslation();
  const tableLabel = t('preview.scrollableTable');
  const html = useMemo(() => renderNote(note.content, note.path, tableLabel, youtubeLabels(t)), [note.content, note.path, tableLabel, t]);
  return (
    <div className='note-preview'>
      <div className='note-preview-bar'>
        <span>{t('editor.editingElsewhere')}</span>
        <button type='button' className='ui-button' onClick={onClaim}>
          <Pencil size={13} aria-hidden='true' />
          {t('editor.editHere')}
        </button>
      </div>
      <div className='note-preview-body'>
        <div className='prose-custom screen-markdown' data-markdown-view dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
};
