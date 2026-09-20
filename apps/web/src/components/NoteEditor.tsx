import { EditorNotice } from './EditorNotice.js';
import { EditorFooter } from './EditorFooter.js';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Code2, Copy, Eye, FileText, LayoutGrid, ListOrdered, PanelRight, Save, X } from 'lucide-react';
import { Button } from './Button.js';
import { MarkdownEditor, MarkdownEditorMode, MarkdownEditorModeSwitch } from './MarkdownEditor.js';
import type { MarkdownEditorHandle } from './MarkdownEditor.js';
import { AssetItem, NotebookMetadataField, NoteItem } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { TranslationKey } from '../lib/i18n/index.js';
import { usePanelContext } from '../lib/panel-context.js';
import { useNoteEditorSession } from './note-editor/useNoteEditorSession.js';
import { useNoteDocumentPanel } from './note-editor/useNoteDocumentPanel.js';
import { NoteDocumentPanel } from './note-editor/NoteDocumentPanel.js';
import { CrashRecoveryBanner } from './CrashRecoveryBanner.js';
import { readShowLineNumbers, writeShowLineNumbers } from '../lib/editor-preferences.js';

export type NotePanelMode = 'find' | 'outline' | 'frontmatter' | 'assets' | 'git';
export const NOTE_PANEL_MODES: readonly NotePanelMode[] = ['outline', 'find', 'frontmatter', 'assets', 'git'];

/** Props every editor of one note shares, whether zoom or a Focus pane frames it. */
export interface NoteEditorSharedProps {
  statuses: string[];
  metadataFields?: NotebookMetadataField[];
  readOnly?: boolean;
  autoSave?: boolean;
  draftMode?: boolean;
  remoteBase?: NoteItem;
  conflictReason?: string;
  onMarkConflict?: (reason: string, draft: NoteItem, base: NoteItem) => void;
  onSave: (params: { path: string; content: string; metadata?: Record<string, unknown>; revision?: string; baseNote?: NoteItem; }) => Promise<NoteItem>;
  onReadRemote?: (path: string) => Promise<NoteItem>;
  onRestoreFile: (path: string) => Promise<NoteItem | null>;
  isDirty?: boolean;
  availableTags?: string[];
  assets?: AssetItem[];
  onUploadAsset?: (file: File, directory: string) => Promise<AssetItem>;
  onDeleteAsset?: (asset: AssetItem) => Promise<void>;
  onMoveAsset?: (asset: AssetItem, directory: string) => Promise<AssetItem>;
  branch: string;
  draftScope?: string;
}

/** What a host that embeds the editor sees of its session, for features it builds on top of the body. */
export interface NoteEditorSession {
  content: string;
  title: string;
  /** Edits not yet saved by the session. */
  dirty: boolean;
  /** No edit is accepted right now: read-only, blocked by a conflict, restoring or saving. */
  locked: boolean;
}

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

