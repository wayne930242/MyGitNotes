import { useEffect, useRef, useState } from 'react';
import { mergeNote, NoteDraft, sameValue } from '../../lib/merge-note.js';
import { ApiError } from '../../lib/api.js';
import { NoteItem } from '../../lib/types.js';
import { REMOTE_CHECK_INTERVAL_MS, REMOTE_CHECK_INTERVAL_READONLY_MS } from '../../lib/remote-check-interval.js';
import { clearLocalDraft, dismissConflictDraftNotice, getDismissedConflictDraftNoticeAt, getLocalDraft, saveLocalDraft } from '../../lib/storage.js';
import { copyToClipboard } from '../../lib/clipboard.js';
import { useTranslation } from '../../lib/i18n/index.js';
import type { TranslationKey } from '../../lib/i18n/index.js';
import { useWorkspaceLinks } from '../WorkspaceLinks.js';
import { useEditorRegistry } from '../../lib/note-editing.js';
import type { NoteEditorSession } from '../NoteEditor.js';

/** Server-managed on every save; excluded when deciding whether there is a new edit to save. */
function sameIgnoringTimestamps(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const strip = ({ created: _created, updated: _updated, ...rest }: Record<string, unknown>) => rest;
  return sameValue(strip(a), strip(b));
}

export interface UseNoteEditorSessionParams {
  note: NoteItem;
  readOnly: boolean;
  autoSave: boolean;
  draftMode: boolean;
  remoteBase?: NoteItem;
  conflictReason?: string;
  onMarkConflict?: (reason: string, draft: NoteItem, base: NoteItem) => void;
  onSave: (params: { path: string; content: string; metadata?: Record<string, unknown>; revision?: string; baseNote?: NoteItem; }) => Promise<NoteItem>;
  onReadRemote?: (path: string) => Promise<NoteItem>;
  onRestoreFile: (path: string) => Promise<NoteItem | null>;
  propIsDirty: boolean;
  branch: string;
  draftScope?: string;
  onClose?: () => void;
  onSession?: (session: NoteEditorSession | null) => void;
}

