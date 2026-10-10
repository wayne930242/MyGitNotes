import { noteRefKey, sameNote } from '@mygitnotes/core/note-query';
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Pencil } from 'lucide-react';
import type { NoteItem } from '../lib/types.js';
import { useNoteEditing } from '../lib/note-editing.js';
import { useNoteLookup } from '../lib/use-note-queries.js';
import { renderNote } from '../lib/markdown.js';
import { useTranslation } from '../lib/i18n/index.js';
import { NoteEditor, type NoteEditorHandle, type NoteEditorProps } from './NoteEditor.js';
import { youtubeLabels } from '../lib/youtube-embed.js';
import { LoadingStatus } from './LoadingStatus.js';
import { NoteHtml } from './NoteHtml.js';

export interface HostedNoteEditorProps {
  notebookId: string;
  path: string;
  frame: 'pane' | 'compact' | 'inline';
  active: boolean;
  documentPanel?: NoteEditorProps['documentPanel'];
  editorRef?: React.Ref<NoteEditorHandle>;
  onSession?: NoteEditorProps['onSession'];
  onCaret?: NoteEditorProps['onCaret'];
  /** Mounted because the person asked to edit here: the host takes the note's editor from its owner instead of showing the preview. */
  claim?: boolean;
}

/**
 * A place that shows a note's editor: a Focus pane, a graph card, or a compilation's card or Book section. A note has one mounted editor across
 * these hosts and zoom. The owning host renders it into a stable element so zoom can borrow it without
 * remounting; while zoom shows the note the other hosts say so, and otherwise they show a preview with a
 * control that moves editing there.
 */
export const HostedNoteEditor: React.FC<HostedNoteEditorProps> = ({ notebookId, path, frame, active, documentPanel, editorRef, onSession, onCaret, claim = false }) => {
  const { t } = useTranslation();
  const editing = useNoteEditing();
  const { hosts } = editing;
  const id = useId();
  const key = noteRefKey({ notebookId, path });
  useSyncExternalStore(hosts.subscribe, hosts.snapshot);
  useLayoutEffect(() => {
    hosts.register(key, id);
    return () => hosts.release(key, id);
  }, [hosts, key, id]);
  const owner = hosts.owner(key) === id;
  // A host that was asked to edit claims the note once it is registered; until the claim settles it shows the loading status, and a failed claim leaves the preview with its Edit here button.
  const [claiming, setClaiming] = useState(claim);
  const claimed = useRef(false);
  const { claimEditor } = editing;
  useEffect(() => {
    if (!claim || claimed.current) return;
    claimed.current = true;
    // The first host of a note is its owner already and has nothing to claim.
    if (hosts.owner(key) === id) return;
    void claimEditor(key, id).finally(() => setClaiming(false));
  }, [claim, claimEditor, hosts, key, id]);
  // An owner has nothing left to claim or wait for; a host that loses the note later shows the preview, not the loading status.
  if (owner && claiming) setClaiming(false);
  const lookup = useNoteLookup([{ notebookId, path }], true);
  const found = lookup.notes[0], committed = lookup.committed[0];
  const loaded = found && typeof found.content === 'string' ? found as NoteItem : null;
  const zoom = editing.zoom?.key === key ? editing.zoom : null;
  const lending = owner && Boolean(zoom?.borrowed);
  const showsEditor = owner && (!zoom || lending);
  // Like zoom, the editor keeps the note it opened and follows only its own saves.
  const [pinned, setPinned] = useState<NoteItem | null>(null);
  if (!showsEditor && pinned) setPinned(null);
  else if (showsEditor && !pinned && loaded) setPinned(loaded);
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
  if (!note) return lookup.error ? <p className='note-editor-placeholder' role='alert'>{lookup.error}</p> : <LoadingStatus className='note-editor-placeholder'>{t('notes.loadingNote')}</LoadingStatus>;
  if (!owner && claim && claiming) return <LoadingStatus className='note-editor-placeholder'>{t('notes.loadingNote')}</LoadingStatus>;
  if (!owner) return <NotePreview note={note} onClaim={() => void editing.claimEditor(key, id)} />;
  const props = editing.editorProps(note, committed && typeof committed.content === 'string' ? committed as NoteItem : undefined);
  return (
    <>
      <div ref={setSlot} className='note-editor-slot' />
      {lending && <p className='note-editor-placeholder' role='status'>{t('focus.editingInZoom')}</p>}
      {createPortal(
        <NoteEditor
          ref={editorRef}
          key={`${props.draftScope}:${key}`}
          {...props}
          note={note}
          onSave={async params => {
            const saved = await props.onSave(params);
            setPinned(current => current && sameNote(current, saved) ? saved : current);
            return saved;
          }}
          frame={lending ? 'zoom' : frame}
          active={lending || (active && !editing.zoom)}
          documentPanel={lending ? undefined : documentPanel}
          onClose={lending ? editing.closeZoom : undefined}
          onAddToFocus={lending ? editing.addToFocus(note) : undefined}
          onMove={editing.moveNote?.(note)}
          onRename={editing.renameNote?.(note) && (title => editing.renameNote?.({ ...note, title })?.())}
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
  const html = useMemo(() => renderNote(note.content, note.path, tableLabel, youtubeLabels(t), note.notebookId), [note.content, note.path, note.notebookId, tableLabel, t]);
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
        <NoteHtml className='prose-custom screen-markdown' html={html} notebookId={note.notebookId} />
      </div>
    </div>
  );
};