/** A note's editing session: content, frontmatter, drafts, autosave, conflicts, crash recovery and the document panel. */
export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(({ note, frame, active, documentPanel, onClose, onAddToFocus, onSession, onCaret, statuses, metadataFields, readOnly = false, autoSave = true, draftMode = false, remoteBase, conflictReason, onMarkConflict, onSave, onReadRemote, onRestoreFile, isDirty: propIsDirty = false, availableTags = [], branch, draftScope }, ref) => {
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(note.path);
  const { t } = useTranslation();
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
  const [insertSlot, setInsertSlot] = useState<HTMLDivElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);

  const session = useNoteEditorSession({ note, readOnly, autoSave, draftMode, remoteBase, conflictReason, onMarkConflict, onSave, onReadRemote, onRestoreFile, propIsDirty, branch, draftScope, onClose, onSession });
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

  return (
    <div className='note-editor' data-frame={frame}>
      <div className='editor-notices'>
        {/* Crash recovery banner if draft differs from disk */}
        {session.recoveredDraft && !session.blocked && <CrashRecoveryBanner draft={{ path: note.path, content: session.recoveredDraft.content, metadata: session.recoveredDraft.metadata, savedAt: session.recoveredDraft.savedAt }} onRestore={session.handleRestoreDraft} onDiscard={session.handleDiscardDraft} />}
        {session.saveError && <EditorNotice tone='error'>{t(session.saveError as TranslationKey, session.saveErrorParams)}</EditorNotice>}
        {(session.blocked || session.showRemoteNotice || session.showConflictDraftNotice) && (
          <EditorNotice
            actions={
              <>
                {session.blocked && <button disabled={session.isSaving} onClick={session.refreshRemote} className='font-semibold underline hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition'>{t('editor.refreshRemote')}</button>}
                {session.conflictDraft && <button onClick={session.downloadConflictDraft} className='underline hover:opacity-80 transition'>{t('editor.downloadPreservedDraft')}</button>}
                {!session.blocked && (
                  <button type='button' aria-label={t('editor.dismissNotice')} title={t('editor.dismissNotice')} onClick={session.dismissNotice} className='ui-icon-button'>
                    <X aria-hidden='true' />
                  </button>
                )}
              </>
            }
          >
            {session.showRemoteNotice ? t(session.remoteNotice as TranslationKey) : t('editor.localChangesPreserved')}
          </EditorNotice>
        )}
      </div>
      {frame === 'compact'
        ? (
          <>
            <div className='note-editor-body'>
              <MarkdownEditor ref={editorRef} compact content={session.content} path={note.path} mode={editorMode} readOnly={session.locked} onChange={session.setContent} onCaret={onCaret} ariaLabel='Note content' showLineNumbers={showLineNumbers} lineNumberOffset={session.baseNote.lineNumberOffset} />
            </div>
            <div className='note-compact-bar'>
              {isMarkdown && <button type='button' className='ui-icon-button' data-mode-toggle={editorMode} title={t(editorMode === 'live' ? 'editor.source' : 'editor.livePreview')} aria-label={t(editorMode === 'live' ? 'editor.source' : 'editor.livePreview')} onClick={() => setEditorMode(editorMode === 'live' ? 'raw' : 'live')}>{editorMode === 'live' ? <Code2 size={14} aria-hidden='true' /> : <Eye size={14} aria-hidden='true' />}</button>}
              <button type='button' className='ui-icon-button' aria-pressed={showLineNumbers} title={t('editor.lineNumbers')} aria-label={t('editor.lineNumbers')} onClick={toggleLineNumbers}>
                <ListOrdered size={14} aria-hidden='true' />
              </button>
              <button type='button' className='ui-icon-button' title={t(session.copyState === 'copied' ? 'editor.noteCopied' : session.copyState === 'error' ? 'editor.noteCopyFailed' : 'editor.copyNote')} aria-label={t(session.copyState === 'copied' ? 'editor.noteCopied' : session.copyState === 'error' ? 'editor.noteCopyFailed' : 'editor.copyNote')} onClick={session.copyNote}>{session.copyState === 'copied' ? <Check size={14} aria-hidden='true' /> : session.copyState === 'error' ? <AlertTriangle size={14} aria-hidden='true' /> : <Copy size={14} aria-hidden='true' />}</button>
              <span className='note-compact-path' title={note.path}>{note.notebookId}{' · '}{note.path.split('/').pop()}</span>
              <span role='status' className='note-compact-status' data-state={session.editorState}>
                <span className={`note-compact-dot ${session.editorState === 'saving' ? 'animate-pulse' : ''}`} aria-hidden='true' />
                {session.editorStatus}
              </span>
            </div>
          </>
        )
        : (
          <>
            {/* Modal Top Bar */}
            <div className='note-toolbar relative shrink-0 px-5 py-3.5 border-b border-line flex items-center justify-between gap-4 bg-sidebar/60'>
              {frame === 'zoom' && (
                <div className='note-heading flex items-center gap-3 truncate'>
                  <div className='w-8 h-8 rounded-lg flex items-center justify-center shrink-0' style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                    <FileText className='w-4 h-4' />
                  </div>
                  <div className='truncate'>
                    <div className='font-serif font-semibold text-fg text-sm truncate'>{session.title || t('editor.untitled')}</div>
                    <div className='text-xs text-muted font-mono truncate'>{note.path}</div>
                  </div>
                </div>
              )}
              <div className='note-controls flex items-center gap-2'>
                {!autoSave && !readOnly && (
                  <Button variant='primary' aria-label={t('editor.saveToGitHub')} title={t('editor.saveToGitHub')} disabled={session.locked || !session.hasUnsavedChanges} onClick={session.handleExplicitSave} className='note-save editor-action'>
                    <Save className='editor-mobile-icon w-5 h-5' />
                    <span>{session.isSaving ? t('editor.saving') : t('editor.saveToGitHub')}</span>
                  </Button>
                )}
                {isMarkdown && <MarkdownEditorModeSwitch mode={editorMode} onChange={setEditorMode} />}
                <button type='button' aria-pressed={showLineNumbers} aria-label={t('editor.lineNumbers')} title={t('editor.lineNumbers')} onClick={toggleLineNumbers} className='ui-icon-button toolbar-icon-button editor-line-numbers-action'>
                  <ListOrdered aria-hidden='true' />
                </button>
                <button type='button' aria-label={t(session.copyState === 'copied' ? 'editor.noteCopied' : session.copyState === 'error' ? 'editor.noteCopyFailed' : 'editor.copyNote')} title={t(session.copyState === 'copied' ? 'editor.noteCopied' : session.copyState === 'error' ? 'editor.noteCopyFailed' : 'editor.copyNote')} onClick={session.copyNote} className='ui-icon-button toolbar-icon-button'>{session.copyState === 'copied' ? <Check aria-hidden='true' /> : session.copyState === 'error' ? <AlertTriangle aria-hidden='true' /> : <Copy aria-hidden='true' />}</button>
                {onAddToFocus && (
                  <button type='button' aria-label={t('focus.addTo')} title={t('focus.addTo')} onClick={onAddToFocus} className='ui-icon-button toolbar-icon-button'>
                    <LayoutGrid aria-hidden='true' />
                  </button>
                )}
                <div ref={setInsertSlot} className='note-insert-actions' />
                {frame === 'zoom' && (
                  <button
                    type='button'
                    aria-label={t('editor.documentPanel')}
                    title={t('editor.documentPanel')}
                    aria-pressed={Boolean(docPanel.notePanel)}
                    onClick={() => {
                      if (docPanel.notePanel) docPanel.setNotePanel(null);
                      else if (docPanel.lastNotePanel.current === 'outline') {
                        if (isMarkdown) docPanel.openOutline();
                        else docPanel.openFind();
                      } else if (docPanel.lastNotePanel.current === 'find') docPanel.openFind();
                      else docPanel.setNotePanel(docPanel.lastNotePanel.current);
                    }}
                    className='ui-icon-button toolbar-icon-button editor-panel-action'
                  >
                    <PanelRight aria-hidden='true' />
                  </button>
                )}
                {/* Close Button */}
                {onClose && (
                  <button aria-label={t('editor.closeNote')} title={t('editor.closeNote')} onClick={session.close} className='note-close ui-icon-button toolbar-icon-button'>
                    <X aria-hidden='true' />
                  </button>
                )}
              </div>
            </div>
            <div className='note-editor-body'>
              <MarkdownEditor ref={editorRef} content={session.content} path={note.path} mode={editorMode} readOnly={session.locked} onChange={session.setContent} onCaret={onCaret} insertSlot={insertSlot} ariaLabel='Note content' showLineNumbers={showLineNumbers} lineNumberOffset={session.baseNote.lineNumberOffset} />
              {frame === 'zoom'
                ? (
                  <aside className='note-document-panel' data-open={Boolean(docPanel.notePanel)} data-panel={docPanel.notePanel || undefined} aria-label={t('editor.documentPanel')}>
                    <NoteDocumentPanel includeTabs isMarkdown={isMarkdown} setNotePanel={docPanel.setNotePanel} isFindOpen={docPanel.isFindOpen} isOutlineOpen={docPanel.isOutlineOpen} showFrontmatter={docPanel.showFrontmatter} isAssetPickerOpen={docPanel.isAssetPickerOpen} isGitPanelOpen={docPanel.isGitPanelOpen} findQuery={docPanel.findQuery} setFindQuery={docPanel.setFindQuery} findIndex={docPanel.findIndex} matches={docPanel.matches} stepFind={docPanel.stepFind} findInputRef={docPanel.findInputRef} outline={docPanel.outline} lineNumberOffset={session.baseNote.lineNumberOffset || 0} outlineIndex={docPanel.outlineIndex} setOutlineIndex={docPanel.setOutlineIndex} chooseOutline={docPanel.chooseOutline} openOutline={docPanel.openOutline} newFieldKey={docPanel.newFieldKey} setNewFieldKey={docPanel.setNewFieldKey} frontmatterViewMode={docPanel.frontmatterViewMode} setFrontmatterViewMode={docPanel.setFrontmatterViewMode} yamlText={docPanel.yamlText} setYamlText={docPanel.setYamlText} yamlError={docPanel.yamlError} setYamlError={docPanel.setYamlError} tagInput={docPanel.tagInput} setTagInput={docPanel.setTagInput} isTagDropdownOpen={docPanel.isTagDropdownOpen} setIsTagDropdownOpen={docPanel.setIsTagDropdownOpen} metadata={session.metadata} setMetadata={session.setMetadata} statuses={statuses} metadataFields={metadataFields} availableTags={availableTags} locked={session.locked} notebookId={note.notebookId} onInsertAssetRef={handleInsertAssetRef} notePath={note.path} branch={branch} editorState={session.editorState} editorStatus={session.editorStatus} autoSave={autoSave} readOnly={readOnly} isDirty={session.isDirty} canRestore={session.canRestore} confirmRestore={session.confirmRestore} onRestoreClick={session.handleRestoreClick} />
                  </aside>
                )
                : documentPanel?.target && docPanel.notePanel && createPortal(
                  <section className='note-document-panel' data-open='true' data-panel={docPanel.notePanel} data-frame='rail' aria-label={t('editor.documentPanel')}>
                    <NoteDocumentPanel includeTabs={false} isMarkdown={isMarkdown} setNotePanel={docPanel.setNotePanel} isFindOpen={docPanel.isFindOpen} isOutlineOpen={docPanel.isOutlineOpen} showFrontmatter={docPanel.showFrontmatter} isAssetPickerOpen={docPanel.isAssetPickerOpen} isGitPanelOpen={docPanel.isGitPanelOpen} findQuery={docPanel.findQuery} setFindQuery={docPanel.setFindQuery} findIndex={docPanel.findIndex} matches={docPanel.matches} stepFind={docPanel.stepFind} findInputRef={docPanel.findInputRef} outline={docPanel.outline} lineNumberOffset={session.baseNote.lineNumberOffset || 0} outlineIndex={docPanel.outlineIndex} setOutlineIndex={docPanel.setOutlineIndex} chooseOutline={docPanel.chooseOutline} openOutline={docPanel.openOutline} newFieldKey={docPanel.newFieldKey} setNewFieldKey={docPanel.setNewFieldKey} frontmatterViewMode={docPanel.frontmatterViewMode} setFrontmatterViewMode={docPanel.setFrontmatterViewMode} yamlText={docPanel.yamlText} setYamlText={docPanel.setYamlText} yamlError={docPanel.yamlError} setYamlError={docPanel.setYamlError} tagInput={docPanel.tagInput} setTagInput={docPanel.setTagInput} isTagDropdownOpen={docPanel.isTagDropdownOpen} setIsTagDropdownOpen={docPanel.setIsTagDropdownOpen} metadata={session.metadata} setMetadata={session.setMetadata} statuses={statuses} metadataFields={metadataFields} availableTags={availableTags} locked={session.locked} notebookId={note.notebookId} onInsertAssetRef={handleInsertAssetRef} notePath={note.path} branch={branch} editorState={session.editorState} editorStatus={session.editorStatus} autoSave={autoSave} readOnly={readOnly} isDirty={session.isDirty} canRestore={session.canRestore} confirmRestore={session.confirmRestore} onRestoreClick={session.handleRestoreClick} />
                  </section>,
                  documentPanel.target,
                )}
            </div>
            <EditorFooter content={session.content} path={note.path} branch={branch} state={session.editorState} status={session.editorStatus} />
            {docPanel.isEditorLeaderOpen && (
              <div className='note-editor-leader' role='dialog' aria-modal='false' aria-label={t('editor.noteCommands')}>
                <div>
                  <strong>{t('editor.noteCommands')}</strong>
                  <small>{t('editor.leaderHint')}</small>
                </div>
                <button type='button' onClick={docPanel.openFind}>
                  <kbd>F</kbd>
                  <span>{t('editor.findInNote')}</span>
                </button>
                {isMarkdown && (
                  <button type='button' onClick={docPanel.openOutline}>
                    <kbd>/</kbd>
                    <span>{t('editor.outline')}</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}
    </div>
  );
});
NoteEditor.displayName = 'NoteEditor';
