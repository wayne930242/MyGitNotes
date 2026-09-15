import { useWorkspaceLinks } from './WorkspaceLinks.js';
import { isNoteHidden, withNoteStatus } from '@mygitnotes/core/note-status';
import { EditorNotice } from './EditorNotice.js';
import { EditorFooter } from './EditorFooter.js';
import { Select } from './Select.js';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Save,
  FileText,
  RotateCcw,
  AlertTriangle,
  Search,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { mergeNote, sameValue, NoteDraft } from '../lib/merge-note.js';
import { ApiError } from '../lib/api.js';
import { MarkdownEditor, MarkdownEditorHandle, MarkdownEditorMode, MarkdownEditorModeSwitch } from './MarkdownEditor.js';
import { AssetLibrary } from './AssetLibrary.js';
import { NoteItem, AssetItem } from '../lib/types.js';
import { saveLocalDraft, getLocalDraft, clearLocalDraft } from '../lib/storage.js';
import { CrashRecoveryBanner } from './CrashRecoveryBanner.js';
import { useTranslation } from '../lib/i18n/index.js';
import { findOutlineIndexForLine, findTextMatches, parseMarkdownOutline } from '../lib/note-navigation.js';
import { usePanelContext, isNoteToolId, type NoteToolId } from '../lib/panel-context.js';

/** Server-managed on every save; excluded when deciding whether there is a new edit to save. */
function sameIgnoringTimestamps(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const strip = ({ created, updated, ...rest }: Record<string, unknown>) => rest;
  return sameValue(strip(a), strip(b));
}

