import { useWorkspaceLinks } from './WorkspaceLinks.js';
import { isNoteHidden, withNoteStatus } from '@github-notes/core/note-status';
import { EditorNotice } from './EditorNotice.js';
import { EditorFooter } from './EditorFooter.js';
import { Select } from './Select.js';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Settings2,
  Save,
  Image as ImageIcon,
  FileText,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';
import { mergeNote, sameValue, NoteDraft } from '../lib/merge-note.js';
import { ApiError } from '../lib/api.js';
import { MarkdownEditor, MarkdownEditorHandle, MarkdownEditorMode, MarkdownEditorModeSwitch } from './MarkdownEditor.js';
import { AssetLibrary } from './AssetLibrary.js';
import { NoteItem, AssetItem } from '../lib/types.js';
import { saveLocalDraft, getLocalDraft, clearLocalDraft } from '../lib/storage.js';
import { CrashRecoveryBanner } from './CrashRecoveryBanner.js';
import { useTranslation } from '../lib/i18n/index.js';

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

  // Editor states
  const [content, setContent] = useState(note.content);
  const [metadata, setMetadata] = useState<Record<string, unknown>>(note.metadata || {});
  const [editorMode, setEditorMode] = useState<MarkdownEditorMode>('live');
  const [showFrontmatter, setShowFrontmatter] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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
  const locked = readOnly || blocked || closing.current || (!autoSave && isSaving);
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

  // Asset picker modal state (Requirement 2)
  const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);

  // Tag autocomplete states (Requirement 4)
  const [tagInput, setTagInput] = useState('');
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);

  // Two-click confirm single-file restore state (Requirement 3)
  const [confirmRestore, setConfirmRestore] = useState(false);
  const restoreTimerRef = useRef<NodeJS.Timeout | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);

  // Note is considered dirty if it has uncommitted edits on disk OR unsaved session edits
  const isDirty = Boolean(propIsDirty || hasUnsavedChanges);

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
    setIsAssetPickerOpen(false);

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
    const isDifferent = content !== baseline.content || !sameValue(metadata, baseline.metadata);

    if (isDifferent) {
      setHasUnsavedChanges(true);

      // Save local draft for crash recovery
      saveLocalDraft(draftScope || branch, note.path, content, metadata);

      if (!autoSave || blocked) return;

      if (draftMode) {
        setIsSaving(true);
        void onSave({ path: note.path, content, metadata, baseNote }).then(() => {
          if (!mounted.current) return;
          clearLocalDraft(draftScope || branch, note.path);
          setHasUnsavedChanges(false); setSaveError('');
        }).catch(error => { if (mounted.current) setSaveError(`Local save failed: ${error.message}`); })
          .finally(() => { if (mounted.current) setIsSaving(false); });
        return;
      }

      // Debounced auto-save to disk
      const timer = setTimeout(async () => {
        setIsSaving(true);
        try {
          await onSave({
            path: note.path,
            content,
            metadata,
          });
          clearLocalDraft(draftScope || branch, note.path);
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
  }, [content, metadata, note, branch, draftScope, onSave, readOnly, autoSave, baseNote, blocked, draftMode]);

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
    if (closing.current) return;
    if (autoSave && !readOnly && !current.current.blocked && (draftMode || current.current.content !== note.content || !sameValue(current.current.metadata, note.metadata))) {
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
  const escapeAction = useRef(() => {});
  escapeAction.current = () => isAssetPickerOpen ? setIsAssetPickerOpen(false) : close();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
        event.preventDefault(); event.stopPropagation(); escapeAction.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

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
      setIsSaving(true);
      clearLocalDraft(draftScope || branch, note.path);
      const restored = await onRestoreFile(note.path);
      if (restored) {
        setBaseNote(restored);
        setContent(restored.content);
        setMetadata(restored.metadata || {});
      }
      setHasUnsavedChanges(false);
    } catch (err) {
      console.error('Failed to restore note file:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Insert markdown asset reference at cursor position or append (Requirement 2)
  const handleInsertAssetRef = (ref: string) => {
    if (locked) return;
    editorRef.current?.insert(`\n${ref}\n`);
    setIsAssetPickerOpen(false);
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
    <div className="note-overlay viewport-overlay fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 md:p-6 animate-fadeIn">
      <div role="dialog" aria-modal="true" aria-label="Note editor" className="note-dialog ui-dialog shadow-2xl w-full max-w-6xl h-[90dvh] flex flex-col overflow-hidden transition-colors">
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

            {/* Frontmatter Toggle */}
            <button
              aria-label={t('editor.frontmatter')} aria-pressed={showFrontmatter}
              onClick={() => setShowFrontmatter(!showFrontmatter)}
              className={`editor-action flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                showFrontmatter
                  ? 'border-slate-300 dark:border-slate-600 font-semibold hover:opacity-90'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
              style={
                showFrontmatter
                  ? {
                      backgroundColor: 'var(--color-primary-light)',
                      color: 'var(--color-primary)',
                      borderColor: 'var(--color-primary)',
                    }
                  : undefined
              }
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>{t('editor.frontmatter')}</span>
            </button>

            {/* Insert Asset Helper (Requirement 2: Directly opens inline Asset Picker) */}
            <button
              aria-label={t('editor.asset')}
              onClick={() => setIsAssetPickerOpen(true)}
              className="editor-action flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition"
              title={t('editor.insertAssetTooltip')}
            >
              <ImageIcon className="w-3.5 h-3.5" style={{ color: 'var(--color-primary)' }} />
              <span>{t('editor.asset')}</span>
            </button>

            {/* Single-File Restore Button with Two-Click Confirmation (Requirement 3: Only shown when note is dirty!) */}
            {autoSave && !readOnly && isDirty && (
              <button
                aria-label={confirmRestore ? t('editor.confirmRestoreNote') : t('editor.restoreNote')}
                onClick={handleRestoreClick}
                className={`editor-action ${confirmRestore ? 'editor-confirming' : ''} flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition active:scale-95 shadow-xs ${
                  confirmRestore
                    ? 'bg-rose-600 hover:bg-rose-700 text-white font-bold animate-pulse'
                    : 'bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-amber-600'
                }`}
                title={
                  confirmRestore
                    ? t('editor.confirmRestoreTooltip')
                    : t('editor.restoreTooltip')
                }
              >
                {confirmRestore ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-white" />
                    <span>{t('editor.confirmRestore')}</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{t('editor.restore')}</span>
                  </>
                )}
              </button>
            )}

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

        {/* Optional Frontmatter Inspector Drawer with Autocomplete Tag Editor (Requirement 4) */}
        {showFrontmatter && (
          <fieldset disabled={locked} className="note-metadata shrink-0 min-w-0 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 p-4 grid grid-cols-1 md:grid-cols-4 gap-4 text-xs animate-fadeIn">
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
            <div className="md:col-span-2 relative">
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
          </fieldset>
        )}

        <MarkdownEditor ref={editorRef} content={content} path={note.path} mode={editorMode} readOnly={locked} onChange={setContent} ariaLabel="Note content" />

        <EditorFooter
          content={content}
          path={note.path}
          branch={branch}
          state={isSaving ? 'saving' : isDirty ? 'pending' : 'saved'}
          status={isSaving
            ? t(draftMode ? 'editor.savingLocally' : autoSave ? 'editor.autoSavingToDisk' : 'editor.savingToGitHub')
            : isDirty
              ? t(draftMode ? hasUnsavedChanges ? 'editor.unsavedLocalChanges' : 'editor.savedLocallyPendingCommit' : autoSave ? 'editor.uncommittedChanges' : 'editor.unsavedChanges')
              : t(readOnly ? 'editor.readOnly' : draftMode ? 'editor.noPendingChanges' : autoSave ? 'editor.cleanSavedToDisk' : 'editor.savedToGitHub')}
        />
      </div>

      {isAssetPickerOpen && <div role="dialog" aria-label={t('editor.notebookAssets')} aria-modal="true" className="viewport-overlay fixed inset-0 z-[60] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="ui-dialog shadow-2xl w-full max-w-3xl max-h-[85dvh] flex flex-col overflow-hidden">
          <div className="p-4 border-b shrink-0 flex items-center justify-between" style={{ borderColor:'var(--color-border)' }}><span className="font-semibold text-sm theme-text">{t('editor.notebookAssets')}</span><button aria-label={t('editor.closeNotebookAssets')} onClick={() => setIsAssetPickerOpen(false)} className="ui-icon-button"><X className="w-5 h-5" /></button></div>
          <div className="p-4 overflow-y-auto"><AssetLibrary assets={assets} onUploadAsset={locked ? undefined : onUploadAsset} onDeleteAsset={locked ? undefined : onDeleteAsset} onMoveAsset={locked ? undefined : onMoveAsset} onInsert={locked ? undefined : asset => handleInsertAssetRef(asset.markdownRef)} /></div>
        </div>
      </div>}
    </div>
  );
};