/** A note's editing session: content, frontmatter, drafts, autosave, conflicts, crash recovery and save/restore/close actions. */
export function useNoteEditorSession({ note, readOnly, autoSave, draftMode, remoteBase, conflictReason, onMarkConflict, onSave, onReadRemote, onRestoreFile, propIsDirty, branch, draftScope, onClose, onSession }: UseNoteEditorSessionParams) {
  const { t } = useTranslation();
  const [content, setContent] = useState(note.content);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const copyResetTimer = useRef<ReturnType<typeof setTimeout>>();
  const [metadata, setMetadata] = useState<Record<string, unknown>>(note.metadata || {});
  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [saveError, setSaveError] = useState(conflictReason || '');
  // Translated at render time alongside saveError, so a raw error message doesn't get frozen
  // in whatever language was active when it was caught.
  const [saveErrorParams, setSaveErrorParams] = useState<Record<string, string> | undefined>(undefined);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [baseNote, setBaseNote] = useState(remoteBase || note);
  const [blocked, setBlocked] = useState(Boolean(conflictReason));
  const [remoteNotice, setRemoteNoticeState] = useState('');
  // A new remote-notice event always starts undismissed; only dismiss() should set this true.
  const [remoteNoticeDismissed, setRemoteNoticeDismissed] = useState(false);
  const setRemoteNotice = (value: string) => {
    setRemoteNoticeState(value);
    setRemoteNoticeDismissed(false);
  };
  const [conflictDraft, setConflictDraft] = useState<NoteDraft | null>(() => getLocalDraft(`${draftScope || branch}:conflict`, note.path));
  // Identifies which persisted conflict draft the "preserved draft" notice is for, so a dismissal
  // survives reopening the note but a later, different conflict draft is shown again.
  const [conflictDraftSavedAt, setConflictDraftSavedAt] = useState<number | null>(() => getLocalDraft(`${draftScope || branch}:conflict`, note.path)?.savedAt ?? null);
  const [conflictNoticeDismissedAt, setConflictNoticeDismissedAt] = useState<number | null>(() => getDismissedConflictDraftNoticeAt(`${draftScope || branch}:conflict`, note.path));
  const operation = useRef(false);
  // Set only around the debounced disk autosave; kept separate from `operation` so a routine
  // background save never trips the navigate/close/persist guards that flag was written for.
  const autosaving = useRef(false);
  // The last autosaved draft: the `note` prop reaches it only after the notes refetch.
  const lastSaved = useRef<{ content: string; metadata: Record<string, unknown>; } | null>(null);
  const closing = useRef(false);
  const nextRemoteCheck = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = useRef({ content, metadata, baseNote, blocked });
  /* eslint-disable react/refs -- The editor keeps current draft and event callbacks in refs for async saves and imperative keyboard handlers. */
  current.current = { content, metadata, baseNote, blocked };
  /* eslint-enable react/refs */
  /* eslint-disable react/refs -- The editor keeps current draft and event callbacks in refs for async saves and imperative keyboard handlers. */
  const locked = readOnly || blocked || isRestoring || closing.current || (!autoSave && isSaving);
  /* eslint-enable react/refs */
  const preserveConflict = () => {
    const key = `${draftScope || branch}:conflict`;
    const draft = { content: current.current.content, metadata: current.current.metadata };
    saveLocalDraft(key, note.path, draft.content, draft.metadata);
    setConflictDraft(draft);
    setConflictDraftSavedAt(getLocalDraft(key, note.path)?.savedAt ?? null);
  };
  const dismissNotice = () => {
    if (remoteNotice) setRemoteNoticeDismissed(true);
    if (conflictDraftSavedAt != null) {
      dismissConflictDraftNotice(`${draftScope || branch}:conflict`, note.path, conflictDraftSavedAt);
      setConflictNoticeDismissedAt(conflictDraftSavedAt);
    }
  };
  const applyRemote = (latest: NoteItem) => {
    const state = current.current;
    if (state.blocked) return null;
    // No local edit means nothing of the user's needs merging; adopt the remote version quietly.
    const hasLocalEdits = state.content !== state.baseNote.content || !sameValue(state.metadata, state.baseNote.metadata);
    const result = mergeNote(state.baseNote, state, latest);
    if (result.conflict) {
      preserveConflict();
      current.current.blocked = true;
      setBlocked(true);
      const reason: TranslationKey = 'editor.remoteConflict';
      setSaveError(reason);
      onMarkConflict?.(reason, { ...note, content: state.content, metadata: state.metadata }, state.baseNote);
      return null;
    }
    if (hasLocalEdits && (latest.content !== state.baseNote.content || !sameValue(latest.metadata, state.baseNote.metadata))) {
      setRemoteNotice('editor.remoteChangesMerged');
    } else if (!hasLocalEdits) {
      // A clean pass-through adoption: the new content is itself already "saved" for this
      // session, so the debounce below must not mistake it for a fresh edit to persist.
      lastSaved.current = { content: result.draft.content, metadata: result.draft.metadata };
    }
    current.current = { ...state, ...result.draft, baseNote: latest };
    setBaseNote(latest);
    setContent(result.draft.content);
    setMetadata(result.draft.metadata);
    return { ...result.draft, revision: latest.revision };
  };
  const handleRemoteFailure = (error: unknown) => {
    if (!mounted.current) return;
    if (error instanceof ApiError && (error.retryAfter || error.status === 429)) {
      nextRemoteCheck.current = Date.now() + (error.retryAfter || 60) * 1000;
    }
    if (error instanceof ApiError && error.status === 404) {
      preserveConflict();
      current.current.blocked = true;
      setBlocked(true);
      const reason: TranslationKey = 'editor.remoteNoteMovedOrDeleted';
      setSaveError(reason);
      onMarkConflict?.(reason, { ...note, content: current.current.content, metadata: current.current.metadata }, current.current.baseNote);
    } else setSaveError((error as Error).message);
  };
  const checkRemote = async () => {
    if (!onReadRemote || operation.current || autosaving.current || current.current.blocked || Date.now() < nextRemoteCheck.current) return;
    nextRemoteCheck.current = Date.now() + (readOnly ? REMOTE_CHECK_INTERVAL_READONLY_MS : REMOTE_CHECK_INTERVAL_MS);
    operation.current = true;
    try {
      const latest = await onReadRemote(note.path);
      if (mounted.current) applyRemote(latest);
    } catch (error) {
      handleRemoteFailure(error);
    } finally {
      operation.current = false;
    }
  };
  const checkRemoteRef = useRef(checkRemote);
  /* eslint-disable react/refs -- The editor keeps current draft and event callbacks in refs for async saves and imperative keyboard handlers. */
  checkRemoteRef.current = checkRemote;
  /* eslint-enable react/refs */
  useEffect(() => {
    if (!onReadRemote) return;
    void checkRemoteRef.current();
    const check = () => {
      if (document.visibilityState === 'visible') void checkRemoteRef.current();
    };
    const timer = window.setInterval(check, readOnly ? REMOTE_CHECK_INTERVAL_READONLY_MS : REMOTE_CHECK_INTERVAL_MS);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [onReadRemote, note.path, readOnly]);
  const refreshRemote = async () => {
    if (!onReadRemote || operation.current) return;
    operation.current = true;
    setIsSaving(true);
    try {
      if (draftMode && current.current.blocked) preserveConflict();
      const latest = draftMode ? await onRestoreFile(note.path) : await onReadRemote(note.path);
      if (!mounted.current || !latest) return;
      setBaseNote(latest);
      setContent(latest.content);
      setMetadata(latest.metadata);
      lastSaved.current = { content: latest.content, metadata: latest.metadata };
      current.current = { ...latest, baseNote: latest, blocked: false };
      clearLocalDraft(draftScope || branch, note.path);
      setRecoveredDraft(null);
      setBlocked(false);
      setSaveError('');
      setHasUnsavedChanges(false);
      setRemoteNotice('editor.remoteVersionRefreshed');
    } catch (error) {
      handleRemoteFailure(error);
    } finally {
      operation.current = false;
      if (mounted.current) setIsSaving(false);
    }
  };
  const downloadConflictDraft = () => {
    if (!conflictDraft) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(conflictDraft, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${note.path.split('/').pop()}.draft.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Note is considered dirty if it has uncommitted edits on disk OR unsaved session edits
  const isDirty = Boolean(propIsDirty || hasUnsavedChanges);
  const canRestore = autoSave && !readOnly && !isSaving && !isRestoring && (draftMode ? isDirty : propIsDirty);
  const editorState: 'saving' | 'pending' | 'saved' = isSaving ? 'saving' : isDirty ? 'pending' : 'saved';
  const editorStatus = isSaving ? t(draftMode ? 'editor.savingLocally' : autoSave ? 'editor.autoSavingToDisk' : 'editor.savingToGitHub') : isDirty ? t(draftMode ? hasUnsavedChanges ? 'editor.unsavedLocalChanges' : 'editor.savedLocallyPendingCommit' : autoSave ? 'editor.uncommittedChanges' : 'editor.unsavedChanges') : t(readOnly ? 'editor.readOnly' : draftMode ? 'editor.noPendingChanges' : autoSave ? 'editor.cleanSavedToDisk' : 'editor.savedToGitHub');
  const title = String(metadata.title || note.title || '');

  const sessionCallback = useRef(onSession);
  /* eslint-disable react/refs -- The editor keeps current draft and event callbacks in refs for async saves and imperative keyboard handlers. */
  sessionCallback.current = onSession;
  /* eslint-enable react/refs */
  useEffect(() => {
    sessionCallback.current?.({ content, title, dirty: hasUnsavedChanges, locked });
  }, [content, title, hasUnsavedChanges, locked]);
  useEffect(() => () => sessionCallback.current?.(null), []);

  // Crash recovery state
  const [recoveredDraft, setRecoveredDraft] = useState<{ content: string; metadata: Record<string, unknown>; savedAt: number; } | null>(null);

  // Check local draft on note open
  /* eslint-disable react-hooks/exhaustive-deps -- Only editor identity opens a session; incoming note or base snapshots must not overwrite the active draft or restart crash recovery. */
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Session opening reads persisted recovery state and updates the saved baseline before the autosave effect; preserve this ordering. */
    setBaseNote(remoteBase || note);
    /* eslint-enable react/set-state-in-effect */
    setContent(note.content);
    setMetadata(note.metadata || {});
    setHasUnsavedChanges(false);
    setConfirmRestore(false);
    setCopyState('idle');
    // `note` already reflects whatever is durably persisted for this session (the file on disk in
    // local mode, or the currently staged working draft in draftMode); treat it as already-saved so
    // opening a note never re-triggers a save of content it did not actually change.
    lastSaved.current = { content: note.content, metadata: note.metadata || {} };

    const draft = readOnly ? null : getLocalDraft(draftScope || branch, note.path);
    if (draft && (draft.content !== note.content || !sameValue(draft.metadata, note.metadata))) {
      setRecoveredDraft(draft);
    } else {
      setRecoveredDraft(null);
    }
  }, [note.path, branch, draftScope, readOnly]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Debounced auto-save directly to disk on edit
  useEffect(() => {
    if (readOnly || closing.current) return;
    // `lastSaved` tracks whatever is already durably persisted for this session (synced on note
    // open, after a successful save, and on a clean remote pass-through); comparing against it
    // directly - rather than against `baseNote` or the parent's possibly-stale `note` prop - is
    // what correctly separates a real edit from content that already matches what was saved.
    const saved = lastSaved.current;
    const isDifferent = !(saved && content === saved.content && sameIgnoringTimestamps(metadata, saved.metadata));

    if (isDifferent) {
      setHasUnsavedChanges(true);

      // Save local draft for crash recovery
      saveLocalDraft(draftScope || branch, note.path, content, metadata);

      if (!autoSave || blocked || isRestoring) return;

      // Timestamps are stamped server-side on every save; absorb them so the next
      // comparison against the refreshed `note`/`baseNote` prop doesn't see a
      // spurious difference and re-save in a loop.
      const absorbTimestamps = (saved: NoteItem) => setMetadata(current => (current.created === saved.metadata.created && current.updated === saved.metadata.updated ? current : { ...current, created: saved.metadata.created, updated: saved.metadata.updated }));

      if (draftMode) {
        /* eslint-disable react/set-state-in-effect -- The committed draft starts an asynchronous save; its saving indicator must follow the same lifecycle as completion, failure and cancellation. */
        setIsSaving(true);
        /* eslint-enable react/set-state-in-effect */
        void onSave({ path: note.path, content, metadata, baseNote }).then(saved => {
          if (!mounted.current) return;
          lastSaved.current = { content, metadata };
          clearLocalDraft(draftScope || branch, note.path);
          absorbTimestamps(saved);
          setHasUnsavedChanges(false);
          setSaveError('');
        }).catch(error => {
          if (mounted.current) {
            setSaveError('editor.localSaveFailed');
            setSaveErrorParams({ message: error.message });
          }
        }).finally(() => {
          if (mounted.current) setIsSaving(false);
        });
        return;
      }

      // Debounced auto-save to disk
      let cancelled = false;
      const timer = setTimeout(async () => {
        // Defer to an in-flight checkRemote/save/restore rather than racing it.
        while (operation.current && !cancelled) await new Promise(resolve => setTimeout(resolve, 50));
        // A newer effect run (e.g. a remote merge, or further typing) superseded this one
        // while it waited; its own debounce now owns saving the current draft.
        if (cancelled || !mounted.current) return;
        setIsSaving(true);
        // Held for the save's duration so a concurrent remote check (focus/interval)
        // can't read this same write back mid-flight and mistake it for an external change.
        autosaving.current = true;
        try {
          const saved = await onSave({ path: note.path, content, metadata });
          lastSaved.current = { content, metadata };
          clearLocalDraft(draftScope || branch, note.path);
          absorbTimestamps(saved);
          // The file on disk now matches this draft; adopt it as the base so a later
          // remote check does not treat the app's own write as an external change.
          current.current = { ...current.current, baseNote: saved };
          setBaseNote(saved);
          setHasUnsavedChanges(false);
        } catch (err) {
          setSaveError((err as Error).message);
        } finally {
          autosaving.current = false;
          setIsSaving(false);
        }
      }, 750);

      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    } else {
      setHasUnsavedChanges(false);
      // Edits undone after a save leave nothing newer than it to recover.
      if (saved) clearLocalDraft(draftScope || branch, note.path);
    }
  }, [content, metadata, note, branch, draftScope, onSave, readOnly, autoSave, baseNote, blocked, draftMode, isRestoring]);

  const handleExplicitSave = async () => {
    if (locked || operation.current) return;
    operation.current = true;
    setIsSaving(true);
    setSaveError('');
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
      setBaseNote(saved);
      setContent(saved.content);
      setMetadata(saved.metadata);
      lastSaved.current = { content: saved.content, metadata: saved.metadata };
      current.current = { ...saved, baseNote: saved, blocked: false };
      clearLocalDraft(draftScope || branch, note.path);
      setHasUnsavedChanges(false);
      setRemoteNotice('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && onReadRemote) {
        try {
          const latest = await onReadRemote(note.path);
          if (mounted.current && applyRemote(latest)) setSaveError('editor.remoteChangedDuringSave');
        } catch (readError) {
          handleRemoteFailure(readError);
        }
      } else handleRemoteFailure(error);
    } finally {
      operation.current = false;
      if (mounted.current) setIsSaving(false);
    }
  };
  const { registerBeforeNavigate } = useWorkspaceLinks();
  const registerEditor = useEditorRegistry();
  useEffect(() => {
    const persist = async () => {
      const draft = current.current;
      if (draft.content === note.content && sameValue(draft.metadata, note.metadata)) return true;
      saveLocalDraft(draftScope || branch, note.path, draft.content, draft.metadata);
      try {
        await onSave({ path: note.path, content: draft.content, metadata: draft.metadata, baseNote: draft.baseNote });
        clearLocalDraft(draftScope || branch, note.path);
        return true;
      } catch (error) {
        setSaveError((error as Error).message);
        return false;
      }
    };
    // A concurrent operation (e.g. a just-mounted checkRemote) is read-only in effect by the time it
    // finishes, so navigation/hiding waits it out instead of racing it or dropping the flush entirely.
    const waitForOperation = async () => {
      while (operation.current) await new Promise(resolve => setTimeout(resolve, 50));
    };
    // Navigation waits for a conflict to be resolved; hiding the editor keeps the preserved draft, as closing zoom does.
    const beforeNavigate = async () => {
      if (readOnly) return true;
      await waitForOperation();
      return !mounted.current || (!current.current.blocked && await persist());
    };
    const beforeHide = async () => {
      if (readOnly) return true;
      await waitForOperation();
      return !mounted.current || current.current.blocked || await persist();
    };
    const unregister = [registerBeforeNavigate(beforeNavigate), registerEditor(note.path, beforeHide)];
    return () => unregister.forEach(release => release());
  }, [registerBeforeNavigate, registerEditor, readOnly, note, onSave, draftScope, branch]);

  const close = async () => {
    if (closing.current || isRestoring || operation.current) return;
    if (autoSave && !readOnly && !current.current.blocked && (draftMode || current.current.content !== note.content || !sameIgnoringTimestamps(current.current.metadata, note.metadata))) {
      closing.current = true;
      setIsSaving(true);
      try {
        await onSave({ path: note.path, content: current.current.content, metadata: current.current.metadata, baseNote: current.current.baseNote });
        clearLocalDraft(draftScope || branch, note.path);
      } catch (error) {
        closing.current = false;
        setIsSaving(false);
        setSaveError('editor.localSaveFailed');
        setSaveErrorParams({ message: (error as Error).message });
        return;
      }
    }
    if (!autoSave && !readOnly && hasUnsavedChanges && !window.confirm(t('editor.confirmCloseUnsaved'))) return;
    closing.current = false;
    setIsSaving(false);
    onClose?.();
  };
  const copyNote = async () => {
    const ok = await copyToClipboard(current.current.content);
    if (!mounted.current) return;
    clearTimeout(copyResetTimer.current);
    setCopyState(ok ? 'copied' : 'error');
    copyResetTimer.current = setTimeout(() => {
      if (mounted.current) setCopyState('idle');
    }, 2000);
  };

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

  // Two-click confirm single-file restore state
  const [confirmRestore, setConfirmRestore] = useState(false);
  const restoreTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Two-click confirm single-file restore
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
      setIsRestoring(true);
      operation.current = true;
      setIsSaving(true);
      const restored = await onRestoreFile(note.path);
      clearLocalDraft(draftScope || branch, note.path);
      if (restored) {
        setBaseNote(restored);
        setContent(restored.content);
        setMetadata(restored.metadata || {});
        lastSaved.current = { content: restored.content, metadata: restored.metadata || {} };
      }
      setHasUnsavedChanges(false);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setIsRestoring(false);
      operation.current = false;
      setIsSaving(false);
    }
  };

  const conflictDraftDismissed = conflictDraftSavedAt != null && conflictNoticeDismissedAt === conflictDraftSavedAt;
  const showRemoteNotice = Boolean(remoteNotice) && (blocked || !remoteNoticeDismissed);
  const showConflictDraftNotice = Boolean(conflictDraft) && (blocked || !conflictDraftDismissed);

  return { content, setContent, metadata, setMetadata, copyState, copyNote, isSaving, isRestoring, saveError, saveErrorParams, hasUnsavedChanges, baseNote, blocked, locked, isDirty, canRestore, editorState, editorStatus, title, recoveredDraft, handleRestoreDraft, handleDiscardDraft, confirmRestore, handleRestoreClick, conflictDraft, showRemoteNotice, remoteNotice, showConflictDraftNotice, dismissNotice, refreshRemote, downloadConflictDraft, handleExplicitSave, close };
}
