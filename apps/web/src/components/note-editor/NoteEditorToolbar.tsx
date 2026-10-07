import { ArrowLeft, Check, FileText, FolderInput, History, LayoutGrid, ListOrdered, ListTree, PanelRight, Pencil, Save, Type } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import type { NoteItem } from '../../lib/types.js';
import { Button } from '../Button.js';
import { type MarkdownEditorMode, MarkdownEditorModeSwitch } from '../MarkdownEditor.js';
import { NoteExportMenu } from '../NoteExportMenu.js';
import { NoteRefreshAction } from './NoteQuickActions.js';
import type { NoteDocumentPanelState } from './useNoteDocumentPanel.js';
import type { NoteEditorSessionState } from './useNoteEditorSession.js';

interface NoteEditorToolbarProps {
  frame: 'zoom' | 'pane';
  note: NoteItem;
  session: NoteEditorSessionState;
  docPanel: NoteDocumentPanelState;
  isMarkdown: boolean;
  autoSave: boolean;
  readOnly: boolean;
  editorMode: MarkdownEditorMode;
  setEditorMode: (mode: MarkdownEditorMode) => void;
  showLineNumbers: boolean;
  toggleLineNumbers: () => void;
  showFormatToolbar: boolean;
  /** Present when the note offers a formatting toolbar: an editable Markdown note. */
  toggleFormatToolbar?: () => void;
  /** Present when the note can pull its latest version; zoom shows it beside the title. */
  onRefresh?: () => Promise<void>;
  onClose?: () => void;
  onAddToFocus?: () => void;
  onAddToOutline?: () => void;
  /** Moves the note to another folder of its notebook; a new note starts at the root and is filed from here. */
  onMove?: () => void;
  /** Renames the note, its title and the file name that follows from it; zoom offers it on the title. */
  onRename?: () => void;
  /** On a phone, where a note opens for reading: whether it is being edited, and the buttons that switch. */
  phoneEditing?: { editing: boolean; onEdit: () => void; onDone: () => void; };
  /** Opens the note's history and versions. */
  onOpenHistory?: () => void;
}

/** Switches a phone's note between reading and editing; zoom puts it in the heading, where the control row has no room. */
function PhoneEditToggle({ editing, onEdit, onDone }: NonNullable<NoteEditorToolbarProps['phoneEditing']>) {
  const { t } = useTranslation();
  return (
    <Button variant={editing ? 'primary' : undefined} className='note-edit-toggle' onClick={editing ? onDone : onEdit}>
      {editing ? <Check aria-hidden='true' /> : <Pencil aria-hidden='true' />}
      <span>{t(editing ? 'editor.finishEditing' : 'editor.startEditing')}</span>
    </Button>
  );
}

/** Reopens the section the panel showed last; an outline falls back to find for a note that is not Markdown. */
function togglePanel(docPanel: NoteDocumentPanelState, isMarkdown: boolean) {
  const last = docPanel.lastNotePanel.current;
  if (docPanel.notePanel) docPanel.setNotePanel(null);
  else if (last === 'find' || (last === 'outline' && !isMarkdown)) docPanel.openFind();
  else if (last === 'outline') docPanel.openOutline();
  else docPanel.setNotePanel(last);
}

function NoteZoomHeading({ note, session, onRefresh, onClose, onRename, phoneEditing }: Pick<NoteEditorToolbarProps, 'note' | 'session' | 'onRefresh' | 'onClose' | 'onRename' | 'phoneEditing'>) {
  const { t } = useTranslation();
  return (
    <div className='note-heading flex items-center gap-3 min-w-0'>
      {/* Leaving zoom sits at the far left, away from the document-panel toggle at the right. */}
      {onClose
        ? (
          <button type='button' aria-label={t('editor.closeNote')} title={t('editor.closeNote')} onClick={session.close} className='note-close ui-icon-button toolbar-icon-button shrink-0'>
            <ArrowLeft aria-hidden='true' />
          </button>
        )
        : (
          <div className='note-heading-icon w-8 h-8 rounded-lg flex items-center justify-center shrink-0'>
            <FileText className='w-4 h-4' />
          </div>
        )}
      <div className='truncate'>
        {onRename ? <button type='button' className='title-rename font-serif font-semibold text-fg text-sm truncate max-w-full' disabled={session.locked} title={t('files.rename')} onClick={onRename}>{session.title || t('editor.untitled')}</button> : <div className='font-serif font-semibold text-fg text-sm truncate'>{session.title || t('editor.untitled')}</div>}
        <div className='text-xs text-muted font-mono truncate'>{note.path}</div>
      </div>
      {onRefresh && <NoteRefreshAction className='shrink-0' onRefresh={onRefresh} disabled={session.isSaving} />}
      {phoneEditing && <PhoneEditToggle {...phoneEditing} />}
    </div>
  );
}

