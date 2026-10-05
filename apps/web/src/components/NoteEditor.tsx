import { EditorFooter } from './EditorFooter.js';
import { ListTree } from 'lucide-react';
import { useOutlineActions, useOutlineInsertion } from '../lib/outline-actions.js';
import { useTranslation } from '../lib/i18n/index.js';
import { NoteQuickActions } from './note-editor/NoteQuickActions.js';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorMode } from './MarkdownEditor.js';
import type { NoteItem } from '../lib/types.js';
import { usePanelContext } from '../lib/panel-context.js';
import { usePhone } from '../lib/use-phone.js';
import { type NoteEditorSessionState, useNoteEditorSession } from './note-editor/useNoteEditorSession.js';
import { useNoteDocumentPanel } from './note-editor/useNoteDocumentPanel.js';
import { NoteEditorNotices } from './note-editor/NoteEditorNotices.js';
import { NoteCompactFrame } from './note-editor/NoteCompactFrame.js';
import { NoteEditorToolbar } from './note-editor/NoteEditorToolbar.js';
import { NoteEditorDocumentPanel } from './note-editor/NoteEditorDocumentPanel.js';
import { NoteEditorLeader } from './note-editor/NoteEditorLeader.js';
import { useNoteDiffStats } from './note-editor/useNoteDiffStats.js';
import { noteViewStyle, readShowFormatToolbar, readShowLineNumbers, useNoteViewPreferences, writeShowFormatToolbar, writeShowLineNumbers } from '../lib/editor-preferences.js';
import type { NoteEditorSession, NoteEditorSharedProps, NotePanelMode } from './note-editor/types.js';

export interface NoteEditorHandle {
  /** Inserts `text` at `at`, or at the caret; no-op while the session is locked. */
  insert: (text: string, at?: number) => void;
}

export interface NoteEditorProps extends NoteEditorSharedProps {
  note: NoteItem;
  /**
   * `zoom` fills the full-screen dialog and keeps its own document panel; `pane` sits in a Focus pane;
   * `compact` is the body alone with a status bar, for a graph card.
   */
  frame: 'zoom' | 'pane' | 'compact';
  /** The active editor answers document-level shortcuts and Escape. */
  active: boolean;
  /** Pane frame: the right rail chooses the document panel section and hosts it. */
  documentPanel?: { target: HTMLElement | null; mode: NotePanelMode | null; onChange: (mode: NotePanelMode | null) => void; };
  /** Zoom frame: saves, then leaves zoom. */
  onClose?: () => void;
  onAddToFocus?: () => void;
  /** Opens the folder picker that moves the note; absent when its notebook is read-only. */
  onMove?: () => void;
  /** Opens the dialog that renames the note, prefilled with its current title; absent when its notebook is read-only. */
  onRename?: (title: string) => void;
  /** Reports the session whenever it changes, and null when the editor unmounts. */
  onSession?: (session: NoteEditorSession | null) => void;
  onCaret?: (position: number) => void;
}

/** The footer's actions: Refresh unless zoom shows it beside the title, and Commit and Restore for an editable dirty note. */
function footerActions({ frame, readOnly, session, refresh, canCommit }: { frame: NoteEditorProps['frame']; readOnly: boolean; session: NoteEditorSessionState; refresh?: () => Promise<void>; canCommit: boolean; }) {
  const editable = !readOnly && session.isDirty;
  return { onRefresh: frame === 'zoom' ? undefined : refresh, onCommit: editable && canCommit && !session.blocked ? session.commitNote : undefined, onRestore: editable ? session.restoreNote : undefined };
}