interface EditorModalProps {
  note: NoteItem | null;
  statuses: string[];
  readOnly?: boolean;
  autoSave?: boolean;
  draftMode?: boolean;
  remoteBase?: NoteItem;
  conflictReason?: string;
  onMarkConflict?: (reason: string, draft: NoteItem, base: NoteItem) => void;
  isOpen: boolean;
  onClose: () => void;
  onSave: (params: {
    path: string;
    content: string;
    metadata?: Record<string, unknown>;
    revision?: string;
    baseNote?: NoteItem;
  }) => Promise<NoteItem>;
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

export const EditorModal: React.FC<EditorModalProps> = (props) => props.isOpen && props.note
  ? <EditorModalContent key={`${props.draftScope}:${props.note.path}`} {...props} note={props.note} /> : null;

const EditorModalContent: React.FC<EditorModalProps & { note: NoteItem }> = ({
  note,
  statuses,
  readOnly = false,
  autoSave = true,
  draftMode = false,
  remoteBase,
  conflictReason,
  onMarkConflict,
  onClose,
  onSave,
  onReadRemote,
  onRestoreFile,
  isDirty: propIsDirty = false,
  availableTags = [],
  assets = [],
  onUploadAsset,
  onDeleteAsset,
  onMoveAsset,
  branch,
  draftScope,
}) => {

  const isMarkdown = note.path.endsWith('.md') || note.path.endsWith('.markdown');
  const { t } = useTranslation();
  const panel = usePanelContext();
  const notePanel: NoteToolId | null = panel.isOpen && isNoteToolId(panel.activeTool) ? panel.activeTool : null;
  useEffect(() => { panel.setNoteContext(true, isMarkdown); return () => panel.setNoteContext(false, false); }, [isMarkdown]);

  // Editor states
  const [content, setContent] = useState(note.content);
  const [metadata, setMetadata] = useState<Record<string, unknown>>(note.metadata || {});
  const [editorMode, setEditorMode] = useState<MarkdownEditorMode>('live');
  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [saveError, setSaveError] = useState(conflictReason || '');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [baseNote, setBaseNote] = useState(remoteBase || note);
  const [blocked, setBlocked] = useState(Boolean(conflictReason));
  const [remoteNotice, setRemoteNotice] = useState('');
  const [conflictDraft, setConflictDraft] = useState<NoteDraft | null>(() => getLocalDraft(`${draftScope || branch}:conflict`, note.path));
  const operation = useRef(false);
  const closing = useRef(false);
  const nextRemoteCheck = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = useRef({ content, metadata, baseNote, blocked });
  current.current = { content, metadata, baseNote, blocked };
  const locked = readOnly || blocked || isRestoring || closing.current || (!autoSave && isSaving);
  const preserveConflict = () => {
    const draft = { content: current.current.content, metadata: current.current.metadata };
    saveLocalDraft(`${draftScope || branch}:conflict`, note.path, draft.content, draft.metadata);
    setConflictDraft(draft);
  };
  const applyRemote = (latest: NoteItem) => {
    const state = current.current;
    if (state.blocked) return null;
    const result = mergeNote(state.baseNote, state, latest);
    if (result.conflict) {
      preserveConflict();
      current.current.blocked = true;
      setBlocked(true);
      const reason = 'Remote changes conflict with your draft. Refresh the remote version to continue editing. Your draft is preserved.';
      setSaveError(reason);
      onMarkConflict?.(reason, { ...note, content: state.content, metadata: state.metadata }, state.baseNote);
      return null;
    }
    if (latest.content !== state.baseNote.content || !sameValue(latest.metadata, state.baseNote.metadata)) {
      setRemoteNotice('Remote changes merged into this draft. Review before saving.');
    }
    current.current = { ...state, ...result.draft, baseNote: latest };
    setBaseNote(latest); setContent(result.draft.content); setMetadata(result.draft.metadata);
    return { ...result.draft, revision: latest.revision };
  };
  const handleRemoteFailure = (error: unknown) => {
    if (!mounted.current) return;
    if (error instanceof ApiError && (error.retryAfter || error.status === 429)) {
      nextRemoteCheck.current = Date.now() + (error.retryAfter || 60) * 1000;
    }
    if (error instanceof ApiError && error.status === 404) {
      preserveConflict(); current.current.blocked = true; setBlocked(true);
      const reason = 'This note was moved or deleted remotely. Your draft is preserved. Refresh after the note is restored, or open its new location.';
      setSaveError(reason);
      onMarkConflict?.(reason, { ...note, content: current.current.content, metadata: current.current.metadata }, current.current.baseNote);
    } else setSaveError((error as Error).message);
  };
  const checkRemote = async () => {
    if (!onReadRemote || operation.current || current.current.blocked || Date.now() < nextRemoteCheck.current) return;
    nextRemoteCheck.current = Date.now() + (readOnly ? 300000 : 60000);
    operation.current = true;
    try { const latest = await onReadRemote(note.path); if (mounted.current) applyRemote(latest); }
    catch (error) { handleRemoteFailure(error); }
    finally { operation.current = false; }
  };
  const checkRemoteRef = useRef(checkRemote); checkRemoteRef.current = checkRemote;
  useEffect(() => {
    if (!onReadRemote) return;
    void checkRemoteRef.current();
    const check = () => { if (document.visibilityState === 'visible') void checkRemoteRef.current(); };
    const timer = window.setInterval(check, readOnly ? 300000 : 60000);
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [onReadRemote, note.path, readOnly]);
  const refreshRemote = async () => {
    if (!onReadRemote || operation.current) return;
    operation.current = true; setIsSaving(true);
    try {
      if (draftMode && current.current.blocked) preserveConflict();
      const latest = draftMode ? await onRestoreFile(note.path) : await onReadRemote(note.path);
      if (!mounted.current || !latest) return;
      setBaseNote(latest); setContent(latest.content); setMetadata(latest.metadata);
      current.current = { ...latest, baseNote: latest, blocked: false };
      clearLocalDraft(draftScope || branch, note.path);
      setRecoveredDraft(null); setBlocked(false); setSaveError(''); setHasUnsavedChanges(false);
      setRemoteNotice('Remote version refreshed. Your previous draft remains available to download.');
    } catch (error) { handleRemoteFailure(error); }
    finally { operation.current = false; if (mounted.current) setIsSaving(false); }
  };
  const downloadConflictDraft = () => {
    if (!conflictDraft) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(conflictDraft, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${note.path.split('/').pop()}.draft.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const isAssetPickerOpen = notePanel === 'assets';
  const isFindOpen = notePanel === 'find';
  const isOutlineOpen = notePanel === 'outline';
  const showFrontmatter = notePanel === 'frontmatter';
  const isGitPanelOpen = notePanel === 'git';
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [outlineIndex, setOutlineIndex] = useState(0);
  const [isEditorLeaderOpen, setIsEditorLeaderOpen] = useState(false);
  const findInputRef = useRef<HTMLInputElement>(null);

  // Tag autocomplete states (Requirement 4)
  const [tagInput, setTagInput] = useState('');
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);

  // Two-click confirm single-file restore state (Requirement 3)
  const [confirmRestore, setConfirmRestore] = useState(false);
  const restoreTimerRef = useRef<NodeJS.Timeout | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const matches = useMemo(() => findTextMatches(content, findQuery), [content, findQuery]);
  const outline = useMemo(() => parseMarkdownOutline(content), [content]);

  useEffect(() => setFindIndex(0), [findQuery]);
  useEffect(() => {
    if (!isFindOpen || matches.length === 0) return;
    const index = Math.min(findIndex, matches.length - 1);
    if (index !== findIndex) { setFindIndex(index); return; }
    editorRef.current?.revealRange(matches[index].from, matches[index].to);
  }, [editorMode, findIndex, isFindOpen, matches]);

  const openFind = () => {
    setIsEditorLeaderOpen(false); panel.openTool('find');
    requestAnimationFrame(() => { findInputRef.current?.focus(); findInputRef.current?.select(); });
  };
  const stepFind = (delta: number) => {
    if (matches.length === 0) return;
    setFindIndex(index => (index + delta + matches.length) % matches.length);
  };

  // Note is considered dirty if it has uncommitted edits on disk OR unsaved session edits
  const isDirty = Boolean(propIsDirty || hasUnsavedChanges);
  const canRestore = autoSave && !readOnly && !isSaving && !isRestoring && (draftMode ? isDirty : propIsDirty);
  const editorState = isSaving ? 'saving' : isDirty ? 'pending' : 'saved';
  const editorStatus = isSaving
    ? t(draftMode ? 'editor.savingLocally' : autoSave ? 'editor.autoSavingToDisk' : 'editor.savingToGitHub')
    : isDirty
      ? t(draftMode ? hasUnsavedChanges ? 'editor.unsavedLocalChanges' : 'editor.savedLocallyPendingCommit' : autoSave ? 'editor.uncommittedChanges' : 'editor.unsavedChanges')
      : t(readOnly ? 'editor.readOnly' : draftMode ? 'editor.noPendingChanges' : autoSave ? 'editor.cleanSavedToDisk' : 'editor.savedToGitHub');

  // Crash recovery state
  const [recoveredDraft, setRecoveredDraft] = useState<{
    content: string;
    metadata: Record<string, unknown>;
    savedAt: number;
  } | null>(null);

  // Check local draft on note open
  useEffect(() => {
    setBaseNote(remoteBase || note);
    setContent(note.content);
    setMetadata(note.metadata || {});
    setHasUnsavedChanges(false);
    setConfirmRestore(false);
    setTagInput('');
    setIsTagDropdownOpen(false);
    setFindQuery('');
    setFindIndex(0);
    setOutlineIndex(0);
    setIsEditorLeaderOpen(false);

    const draft = readOnly ? null : getLocalDraft(draftScope || branch, note.path);
    if (draft && (draft.content !== note.content || !sameValue(draft.metadata, note.metadata))) {
      setRecoveredDraft(draft);
    } else {
      setRecoveredDraft(null);
    }
  }, [note.path, branch, draftScope, readOnly]);

  // Debounced auto-save directly to disk on edit (Requirement 1)
  useEffect(() => {
    if (readOnly || closing.current) return;
    const baseline = autoSave ? note : baseNote;
    const isDifferent = content !== baseline.content || !sameIgnoringTimestamps(metadata, baseline.metadata);

    if (isDifferent) {
      setHasUnsavedChanges(true);

      // Save local draft for crash recovery
      saveLocalDraft(draftScope || branch, note.path, content, metadata);

      if (!autoSave || blocked || isRestoring) return;

      // Timestamps are stamped server-side on every save; absorb them so the next
      // comparison against the refreshed `note`/`baseNote` prop doesn't see a
      // spurious difference and re-save in a loop.
      const absorbTimestamps = (saved: NoteItem) => setMetadata(current => (
        current.created === saved.metadata.created && current.updated === saved.metadata.updated
          ? current
          : { ...current, created: saved.metadata.created, updated: saved.metadata.updated }
      ));

      if (draftMode) {
        setIsSaving(true);
        void onSave({ path: note.path, content, metadata, baseNote }).then(saved => {
          if (!mounted.current) return;
          clearLocalDraft(draftScope || branch, note.path);
          absorbTimestamps(saved);
          setHasUnsavedChanges(false); setSaveError('');
        }).catch(error => { if (mounted.current) setSaveError(`Local save failed: ${error.message}`); })
          .finally(() => { if (mounted.current) setIsSaving(false); });
        return;
      }

      // Debounced auto-save to disk
      const timer = setTimeout(async () => {
        setIsSaving(true);
        try {
          const saved = await onSave({
            path: note.path,
            content,
            metadata,
          });
          clearLocalDraft(draftScope || branch, note.path);
          absorbTimestamps(saved);
          setHasUnsavedChanges(false);
        } catch (err) {
          setSaveError((err as Error).message);
        } finally {
          setIsSaving(false);
        }
      }, 750);

      return () => clearTimeout(timer);
    } else {
      setHasUnsavedChanges(false);
    }
  }, [content, metadata, note, branch, draftScope, onSave, readOnly, autoSave, baseNote, blocked, draftMode, isRestoring]);

  const handleExplicitSave = async () => {
    if (locked || operation.current) return;
    operation.current = true; setIsSaving(true); setSaveError('');
    try {
      let draft = { content: current.current.content, metadata: current.current.metadata, revision: current.current.baseNote.revision };
      if (onReadRemote) {
        const latest = await onReadRemote(note.path);
        if (!mounted.current) return;
        const merged = applyRemote(latest);
        if (!merged) return;
        draft = merged;
      }
      const saved = await onSave({ path: note.path, ...draft });
      if (!mounted.current) return;
      setBaseNote(saved); setContent(saved.content); setMetadata(saved.metadata);
      current.current = { ...saved, baseNote: saved, blocked: false };
      clearLocalDraft(draftScope || branch, note.path);
      setHasUnsavedChanges(false); setRemoteNotice('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && onReadRemote) {
        try {
          const latest = await onReadRemote(note.path);
          if (mounted.current && applyRemote(latest)) setSaveError('The remote changed during saving. Changes merged; review the draft and Save again.');
        } catch (readError) { handleRemoteFailure(readError); }
      } else handleRemoteFailure(error);
    } finally { operation.current = false; if (mounted.current) setIsSaving(false); }
  };
  const { registerBeforeNavigate } = useWorkspaceLinks();
  useEffect(() => registerBeforeNavigate(async () => {
    if (readOnly) return true;
    if (operation.current || current.current.blocked) return false;
    const draft = current.current;
    if (draft.content === note.content && sameValue(draft.metadata, note.metadata)) return true;
    saveLocalDraft(draftScope || branch, note.path, draft.content, draft.metadata);
    try {
      await onSave({ path: note.path, content: draft.content, metadata: draft.metadata, baseNote: draft.baseNote });
      clearLocalDraft(draftScope || branch, note.path);
      return true;
    } catch (error) { setSaveError((error as Error).message); return false; }
  }), [registerBeforeNavigate, readOnly, note, onSave, draftScope, branch]);

  const close = async () => {
    if (closing.current || isRestoring || operation.current) return;
    if (autoSave && !readOnly && !current.current.blocked && (draftMode || current.current.content !== note.content || !sameIgnoringTimestamps(current.current.metadata, note.metadata))) {
      closing.current = true; setIsSaving(true);
      try {
        await onSave({ path: note.path, content: current.current.content, metadata: current.current.metadata, baseNote: current.current.baseNote });
        clearLocalDraft(draftScope || branch, note.path);
      }
      catch (error) { closing.current = false; setIsSaving(false); setSaveError(`Local save failed: ${(error as Error).message}`); return; }
    }
    if (!autoSave && !readOnly && hasUnsavedChanges && !window.confirm('Close with unsaved changes? Your local draft will be kept.')) return;
    onClose();
  };
  const escapeAction = useRef<() => boolean>(() => false);
  escapeAction.current = () => {
    if (isEditorLeaderOpen) setIsEditorLeaderOpen(false);
    else if (notePanel) panel.close();
    else return false;
    return true;
  };
  const openOutline = () => {
    const currentLine = editorRef.current?.getCurrentLine() ?? 1;
    setIsEditorLeaderOpen(false);
    setOutlineIndex(findOutlineIndexForLine(outline, currentLine));
    panel.openTool('outline');
  };
  const chooseOutline = (index: number, closeAfter = true) => {
    const heading = outline[index]; if (!heading) return;
    editorRef.current?.goToLine(heading.line, { focus: closeAfter, smooth: true });
    if (closeAfter) panel.close();
  };
  const moveOutline = (delta: number) => {
    if (outline.length === 0) return;
    const nextIndex = (outlineIndex + delta + outline.length) % outline.length;
    setOutlineIndex(nextIndex);
    chooseOutline(nextIndex, false);
  };
  const shortcutAction = useRef<(event: KeyboardEvent) => boolean>(() => false);
  shortcutAction.current = event => {
    const slashKey = event.code === 'Slash' || event.key === '/';
    if (slashKey && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      setIsEditorLeaderOpen(open => !open); return true;
    }
    if (isEditorLeaderOpen && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key.toLowerCase() === 'f') { openFind(); return true; }
      if (slashKey) { openOutline(); return true; }
    }
    if (isOutlineOpen && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key.toLowerCase() === 'j' || event.key === 'ArrowDown') {
        moveOutline(1); return true;
      }
      if (event.key.toLowerCase() === 'k' || event.key === 'ArrowUp') {
        moveOutline(-1); return true;
      }
      if (event.key === 'Enter') { chooseOutline(outlineIndex); return true; }
    }
    return false;
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="listbox"]')) return;
      if (shortcutAction.current(event)) {
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (event.key === 'Escape' && !document.querySelector('dialog[open], [aria-label="Asset preview"]')) {
        if (escapeAction.current()) { event.preventDefault(); event.stopPropagation(); }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  useEffect(() => {
    if (!isOutlineOpen || outline.length === 0) return;
    const index = Math.min(outlineIndex, outline.length - 1);
    if (index !== outlineIndex) { setOutlineIndex(index); return; }
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-outline-index="${index}"]`)?.focus());
  }, [isOutlineOpen, outline, outlineIndex]);

  const handleRestoreDraft = () => {
    if (recoveredDraft && !locked) {
      setContent(recoveredDraft.content);
      setMetadata(recoveredDraft.metadata);
      setRecoveredDraft(null);
    }
  };

  const handleDiscardDraft = () => {
    clearLocalDraft(draftScope || branch, note.path);
    setRecoveredDraft(null);
  };

  // Two-click confirm single-file restore (Requirement 1 & 3)
  const handleRestoreClick = async () => {
    if (!canRestore) return;
    if (!confirmRestore) {
      // First click: prompt confirmation
      setConfirmRestore(true);
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = setTimeout(() => {
        setConfirmRestore(false);
      }, 4000);
      return;
    }

    // Second click: execute single-file restore from Git HEAD
    try {
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
      setConfirmRestore(false);
      setIsRestoring(true); operation.current = true;
      setIsSaving(true);
      const restored = await onRestoreFile(note.path);
      clearLocalDraft(draftScope || branch, note.path);
      if (restored) {
        setBaseNote(restored);
        setContent(restored.content);
        setMetadata(restored.metadata || {});
      }
      setHasUnsavedChanges(false);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setIsRestoring(false); operation.current = false;
      setIsSaving(false);
    }
  };

  // Insert markdown asset reference at cursor position or append (Requirement 2)
  const handleInsertAssetRef = (ref: string) => {
    if (locked) return;
    editorRef.current?.insert(`\n${ref}\n`);
    panel.close();
  };

  // Tag autocomplete helpers (Requirement 4)
  const currentTags: string[] = useMemo(() => {
    return Array.isArray(metadata.tags) ? metadata.tags.map(String) : [];
  }, [metadata.tags]);

  const suggestedTags = useMemo(() => {
    const query = tagInput.trim().toLowerCase();
    return availableTags.filter((t) => {
      if (currentTags.includes(t)) return false;
      if (!query) return true;
      return t.toLowerCase().includes(query);
    });
  }, [availableTags, currentTags, tagInput]);

  const handleAddTag = (tagToAdd: string) => {
    const cleanTag = tagToAdd.trim().replace(/^,+|,+$/g, '');
    if (!cleanTag) return;
    if (!currentTags.includes(cleanTag)) {
      setMetadata({
        ...metadata,
        tags: [...currentTags, cleanTag],
      });
    }
    setTagInput('');
    setIsTagDropdownOpen(false);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setMetadata({
      ...metadata,
      tags: currentTags.filter((t) => t !== tagToRemove),
    });
  };


  return (
    <div className="note-overlay viewport-overlay fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 animate-fadeIn">
      <div role="dialog" aria-modal="true" aria-label="Note editor" className="note-dialog ui-dialog shadow-2xl w-full max-w-none h-full flex flex-col overflow-hidden transition-colors">
        <div className="editor-notices">
        {/* Crash recovery banner if draft differs from disk */}
        {recoveredDraft && !blocked && (
          <CrashRecoveryBanner
            draft={{
              path: note.path,
              content: recoveredDraft.content,
              metadata: recoveredDraft.metadata,
              savedAt: recoveredDraft.savedAt,
            }}
            onRestore={handleRestoreDraft}
            onDiscard={handleDiscardDraft}
          />
        )}

        {saveError && <EditorNotice tone="error">{saveError}</EditorNotice>}

        {(blocked || remoteNotice || conflictDraft) && <EditorNotice actions={<>
          {blocked && <button disabled={isSaving} onClick={refreshRemote} className="font-semibold underline hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition">{t('editor.refreshRemote')}</button>}
          {conflictDraft && <button onClick={downloadConflictDraft} className="underline hover:opacity-80 transition">{t('editor.downloadPreservedDraft')}</button>}
        </>}>{remoteNotice || t('editor.localChangesPreserved')}</EditorNotice>}
        </div>

        {/* Modal Top Bar */}
        <div className="note-toolbar relative shrink-0 px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 bg-slate-50/60 dark:bg-slate-900/80">
          <div className="note-heading flex items-center gap-3 truncate">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{
                backgroundColor: 'var(--color-primary-light)',
                color: 'var(--color-primary)',
              }}
            >
              <FileText className="w-4 h-4" />
            </div>
            <div className="truncate">
              <div className="font-serif font-semibold text-slate-900 dark:text-slate-100 text-sm truncate">
                {String(metadata.title || note.title || t('editor.untitled'))}
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-500 font-mono truncate">
                {note.path}
              </div>
            </div>
          </div>

          <div className="note-controls flex items-center gap-2">
            {!autoSave && !readOnly && <button aria-label={t('editor.saveToGitHub')} title={t('editor.saveToGitHub')} disabled={locked || !hasUnsavedChanges} onClick={handleExplicitSave} className="note-save editor-action px-3 py-1.5 rounded-lg text-xs text-white transition hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed" style={{ backgroundColor: 'var(--color-primary)' }}><Save className="editor-mobile-icon w-5 h-5" /><span>{isSaving ? t('editor.saving') : t('editor.saveToGitHub')}</span></button>}
            {isMarkdown && <MarkdownEditorModeSwitch mode={editorMode} onChange={setEditorMode} />}

            {/* Close Button */}
            <button
              aria-label={t('editor.closeNote')}
              onClick={close}
              className="note-close p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="note-editor-body">
          <MarkdownEditor ref={editorRef} content={content} path={note.path} mode={editorMode} readOnly={locked} onChange={setContent} ariaLabel="Note content" />
          {notePanel && panel.noteToolPortalTarget && createPortal(<div className="note-document-panel-content" data-panel={notePanel} aria-label={t('editor.documentPanel')}>
            {isFindOpen && <form className="note-find-panel" role="search" aria-label={t('editor.findInNote')}
              onSubmit={event => { event.preventDefault(); stepFind(1); }}>
              <label className="note-find-field"><Search aria-hidden="true" />
                <input ref={findInputRef} type="search" value={findQuery} onChange={event => setFindQuery(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); stepFind(-1); } }}
                  aria-label={t('editor.findInNote')} placeholder={t('editor.findPlaceholder')} autoComplete="off" />
              </label>
              <div className="note-find-navigation">
                <span className="note-find-count" aria-live="polite">{findQuery
                  ? matches.length ? t('editor.matchCount', { current: Math.min(findIndex + 1, matches.length), total: matches.length }) : t('editor.noMatches')
                  : ''}</span>
                <button type="button" className="ui-icon-button" aria-label={t('editor.previousMatch')} disabled={matches.length === 0} onClick={() => stepFind(-1)}><ChevronUp aria-hidden="true" /></button>
                <button type="submit" className="ui-icon-button" aria-label={t('editor.nextMatch')} disabled={matches.length === 0}><ChevronDown aria-hidden="true" /></button>
              </div>
            </form>}

            {isOutlineOpen && <section className="note-outline" aria-label={t('editor.outline')}>
              {outline.length > 0 ? <nav aria-label={t('editor.outline')}>
                {outline.map((heading, index) => <button type="button" key={`${heading.from}-${index}`} data-outline-index={index}
                  aria-current={index === outlineIndex ? 'true' : undefined}
                  style={{ paddingInlineStart: `${12 + (heading.depth - 1) * 14}px` }}
                  title={heading.label} onFocus={() => setOutlineIndex(index)} onClick={() => chooseOutline(index)}>
                  <span>{heading.label}</span><small>{heading.line}</small>
                </button>)}
              </nav> : <p>{t('editor.outlineEmpty')}</p>}
            </section>}

            {showFrontmatter && <div className="note-panel-scroll">
          <fieldset disabled={locked} className="note-metadata min-w-0 text-xs animate-fadeIn">
            <div>
              <label className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">{t('editor.title')}</label>
              <input
                type="text"
                value={String(metadata.title || '')}
                onChange={(e) => setMetadata({ ...metadata, title: e.target.value })}
                placeholder={t('editor.titlePlaceholder')}
                className="ui-control w-full"
              />
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">{t('editor.status')}</label>
              <Select aria-label={t('editor.status')} disabled={locked} value={String(metadata.status || '')} onValueChange={value => setMetadata(withNoteStatus(metadata, value))} options={Array.from(new Set(['', ...statuses, String(metadata.status || '')])).map(value => ({value,label:value || t('editor.noStatus')}))} className="w-full" />
              <label className="flex items-center gap-2 min-h-11 cursor-pointer">
                <input type="checkbox" aria-label={t('editor.hideNote')} checked={isNoteHidden(metadata)}
                  onChange={event => setMetadata({ ...metadata, hiden: event.target.checked })}
                  className="w-4 h-4 accent-indigo-600" />
                {t('editor.hideNote')}
              </label>
            </div>

            {/* Tags with Autocomplete (Requirement 4) */}
            <div className="relative">
              <label className="block text-slate-500 dark:text-slate-400 font-semibold mb-1">
                {t('editor.tags')}
              </label>
              <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md min-h-[35px] relative">
                {currentTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-black/5 dark:bg-white/10 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700"
                  >
                    <span>{tag}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="text-slate-400 hover:text-rose-500 font-bold ml-0.5"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <div className="flex-1 min-w-[100px] relative">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => {
                      setTagInput(e.target.value);
                      setIsTagDropdownOpen(true);
                    }}
                    onFocus={() => setIsTagDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setIsTagDropdownOpen(false), 250)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        handleAddTag(tagInput);
                      } else if (e.key === 'Backspace' && !tagInput && currentTags.length > 0) {
                        handleRemoveTag(currentTags[currentTags.length - 1]);
                      }
                    }}
                    placeholder={currentTags.length === 0 ? t('editor.addTagPlaceholder') : t('editor.addPlaceholder')}
                    className="w-full text-xs bg-transparent focus:outline-none text-slate-900 dark:text-slate-100"
                  />

                  {/* Autocomplete Dropdown */}
                  {isTagDropdownOpen && suggestedTags.length > 0 && (
                    <div className="absolute top-full left-0 mt-1 w-52 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-50 max-h-40 overflow-y-auto py-1">
                      {suggestedTags.map((st) => (
                        <button
                          key={st}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleAddTag(st);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between text-slate-800 dark:text-slate-200"
                        >
                          <span className="font-semibold">{st}</span>
                          <span className="text-[10px] text-slate-400">{t('editor.add')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick suggestion suggestions below */}
              {suggestedTags.length > 0 && !tagInput && (
                <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400 flex-wrap">
                  <span>{t('editor.suggestions')}</span>
                  {suggestedTags.slice(0, 5).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => handleAddTag(st)}
                      style={{ color: 'var(--color-primary)' }}
                      className="hover:underline font-medium"
                    >
                      +{st}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </fieldset></div>}

            {isAssetPickerOpen && <div className="note-panel-assets note-panel-scroll">
              <AssetLibrary assets={assets} onUploadAsset={locked ? undefined : onUploadAsset} onDeleteAsset={locked ? undefined : onDeleteAsset} onMoveAsset={locked ? undefined : onMoveAsset} onInsert={locked ? undefined : asset => handleInsertAssetRef(asset.markdownRef)} />
            </div>}

            {isGitPanelOpen && <div className="note-git-panel note-panel-scroll">
              <dl>
                <div><dt>{t('editor.filePath')}</dt><dd className="font-mono">{note.path}</dd></div>
                <div><dt>{t('editor.currentBranch')}</dt><dd className="font-mono">{branch}</dd></div>
              </dl>
              <div className="note-git-state" data-state={editorState} role="status"><span aria-hidden="true" />{editorStatus}</div>
              {autoSave && !readOnly ? <button type="button"
                aria-label={confirmRestore ? t('editor.confirmRestoreNote') : t('editor.restoreNote')}
                disabled={!canRestore}
                onClick={handleRestoreClick}
                className={`ui-button ${confirmRestore ? 'ui-button-danger note-restore-confirm' : ''}`}
                title={confirmRestore ? t('editor.confirmRestoreTooltip') : t('editor.restoreTooltip')}>
                {confirmRestore ? <AlertTriangle aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
                {confirmRestore ? t('editor.confirmRestore') : t('editor.restore')}
              </button> : <p className="note-git-help">{t('editor.restoreUnavailable')}</p>}
              {!isDirty && autoSave && !readOnly && <p className="note-git-help">{t('editor.noFileChanges')}</p>}
            </div>}
          </div>, panel.noteToolPortalTarget)}
        </div>

        <EditorFooter
          content={content}
          path={note.path}
          branch={branch}
          state={editorState}
          status={editorStatus}
        />
        {isEditorLeaderOpen && <div className="note-editor-leader" role="dialog" aria-modal="false" aria-label={t('editor.noteCommands')}>
          <div><strong>{t('editor.noteCommands')}</strong><small>{t('editor.leaderHint')}</small></div>
          <button type="button" onClick={openFind}><kbd>F</kbd><span>{t('editor.findInNote')}</span></button>
          {isMarkdown && <button type="button" onClick={openOutline}><kbd>/</kbd><span>{t('editor.outline')}</span></button>}
        </div>}
      </div>

    </div>
  );
};