/** The zoom and pane editor's top bar: the zoom title, then save, mode, line number, export, Focus, formatting toolbar and panel actions. */
export function NoteEditorToolbar({ frame, note, session, docPanel, isMarkdown, autoSave, readOnly, editorMode, setEditorMode, showLineNumbers, toggleLineNumbers, showFormatToolbar, toggleFormatToolbar, onRefresh, onClose, onAddToFocus, onAddToOutline, onMove, onRename, phoneEditing, onOpenHistory }: NoteEditorToolbarProps) {
  const { t } = useTranslation();
  const zoom = frame === 'zoom';
  return (
    <div className='note-toolbar relative shrink-0 px-5 py-3.5 border-b border-line flex items-center justify-between gap-4 bg-sidebar/60'>
      {zoom && <NoteZoomHeading note={note} session={session} onRefresh={onRefresh} onClose={onClose} onRename={onRename} phoneEditing={phoneEditing} />}
      <div className='note-controls flex items-center gap-2'>
        {!autoSave && !readOnly && (
          <Button variant='primary' aria-label={t('editor.saveToGitHub')} title={t('editor.saveToGitHub')} disabled={session.locked || !session.hasUnsavedChanges} onClick={session.handleExplicitSave} className='note-save editor-action'>
            <Save className='editor-mobile-icon w-5 h-5' />
            <span>{t(session.isSaving ? 'editor.saving' : 'editor.saveToGitHub')}</span>
          </Button>
        )}
        {!zoom && phoneEditing && <PhoneEditToggle {...phoneEditing} />}
        {isMarkdown && <MarkdownEditorModeSwitch mode={editorMode} onChange={setEditorMode} />}
        <button type='button' aria-pressed={showLineNumbers} aria-label={t('editor.lineNumbers')} title={t('editor.lineNumbers')} onClick={toggleLineNumbers} className='ui-icon-button toolbar-icon-button editor-line-numbers-action'>
          <ListOrdered aria-hidden='true' />
        </button>
        {onAddToOutline && (
          <button type='button' className='ui-icon-button toolbar-icon-button' disabled={session.locked} aria-label={t('outline.add')} title={t('outline.add')} onClick={onAddToOutline}>
            <ListTree aria-hidden='true' />
          </button>
        )}
        {onMove && (
          <button type='button' className='ui-icon-button toolbar-icon-button editor-move-action' disabled={session.locked} aria-label={t('files.moveNote')} title={t('files.moveNote')} onClick={onMove}>
            <FolderInput aria-hidden='true' />
          </button>
        )}
        {onOpenHistory && (
          <button type='button' className='ui-icon-button toolbar-icon-button editor-history-action' aria-label={t('history.open')} title={t('history.open')} onClick={onOpenHistory}>
            <History aria-hidden='true' />
          </button>
        )}
        <NoteExportMenu className='ui-icon-button toolbar-icon-button' path={note.path} notebookId={note.notebookId} title={session.title} content={session.content} copyState={session.copyState} onCopy={session.copyNote} />
        {onAddToFocus && (
          <button type='button' aria-label={t('focus.addTo')} title={t('focus.addTo')} onClick={onAddToFocus} className='ui-icon-button toolbar-icon-button'>
            <LayoutGrid aria-hidden='true' />
          </button>
        )}
        {toggleFormatToolbar && (
          <button type='button' aria-pressed={showFormatToolbar} aria-label={t('editor.formatToolbar')} title={t('editor.formatToolbar')} onClick={toggleFormatToolbar} className='ui-icon-button toolbar-icon-button editor-format-toolbar-action'>
            <Type aria-hidden='true' />
          </button>
        )}
        {zoom && (
          <button type='button' aria-label={t('editor.documentPanel')} title={t('editor.documentPanel')} aria-pressed={Boolean(docPanel.notePanel)} onClick={() => togglePanel(docPanel, isMarkdown)} className='ui-icon-button toolbar-icon-button editor-panel-action'>
            <PanelRight aria-hidden='true' />
          </button>
        )}
      </div>
    </div>
  );
}
