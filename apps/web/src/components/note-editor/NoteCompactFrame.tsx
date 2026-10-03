import type { RefObject } from 'react';
import { Code2, Eye, ListOrdered } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import type { NoteItem } from '../../lib/types.js';
import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorMode } from '../MarkdownEditor.js';
import { NoteExportMenu } from '../NoteExportMenu.js';
import type { NoteEditorSessionState } from './useNoteEditorSession.js';

interface NoteCompactFrameProps {
  note: NoteItem;
  session: NoteEditorSessionState;
  editorRef: RefObject<MarkdownEditorHandle>;
  isMarkdown: boolean;
  editorMode: MarkdownEditorMode;
  setEditorMode: (mode: MarkdownEditorMode) => void;
  showLineNumbers: boolean;
  toggleLineNumbers: () => void;
  onCaret?: (position: number) => void;
}

/** A graph card's editor: the body alone with a status bar of mode, line number and export actions. */
export function NoteCompactFrame({ note, session, editorRef, isMarkdown, editorMode, setEditorMode, showLineNumbers, toggleLineNumbers, onCaret }: NoteCompactFrameProps) {
  const { t } = useTranslation();
  const live = editorMode === 'live';
  const modeLabel = t(live ? 'editor.source' : 'editor.livePreview');
  return (
    <>
      <div className='note-editor-body'>
        <MarkdownEditor ref={editorRef} compact content={session.content} path={note.path} notebookId={note.notebookId} mode={editorMode} readOnly={session.locked} onChange={session.setContent} onCaret={onCaret} ariaLabel='Note content' showLineNumbers={showLineNumbers} lineNumberOffset={session.baseNote.lineNumberOffset} />
      </div>
      <div className='note-compact-bar'>
        {isMarkdown && <button type='button' className='ui-icon-button' data-mode-toggle={editorMode} title={modeLabel} aria-label={modeLabel} onClick={() => setEditorMode(live ? 'raw' : 'live')}>{live ? <Code2 size={14} aria-hidden='true' /> : <Eye size={14} aria-hidden='true' />}</button>}
        <button type='button' className='ui-icon-button' aria-pressed={showLineNumbers} title={t('editor.lineNumbers')} aria-label={t('editor.lineNumbers')} onClick={toggleLineNumbers}>
          <ListOrdered size={14} aria-hidden='true' />
        </button>
        <NoteExportMenu className='ui-icon-button' iconSize={14} path={note.path} notebookId={note.notebookId} title={session.title} content={session.content} copyState={session.copyState} onCopy={session.copyNote} />
        <span className='note-compact-path' title={note.path}>{note.notebookId}{' · '}{note.path.split('/').pop()}</span>
        <span role='status' className='note-compact-status' data-state={session.editorState}>
          <span className={`note-compact-dot ${session.editorState === 'saving' ? 'animate-pulse' : ''}`} aria-hidden='true' />
          {session.editorStatus}
        </span>
      </div>
    </>
  );
}
