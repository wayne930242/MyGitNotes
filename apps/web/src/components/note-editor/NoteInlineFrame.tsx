import type { RefObject } from 'react';
import type { NoteItem } from '../../lib/types.js';
import { MarkdownEditor, type MarkdownEditorHandle } from '../MarkdownEditor.js';
import type { NoteEditorSessionState } from './useNoteEditorSession.js';

interface NoteInlineFrameProps {
  note: NoteItem;
  session: NoteEditorSessionState;
  editorRef: RefObject<MarkdownEditorHandle>;
  onCaret?: (position: number) => void;
}

/** A card's or Book section's editor: the note as it reads, in a column with no page, then one quiet line of save state. */
export function NoteInlineFrame({ note, session, editorRef, onCaret }: NoteInlineFrameProps) {
  return (
    <>
      <div className='note-editor-body'>
        <MarkdownEditor ref={editorRef} compact continuous content={session.content} path={note.path} notebookId={note.notebookId} mode='live' readOnly={session.locked} onChange={session.setContent} onCaret={onCaret} ariaLabel='Note content' showLineNumbers={false} />
      </div>
      <p role='status' className='note-inline-status' data-state={session.editorState}>
        <span className={`note-compact-dot ${session.editorState === 'saving' ? 'animate-pulse' : ''}`} aria-hidden='true' />
        {session.editorStatus}
      </p>
    </>
  );
}
