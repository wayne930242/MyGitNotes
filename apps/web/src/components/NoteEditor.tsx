import { EditorFooter } from './EditorFooter.js';
import { NoteQuickActions } from './note-editor/NoteQuickActions.js';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorMode } from './MarkdownEditor.js';
import type { NoteItem } from '../lib/types.js';
import { usePanelContext } from '../lib/panel-context.js';
import { type NoteEditorSessionState, useNoteEditorSession } from './note-editor/useNoteEditorSession.js';
import { useNoteDocumentPanel } from './note-editor/useNoteDocumentPanel.js';
import { NoteEditorNotices } from './note-editor/NoteEditorNotices.js';
import { NoteCompactFrame } from './note-editor/NoteCompactFrame.js';
import { NoteEditorToolbar } from './note-editor/NoteEditorToolbar.js';
import { NoteEditorDocumentPanel } from './note-editor/NoteEditorDocumentPanel.js';
import { NoteEditorLeader } from './note-editor/NoteEditorLeader.js';
import { useNoteDiffStats } from './note-editor/useNoteDiffStats.js';
import { noteViewStyle, readShowLineNumbers, useNoteViewPreferences, writeShowLineNumbers } from '../lib/editor-preferences.js';
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
export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(({ note, frame, active, documentPanel, onClose, onAddToFocus, onSession, onCaret, statuses, metadataFields, readOnly = false, autoSave = true, draftMode = false, remoteBase, conflictReason, onMarkConflict, onSave, onReadRemote, onRestoreFile, onCommitFile, readDiff, isDirty: propIsDirty = false, availableTags = [], beforeFileChange, onFilesChanged, branch, draftScope }, ref) => {
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(note.path);
  const { setHasOpenNote } = usePanelContext();
  // The workspace rail hides only behind zoom; a pane editor shares the page with it.

  useEffect(() => {
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
  const viewPreferences = useNoteViewPreferences();
  const [insertSlot, setInsertSlot] = useState<HTMLDivElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);

  const session = useNoteEditorSession({ note, readOnly, autoSave, draftMode, remoteBase, conflictReason, onMarkConflict, onSave, onReadRemote, onRestoreFile, onCommitFile, propIsDirty, branch, draftScope, onClose, onSession });
  // A graph card has no footer to show the counts in.
  const changes = useNoteDiffStats(frame === 'compact' ? undefined : readDiff, session.isDirty, !session.isSaving && !session.hasUnsavedChanges);
  const refresh = onReadRemote && !session.blocked ? session.pullLatest : undefined;
  const docPanel = useNoteDocumentPanel({ frame, active, isMarkdown, content: session.content, editorMode, documentPanel, editorRef, metadata: session.metadata, notePath: note.path, branch, draftScope, readOnly });

  useImperativeHandle(ref, () => ({
    insert(text, at) {
      if (!session.locked) editorRef.current?.insert(text, at);
    },
  }), [session.locked]);

  // Insert markdown asset reference at cursor position or append
  const handleInsertAssetRef = (ref: string) => {
    if (session.locked) return;
    editorRef.current?.insert(`\n${ref}\n`);
    docPanel.setNotePanel(null);
  };

  if (frame === 'compact') {
    return (
      <div className='note-editor' data-frame={frame} data-source-notebook={note.notebookId}>
        <NoteEditorNotices session={session} notePath={note.path} />
        <NoteCompactFrame note={note} session={session} editorRef={editorRef} isMarkdown={isMarkdown} editorMode={editorMode} setEditorMode={setEditorMode} showLineNumbers={showLineNumbers} toggleLineNumbers={toggleLineNumbers} onCaret={onCaret} />
      </div>
    );
  }

  const panel = { ...docPanel, isMarkdown, notePath: note.path, content: session.content, lineNumberOffset: session.baseNote.lineNumberOffset || 0, metadata: session.metadata, setMetadata: session.setMetadata, statuses, metadataFields, availableTags, locked: session.locked, notebookId: note.notebookId, onInsertAssetRef: handleInsertAssetRef, readOnly, beforeFileChange, onFilesChanged };
  return (
    <div className='note-editor' data-frame={frame} data-source-notebook={note.notebookId} style={noteViewStyle(viewPreferences)}>
      <NoteEditorNotices session={session} notePath={note.path} />
      <NoteEditorToolbar frame={frame} note={note} session={session} docPanel={docPanel} isMarkdown={isMarkdown} autoSave={autoSave} readOnly={readOnly} editorMode={editorMode} setEditorMode={setEditorMode} showLineNumbers={showLineNumbers} toggleLineNumbers={toggleLineNumbers} setInsertSlot={setInsertSlot} onRefresh={refresh} onClose={onClose} onAddToFocus={onAddToFocus} />
      <div className='note-editor-body'>
        <MarkdownEditor ref={editorRef} content={session.content} path={note.path} notebookId={note.notebookId} mode={editorMode} readOnly={session.locked} onChange={session.setContent} onCaret={onCaret} insertSlot={insertSlot} ariaLabel='Note content' showLineNumbers={showLineNumbers} lineNumberOffset={session.baseNote.lineNumberOffset} />
        <NoteEditorDocumentPanel frame={frame} target={documentPanel?.target} notePanel={docPanel.notePanel} panel={panel} />
      </div>
      <EditorFooter content={session.content} path={note.path} state={session.editorState} status={session.editorStatus} actions={<NoteQuickActions {...footerActions({ frame, readOnly, session, refresh, canCommit: Boolean(onCommitFile) })} changes={changes} disabled={session.isSaving} />} />
      {docPanel.isEditorLeaderOpen && <NoteEditorLeader docPanel={docPanel} isMarkdown={isMarkdown} />}
    </div>
  );
});
NoteEditor.displayName = 'NoteEditor';