/** A note's editing session: content, frontmatter, drafts, autosave, conflicts, crash recovery and the document panel. */
export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(({ note, frame, active, documentPanel, onClose, onAddToFocus, onMove, onRename, onSession, onCaret, statuses, metadataFields, readOnly = false, autoSave = true, draftMode = false, remoteBase, conflictReason, onMarkConflict, onSave, onReadRemote, onRestoreFile, onCommitFile, readDiff, isDirty: propIsDirty = false, availableTags = [], beforeFileChange, onFilesChanged, branch, draftScope }, ref) => {
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(note.path);
  const { setHasOpenNote } = usePanelContext();
  // The workspace rail hides only behind zoom; a pane editor shares the page with it. It hides before the
  // first paint, so zoom opens at its final width instead of widening once the rail has gone.
  useLayoutEffect(() => {
    if (frame !== 'zoom') return;
    setHasOpenNote(true);
    return () => setHasOpenNote(false);
  }, [frame, setHasOpenNote]);

  const [editorMode, setEditorMode] = useState<MarkdownEditorMode>('live');
  const [showLineNumbers, setShowLineNumbers] = useState(() => readShowLineNumbers());
  const toggleLineNumbers = () =>
    setShowLineNumbers(value => {
      const next = !value;
      writeShowLineNumbers(next);
      return next;
    });
  const [showFormatToolbar, setShowFormatToolbar] = useState(() => readShowFormatToolbar());
  const toggleFormatToolbar = () =>
    setShowFormatToolbar(value => {
      const next = !value;
      writeShowFormatToolbar(next);
      return next;
    });
  const viewPreferences = useNoteViewPreferences();
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);

  const session = useNoteEditorSession({ note, readOnly, autoSave, draftMode, remoteBase, conflictReason, onMarkConflict, onSave, onReadRemote, onRestoreFile, onCommitFile, propIsDirty, branch, draftScope, onClose, onSession });
  const outlines = useOutlineActions();
  const awaitingRecovery = useOutlineInsertion(note, session, editorRef);
  const addToOutline = outlines?.canAdd(note.notebookId) && !session.locked ? () => outlines.add({ ...note, title: session.title, content: session.content }) : undefined;
  // A graph card has no footer to show the counts in.
  const { t } = useTranslation();
  const changes = useNoteDiffStats(frame === 'compact' ? undefined : readDiff, session.isDirty, !session.isSaving && !session.hasUnsavedChanges);
  const refresh = onReadRemote && !session.blocked ? session.pullLatest : undefined;
  const docPanel = useNoteDocumentPanel({ frame, active, isMarkdown, content: session.content, editorMode, documentPanel, editorRef, metadata: session.metadata, notePath: note.path, branch, draftScope, readOnly });

  // A phone opens every note for reading: a long press then only selects text instead of raising the keyboard,
  // whose resize moved the page under the selection. Editing starts from the toolbar's Edit button.
  const phone = usePhone();
  const [editing, setEditing] = useState(false);
  const reading = phone && !editing && !session.locked;
  const finishEditing = () => {
    setEditing(false);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  // An insert made while reading switches to editing first; the editor drops inserts while it is read-only,
  // so the text waits until the editor has become writable.
  const pendingInserts = useRef<(() => void)[]>([]);
  const insert = (text: string, at?: number) => {
    if (session.locked) return;
    if (!reading) return editorRef.current?.insert(text, at);
    pendingInserts.current.push(() => editorRef.current?.insert(text, at));
    setEditing(true);
  };
  useEffect(() => {
    if (!reading) { for (const flush of pendingInserts.current.splice(0)) flush(); }
  }, [reading]);

  useImperativeHandle(ref, () => ({ insert }));

  // Insert markdown asset reference at cursor position or append
  const handleInsertAssetRef = (ref: string) => {
    if (session.locked) return;
    insert(`\n${ref}\n`);
    docPanel.setNotePanel(null);
  };

  if (frame === 'compact') {
    return (
      <div className='note-editor' data-frame={frame} data-source-notebook={note.notebookId}>
        <NoteEditorNotices session={session} notePath={note.path} />
        {addToOutline && (
          <button type='button' className='ui-icon-button' title={t('outline.add')} aria-label={t('outline.add')} onClick={addToOutline}>
            <ListTree aria-hidden='true' />
          </button>
        )}
        {awaitingRecovery && (
          <p role='status'>
            {t('outline.recoveryPending')} <button type='button' className='ui-button' onClick={() => outlines?.cancel()}>{t('common.cancel')}</button>
          </p>
        )}
        <NoteCompactFrame note={note} session={session} editorRef={editorRef} isMarkdown={isMarkdown} editorMode={editorMode} setEditorMode={setEditorMode} showLineNumbers={showLineNumbers} toggleLineNumbers={toggleLineNumbers} onCaret={onCaret} />
      </div>
    );
  }

  const panel = { ...docPanel, isMarkdown, notePath: note.path, content: session.content, lineNumberOffset: session.baseNote.lineNumberOffset || 0, metadata: session.metadata, setMetadata: session.setMetadata, statuses, metadataFields, availableTags, locked: session.locked, notebookId: note.notebookId, onInsertAssetRef: handleInsertAssetRef, readOnly, beforeFileChange, onFilesChanged };
  return (
    <div className='note-editor' data-frame={frame} data-source-notebook={note.notebookId} style={noteViewStyle(viewPreferences)}>
      <NoteEditorNotices session={session} notePath={note.path} />
      <NoteEditorToolbar frame={frame} note={note} session={session} docPanel={docPanel} isMarkdown={isMarkdown} autoSave={autoSave} readOnly={readOnly} editorMode={editorMode} setEditorMode={setEditorMode} showLineNumbers={showLineNumbers} toggleLineNumbers={toggleLineNumbers} showFormatToolbar={showFormatToolbar} toggleFormatToolbar={isMarkdown && !session.locked && !reading ? toggleFormatToolbar : undefined} phoneEditing={phone && !session.locked ? { editing, onEdit: () => setEditing(true), onDone: finishEditing } : undefined} onRefresh={refresh} onClose={onClose} onAddToFocus={onAddToFocus} onMove={readOnly ? undefined : onMove} onRename={readOnly || !onRename ? undefined : () => onRename(session.title)} onAddToOutline={addToOutline} />
      {awaitingRecovery && (
        <p role='status'>
          {t('outline.recoveryPending')} <button type='button' className='ui-button' onClick={() => outlines?.cancel()}>{t('common.cancel')}</button>
        </p>
      )}
      {showFormatToolbar && !reading && <div ref={setToolbarSlot} className='note-format-toolbar' />}
      <div className='note-editor-body'>
        <MarkdownEditor ref={editorRef} content={session.content} path={note.path} notebookId={note.notebookId} mode={editorMode} readOnly={session.locked || reading} onChange={session.setContent} onCaret={onCaret} toolbarSlot={showFormatToolbar ? toolbarSlot : null} ariaLabel='Note content' showLineNumbers={showLineNumbers} lineNumberOffset={session.baseNote.lineNumberOffset} />
        <NoteEditorDocumentPanel frame={frame} target={documentPanel?.target} notePanel={docPanel.notePanel} panel={panel} />
      </div>
      <EditorFooter content={session.content} path={note.path} state={session.editorState} status={session.editorStatus} actions={<NoteQuickActions {...footerActions({ frame, readOnly, session, refresh, canCommit: Boolean(onCommitFile) })} changes={changes} disabled={session.isSaving} />} />
      {docPanel.isEditorLeaderOpen && <NoteEditorLeader docPanel={docPanel} isMarkdown={isMarkdown} />}
    </div>
  );
});
NoteEditor.displayName = 'NoteEditor';
