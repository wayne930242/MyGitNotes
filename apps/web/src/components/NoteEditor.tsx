import { Button } from './Button.js';
import { useWorkspaceLinks } from './WorkspaceLinks.js';
import { isNoteHidden, withNoteStatus } from '@mygitnotes/core/note-status';
import { EditorNotice } from './EditorNotice.js';
import { EditorFooter } from './EditorFooter.js';
import { Select } from './Select.js';
import { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import YAML from 'yaml';
import {
  X,
  Save,
  FileText,
  RotateCcw,
  AlertTriangle,
  Search,
  ChevronUp,
  ChevronDown,
  PanelRight,
  Code,
  Code2,
  Eye,
  LayoutGrid,
  Copy,
  Check,
  ListOrdered,
} from 'lucide-react';
import { mergeNote, sameValue, NoteDraft } from '../lib/merge-note.js';
import { ApiError } from '../lib/api.js';
import { MarkdownEditor, MarkdownEditorHandle, MarkdownEditorMode, MarkdownEditorModeSwitch } from './MarkdownEditor.js';
import { FileManager } from './FileManager.js';
import { FileSourceEditor } from './FileSourceEditor.js';
import { NoteItem, AssetItem, NotebookMetadataField } from '../lib/types.js';
import { saveLocalDraft, getLocalDraft, clearLocalDraft, dismissConflictDraftNotice, getDismissedConflictDraftNoticeAt } from '../lib/storage.js';
import { copyToClipboard } from '../lib/clipboard.js';
import { CrashRecoveryBanner } from './CrashRecoveryBanner.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { TranslationKey } from '../lib/i18n/index.js';
import { chooseOutlineHeading, findOutlineIndexForLine, findTextMatches, isEditableTarget, parseMarkdownOutline } from '../lib/note-navigation.js';
import { usePanelContext } from '../lib/panel-context.js';
import { useEditorRegistry } from '../lib/note-editing.js';



export type NotePanelMode = 'find' | 'outline' | 'frontmatter' | 'assets' | 'git';
export const NOTE_PANEL_MODES: readonly NotePanelMode[] = ['outline', 'find', 'frontmatter', 'assets', 'git'];

/** Server-managed on every save; excluded when deciding whether there is a new edit to save. */
function sameIgnoringTimestamps(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const strip = ({ created, updated, ...rest }: Record<string, unknown>) => rest;
  return sameValue(strip(a), strip(b));
}

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
  documentPanel?: { target: HTMLElement | null; mode: NotePanelMode | null; onChange: (mode: NotePanelMode | null) => void };
  /** Zoom frame: saves, then leaves zoom. */
  onClose?: () => void;
  onAddToFocus?: () => void;
  /** Reports the session whenever it changes, and null when the editor unmounts. */
  onSession?: (session: NoteEditorSession | null) => void;
  onCaret?: (position: number) => void;
}

/** A note's editing session: content, frontmatter, drafts, autosave, conflicts, crash recovery and the document panel. */
export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(({
  note,
  frame,
  active,
  documentPanel,
  onClose,
  onAddToFocus,
  onSession,
  onCaret,
  statuses,
  metadataFields,
  readOnly = false,
  autoSave = true,
  draftMode = false,
  remoteBase,
  conflictReason,
  onMarkConflict,
  onSave,
  onReadRemote,
  onRestoreFile,
  isDirty: propIsDirty = false,
  availableTags = [],
  branch,
  draftScope,
}, ref) => {

  const isMarkdown = /\.(md|markdown|mdx)$/i.test(note.path);
  const { t } = useTranslation();
  const panel = usePanelContext();
  // The workspace rail hides only behind zoom; a pane editor shares the page with it.
  useEffect(() => {
    if (frame !== 'zoom') return;
    panel.setHasOpenNote(true); return () => panel.setHasOpenNote(false);
  }, [frame]);

  // Editor states
  const [content, setContent] = useState(note.content);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const copyResetTimer = useRef<ReturnType<typeof setTimeout>>();
  const [metadata, setMetadata] = useState<Record<string, unknown>>(note.metadata || {});
  const [newFieldKey, setNewFieldKey] = useState('');
  const [frontmatterViewMode, setFrontmatterViewMode] = useState<'form' | 'yaml'>('form');
  const [yamlText, setYamlText] = useState(() => YAML.stringify(note.metadata || {}));
  const [yamlError, setYamlError] = useState('');

  const customFields = useMemo(() => {
    const RESERVED_METADATA_KEYS = new Set(['title', 'status', 'hiden', 'tags', 'created', 'updated']);
    const fields: { key: string; type: 'string' | 'boolean' | 'number'; label: string; isConfigured: boolean }[] = [];
    const seen = new Set<string>();

    if (metadataFields) {
      for (const f of metadataFields) {
        if (!RESERVED_METADATA_KEYS.has(f.key)) {
          fields.push({
            key: f.key,
            type: f.type || (typeof metadata[f.key] === 'boolean' ? 'boolean' : typeof metadata[f.key] === 'number' ? 'number' : 'string'),
            label: f.label || f.key,
            isConfigured: true,
          });
          seen.add(f.key);
        }
      }
    }

    for (const key of Object.keys(metadata)) {
      if (!RESERVED_METADATA_KEYS.has(key) && !seen.has(key)) {
        const val = metadata[key];
        const inferredType: 'string' | 'boolean' | 'number' =
          typeof val === 'boolean' ? 'boolean' : typeof val === 'number' ? 'number' : 'string';
        fields.push({
          key,
          type: inferredType,
          label: key,
          isConfigured: false,
        });
        seen.add(key);
      }
    }
    return fields;
  }, [metadataFields, metadata]);

  const [editorMode, setEditorMode] = useState<MarkdownEditorMode>('live');
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  const [ownPanel, updateNotePanel] = useState<NotePanelMode | null>(null);
  const notePanel = frame === 'pane' ? documentPanel?.mode ?? null : ownPanel;
  const lastNotePanel = useRef<NotePanelMode>((() => {
    try {
      const saved = localStorage.getItem('mygitnotes.documentPanel');
      if (['find', 'outline', 'frontmatter', 'assets', 'git'].includes(saved || '')) return saved as NotePanelMode;
    } catch { /* Use the default panel when storage is unavailable. */ }
    return isMarkdown ? 'outline' : 'find';
  })());
  const setNotePanel = (next: NotePanelMode | null) => {
    if (next) {
      lastNotePanel.current = next;
      try { localStorage.setItem('mygitnotes.documentPanel', next); }
      catch { /* The in-memory preference remains available. */ }
    }
    if (frame === 'pane') documentPanel?.onChange(next);
    else updateNotePanel(next);
  };
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
  const setRemoteNotice = (value: string) => { setRemoteNoticeState(value); setRemoteNoticeDismissed(false); };
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
  const lastSaved = useRef<{ content: string; metadata: Record<string, unknown> } | null>(null);
  const closing = useRef(false);
  const nextRemoteCheck = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = useRef({ content, metadata, baseNote, blocked });
  current.current = { content, metadata, baseNote, blocked };
  const locked = readOnly || blocked || isRestoring || closing.current || (!autoSave && isSaving);
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
      const reason: TranslationKey = 'editor.remoteNoteMovedOrDeleted';
      setSaveError(reason);
      onMarkConflict?.(reason, { ...note, content: current.current.content, metadata: current.current.metadata }, current.current.baseNote);
    } else setSaveError((error as Error).message);
  };
  const checkRemote = async () => {
    if (!onReadRemote || operation.current || autosaving.current || current.current.blocked || Date.now() < nextRemoteCheck.current) return;
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
      setRemoteNotice('editor.remoteVersionRefreshed');
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
  // The editor's insert actions render into the toolbar, at its far end (before zoom's close button).
  const [insertSlot, setInsertSlot] = useState<HTMLDivElement | null>(null);
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
    setIsEditorLeaderOpen(false); setNotePanel('find');
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
  const title = String(metadata.title || note.title || '');

  useImperativeHandle(ref, () => ({
    insert(text, at) { if (!locked) editorRef.current?.insert(text, at); },
  }), [locked]);
  const sessionCallback = useRef(onSession); sessionCallback.current = onSession;
  useEffect(() => { sessionCallback.current?.({ content, title, dirty: hasUnsavedChanges, locked }); }, [content, title, hasUnsavedChanges, locked]);
  useEffect(() => () => sessionCallback.current?.(null), []);

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
    setCopyState('idle');
    lastSaved.current = null;

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
    // `baseNote` is this session's own merge base, kept current as soon as a remote check
    // applies; the `note` prop only catches up once the parent re-renders with it.
    const baseline = baseNote;
    const saved = lastSaved.current;
    const isDifferent = !(saved && content === saved.content && sameIgnoringTimestamps(metadata, saved.metadata))
      && (content !== baseline.content || !sameIgnoringTimestamps(metadata, baseline.metadata));

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
          lastSaved.current = { content, metadata };
          clearLocalDraft(draftScope || branch, note.path);
          absorbTimestamps(saved);
          setHasUnsavedChanges(false); setSaveError('');
        }).catch(error => { if (mounted.current) { setSaveError('editor.localSaveFailed'); setSaveErrorParams({ message: error.message }); } })
          .finally(() => { if (mounted.current) setIsSaving(false); });
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
          const saved = await onSave({
            path: note.path,
            content,
            metadata,
          });
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

      return () => { cancelled = true; clearTimeout(timer); };
    } else {
      setHasUnsavedChanges(false);
      // Edits undone after a save leave nothing newer than it to recover.
      if (saved) clearLocalDraft(draftScope || branch, note.path);
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
          if (mounted.current && applyRemote(latest)) setSaveError('editor.remoteChangedDuringSave');
        } catch (readError) { handleRemoteFailure(readError); }
      } else handleRemoteFailure(error);
    } finally { operation.current = false; if (mounted.current) setIsSaving(false); }
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
      } catch (error) { setSaveError((error as Error).message); return false; }
    };
    // A concurrent operation (e.g. a just-mounted checkRemote) is read-only in effect by the time it
    // finishes, so navigation/hiding waits it out instead of racing it or dropping the flush entirely.
    const waitForOperation = async () => { while (operation.current) await new Promise(resolve => setTimeout(resolve, 50)); };
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
      closing.current = true; setIsSaving(true);
      try {
        await onSave({ path: note.path, content: current.current.content, metadata: current.current.metadata, baseNote: current.current.baseNote });
        clearLocalDraft(draftScope || branch, note.path);
      }
      catch (error) { closing.current = false; setIsSaving(false); setSaveError('editor.localSaveFailed'); setSaveErrorParams({ message: (error as Error).message }); return; }
    }
    if (!autoSave && !readOnly && hasUnsavedChanges && !window.confirm(t('editor.confirmCloseUnsaved'))) return;
    closing.current = false; setIsSaving(false);
    onClose?.();
  };
  const copyNote = async () => {
    const ok = await copyToClipboard(current.current.content);
    if (!mounted.current) return;
    clearTimeout(copyResetTimer.current);
    setCopyState(ok ? 'copied' : 'error');
    copyResetTimer.current = setTimeout(() => { if (mounted.current) setCopyState('idle'); }, 2000);
  };
  const escapeAction = useRef<() => boolean>(() => false);
  escapeAction.current = () => {
    if (isEditorLeaderOpen) setIsEditorLeaderOpen(false);
    else if (notePanel) setNotePanel(null);
    else return false;
    return true;
  };
  const openOutline = () => {
    const currentLine = editorRef.current?.getCurrentLine() ?? 1;
    setIsEditorLeaderOpen(false);
    setOutlineIndex(findOutlineIndexForLine(outline, currentLine));
    setNotePanel('outline');
  };
  const chooseOutline = (index: number, closeAfter = false) => {
    const target = chooseOutlineHeading(outline, index, { closeAfter });
    if (!target) return;
    setOutlineIndex(index);
    editorRef.current?.goToLine(target.line, { focus: target.focusEditor, smooth: true });
    if (target.shouldClosePanel) setNotePanel(null);
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
    // Outside zoom, Alt+/ belongs to the command palette.
    if (slashKey && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (frame !== 'zoom') return false;
      setIsEditorLeaderOpen(open => !open); return true;
    }
    if (isEditorLeaderOpen && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key.toLowerCase() === 'f') { openFind(); return true; }
      if (slashKey) { openOutline(); return true; }
    }
    if (isOutlineOpen && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (isEditableTarget(event.target) || (event.target instanceof Element && event.target.closest('[role="tablist"]'))) return false;
      if (event.key.toLowerCase() === 'j' || event.key === 'ArrowDown') {
        moveOutline(1); return true;
      }
      if (event.key.toLowerCase() === 'k' || event.key === 'ArrowUp') {
        moveOutline(-1); return true;
      }
      if (event.key === 'Enter') { chooseOutline(outlineIndex, false); return true; }
    }
    return false;
  };
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open], [role="listbox"]')) return;
      if (shortcutAction.current(event)) {
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (event.key === 'Escape' && !document.querySelector('dialog[open], [aria-label="Asset preview"]')) {
        if (escapeAction.current()) { event.preventDefault(); event.stopPropagation(); }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [active]);

  useEffect(() => {
    if (!isOutlineOpen || outline.length === 0) return;
    const index = Math.min(outlineIndex, outline.length - 1);
    if (index !== outlineIndex) { setOutlineIndex(index); return; }
    if (isEditableTarget(document.activeElement)) return;
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
    setNotePanel(null);
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


  const panelSections = <>
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

            {showFrontmatter && (
              <div className="note-panel-scroll flex flex-col h-full">
                {/* Frontmatter Mode Switch */}
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-line shrink-0">
                  <span className="font-semibold text-xs text-fg">
                    {t('editor.frontmatter')}
                  </span>
                  <div className="inline-flex rounded-md p-0.5 bg-sidebar text-[11px]">
                    <button
                      type="button"
                      onClick={() => setFrontmatterViewMode('form')}
                      className={`px-2 py-0.5 rounded font-medium transition-colors ${
                        frontmatterViewMode === 'form'
                          ? 'bg-surface text-fg shadow-sm'
                          : 'text-muted hover:text-fg'
                      }`}
                    >
                      {t('editor.formMode')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setYamlText(YAML.stringify(metadata));
                        setYamlError('');
                        setFrontmatterViewMode('yaml');
                      }}
                      className={`px-2 py-0.5 rounded font-medium flex items-center gap-1 transition-colors ${
                        frontmatterViewMode === 'yaml'
                          ? 'bg-surface text-fg shadow-sm'
                          : 'text-muted hover:text-fg'
                      }`}
                    >
                      <Code className="w-3 h-3" />
                      {t('editor.yamlMode')}
                    </button>
                  </div>
                </div>

                {frontmatterViewMode === 'form' ? (
                  <fieldset disabled={locked} className="note-metadata min-w-0 text-xs animate-fadeIn space-y-3">
            <div>
              <label className="block text-muted font-semibold mb-1">{t('editor.title')}</label>
              <input
                type="text"
                value={String(metadata.title || '')}
                onChange={(e) => setMetadata({ ...metadata, title: e.target.value })}
                placeholder={t('editor.titlePlaceholder')}
                className="ui-control w-full"
              />
            </div>
            <div>
              <label className="block text-muted font-semibold mb-1">{t('editor.status')}</label>
              <Select aria-label={t('editor.status')} disabled={locked} value={String(metadata.status || '')} onValueChange={value => setMetadata(withNoteStatus(metadata, value))} options={Array.from(new Set(['', ...statuses, String(metadata.status || '')])).map(value => ({value,label:value || t('editor.noStatus')}))} className={`w-full ${metadata.status ? '' : 'status-empty'}`} />
              <label className="flex items-center gap-2 min-h-11 cursor-pointer">
                <input type="checkbox" aria-label={t('editor.hideNote')} checked={isNoteHidden(metadata)}
                  onChange={event => setMetadata({ ...metadata, hiden: event.target.checked })}
                  className="w-4 h-4 accent-primary" />
                {t('editor.hideNote')}
              </label>
            </div>

            {/* Tags with Autocomplete (Requirement 4) */}
            <div className="relative">
              <label className="block text-muted font-semibold mb-1">
                {t('editor.tags')}
              </label>
              <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-surface border border-line rounded-md min-h-[35px] relative">
                {currentTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-fg/5 text-fg border border-line"
                  >
                    <span>{tag}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="text-muted hover:text-danger font-bold ml-0.5"
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
                    className="w-full text-xs bg-transparent focus:outline-none text-fg"
                  />

                  {/* Autocomplete Dropdown */}
                  {isTagDropdownOpen && suggestedTags.length > 0 && (
                    <div className="absolute top-full left-0 mt-1 w-52 bg-surface border border-line rounded-lg shadow-xl z-50 max-h-40 overflow-y-auto py-1">
                      {suggestedTags.map((st) => (
                        <button
                          key={st}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleAddTag(st);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-fg/5 flex items-center justify-between text-fg"
                        >
                          <span className="font-semibold">{st}</span>
                          <span className="text-[10px] text-muted">{t('editor.add')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick suggestion suggestions below */}
              {suggestedTags.length > 0 && !tagInput && (
                <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted flex-wrap">
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

            {/* Custom / Notebook Metadata fields */}
            {customFields.length > 0 && (
              <div className="pt-2 border-t border-line space-y-3">
                <span className="block text-muted font-semibold mb-1">
                  {t('editor.metadata') || 'Metadata'}
                </span>
                {customFields.map((field) => {
                  if (field.type === 'boolean') {
                    return (
                      <label key={field.key} className="flex items-center gap-2 min-h-8 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          aria-label={field.label}
                          checked={Boolean(metadata[field.key])}
                          onChange={(e) => setMetadata({ ...metadata, [field.key]: e.target.checked })}
                          className="w-4 h-4 accent-primary rounded"
                        />
                        <span className="text-fg font-medium">{field.label}</span>
                      </label>
                    );
                  }

                  return (
                    <div key={field.key}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-muted font-semibold">{field.label}</label>
                        {!field.isConfigured && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = { ...metadata };
                              delete next[field.key];
                              setMetadata(next);
                            }}
                            className="text-[10px] text-muted hover:text-danger"
                            title="Remove field"
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={
                          metadata[field.key] === undefined || metadata[field.key] === null
                            ? ''
                            : typeof metadata[field.key] === 'object'
                              ? JSON.stringify(metadata[field.key])
                              : String(metadata[field.key])
                        }
                        onChange={(e) => {
                          let val: unknown = e.target.value;
                          if (field.type === 'number') {
                            const num = Number(e.target.value);
                            val = isNaN(num) ? e.target.value : num;
                          }
                          setMetadata({ ...metadata, [field.key]: val });
                        }}
                        className="ui-control w-full text-xs"
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add Custom Field */}
            <div className="pt-2 border-t border-line">
              <div className="flex gap-1.5 items-center">
                <input
                  type="text"
                  placeholder="New field name..."
                  value={newFieldKey}
                  onChange={(e) => setNewFieldKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newFieldKey.trim()) {
                      e.preventDefault();
                      const key = newFieldKey.trim();
                      if (!metadata[key]) {
                        setMetadata({ ...metadata, [key]: '' });
                      }
                      setNewFieldKey('');
                    }
                  }}
                  className="ui-control flex-1 text-xs py-1"
                />
                <button
                  type="button"
                  onClick={() => {
                    const key = newFieldKey.trim();
                    if (key && !metadata[key]) {
                      setMetadata({ ...metadata, [key]: '' });
                    }
                    setNewFieldKey('');
                  }}
                  disabled={!newFieldKey.trim()}
                  className="px-2 py-1 text-xs bg-line hover:bg-fg/10 rounded disabled:opacity-50 text-fg"
                >
                  +
                </button>
              </div>
            </div>
          </fieldset>
        ) : (
                  <div className="flex-1 flex flex-col min-h-0 text-xs space-y-2">
                    {yamlError && (
                      <div className="p-2 rounded bg-danger-soft border border-danger/40 text-danger font-mono text-[11px] break-all">
                        {yamlError}
                      </div>
                    )}
                    <div className="flex-1 border border-line rounded-md overflow-hidden min-h-[340px]">
                      <FileSourceEditor
                        path="metadata.yaml"
                        content={yamlText}
                        readOnly={locked}
                        label="YAML Metadata"
                        onChange={(newYaml) => {
                          setYamlText(newYaml);
                          try {
                            const parsed = YAML.parse(newYaml);
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                              setMetadata(parsed as Record<string, unknown>);
                              setYamlError('');
                            } else if (newYaml.trim() === '') {
                              setMetadata({});
                              setYamlError('');
                            } else {
                              setYamlError(`${t('editor.yamlError')}: Root must be a mapping`);
                            }
                          } catch (err) {
                            setYamlError(err instanceof Error ? err.message : t('editor.yamlError'));
                          }
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-muted leading-tight">
                      {t('editor.yamlHint')}
                    </p>
                  </div>
                )}
              </div>
            )}

            {isAssetPickerOpen && <FileManager notebookId={note.notebookId} writable={false} mode="pick-image" layout="panel"
              onInsert={locked ? undefined : handleInsertAssetRef} />}

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
  </>;
  const panelTabs = <div className="note-panel-tabs" role="tablist" aria-label={t('editor.documentPanel')} onKeyDown={event => {
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const target = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (index < 0 || target === undefined) return;
    event.preventDefault();
    tabs[(target + tabs.length) % tabs.length].focus();
  }}>
    <Button type="button" role="tab" aria-selected={isFindOpen} tabIndex={isFindOpen || !((isMarkdown && isOutlineOpen) || showFrontmatter || isAssetPickerOpen || isGitPanelOpen) ? 0 : -1} aria-label={t('editor.findInNote')} title={t('editor.findInNote')} onClick={() => setNotePanel(isFindOpen ? null : 'find')}><span>{t('editor.find')}</span></Button>
    {isMarkdown && <Button type="button" role="tab" aria-selected={isOutlineOpen} tabIndex={isOutlineOpen ? 0 : -1} aria-label={t('editor.outline')} title={t('editor.outline')} onClick={() => isOutlineOpen ? setNotePanel(null) : openOutline()}><span>{t('editor.outline')}</span></Button>}
    <Button type="button" role="tab" aria-selected={showFrontmatter} tabIndex={showFrontmatter ? 0 : -1} aria-label={t('editor.frontmatter')} title={t('editor.frontmatter')} onClick={() => setNotePanel(showFrontmatter ? null : 'frontmatter')}><span>{t('editor.frontmatter')}</span></Button>
    <Button type="button" role="tab" aria-selected={isAssetPickerOpen} tabIndex={isAssetPickerOpen ? 0 : -1} aria-label={t('editor.notebookAssets')} title={t('editor.notebookAssets')} onClick={() => setNotePanel(isAssetPickerOpen ? null : 'assets')}><span>{t('editor.asset')}</span></Button>
    <Button type="button" role="tab" aria-selected={isGitPanelOpen} tabIndex={isGitPanelOpen ? 0 : -1} aria-label={t('editor.fileGitStatus')} title={t('editor.fileGitStatus')} onClick={() => setNotePanel(isGitPanelOpen ? null : 'git')}><span>{t('editor.git')}</span></Button>
  </div>;

  // A blocking state cannot be dismissed while it blocks, so it ignores dismissal entirely.
  const conflictDraftDismissed = conflictDraftSavedAt != null && conflictNoticeDismissedAt === conflictDraftSavedAt;
  const showRemoteNotice = Boolean(remoteNotice) && (blocked || !remoteNoticeDismissed);
  const showConflictDraftNotice = Boolean(conflictDraft) && (blocked || !conflictDraftDismissed);

  return (
      <div className="note-editor" data-frame={frame}>
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

        {saveError && <EditorNotice tone="error">{t(saveError as TranslationKey, saveErrorParams)}</EditorNotice>}

        {(blocked || showRemoteNotice || showConflictDraftNotice) && <EditorNotice actions={<>
          {blocked && <button disabled={isSaving} onClick={refreshRemote} className="font-semibold underline hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition">{t('editor.refreshRemote')}</button>}
          {conflictDraft && <button onClick={downloadConflictDraft} className="underline hover:opacity-80 transition">{t('editor.downloadPreservedDraft')}</button>}
          {!blocked && <button type="button" aria-label={t('editor.dismissNotice')} title={t('editor.dismissNotice')} onClick={dismissNotice} className="ui-icon-button"><X aria-hidden="true" /></button>}
        </>}>{showRemoteNotice ? t(remoteNotice as TranslationKey) : t('editor.localChangesPreserved')}</EditorNotice>}
        </div>

        {frame === 'compact' ? <>
          <div className="note-editor-body">
            <MarkdownEditor ref={editorRef} compact content={content} path={note.path} mode={editorMode} readOnly={locked} onChange={setContent} onCaret={onCaret} ariaLabel="Note content" showLineNumbers={showLineNumbers} />
          </div>
          <div className="note-compact-bar">
            {isMarkdown && <button type="button" className="ui-icon-button" data-mode-toggle={editorMode} title={t(editorMode === 'live' ? 'editor.source' : 'editor.livePreview')} aria-label={t(editorMode === 'live' ? 'editor.source' : 'editor.livePreview')}
              onClick={() => setEditorMode(editorMode === 'live' ? 'raw' : 'live')}>{editorMode === 'live' ? <Code2 size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}</button>}
            <button type="button" className="ui-icon-button" aria-pressed={showLineNumbers} title={t('editor.lineNumbers')} aria-label={t('editor.lineNumbers')}
              onClick={() => setShowLineNumbers(value => !value)}><ListOrdered size={14} aria-hidden="true" /></button>
            <button type="button" className="ui-icon-button" title={t(copyState === 'copied' ? 'editor.noteCopied' : copyState === 'error' ? 'editor.noteCopyFailed' : 'editor.copyNote')} aria-label={t(copyState === 'copied' ? 'editor.noteCopied' : copyState === 'error' ? 'editor.noteCopyFailed' : 'editor.copyNote')}
              onClick={copyNote}>{copyState === 'copied' ? <Check size={14} aria-hidden="true" /> : copyState === 'error' ? <AlertTriangle size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</button>
            <span className="note-compact-path" title={note.path}>{note.notebookId} · {note.path.split('/').pop()}</span>
            <span role="status" className="note-compact-status" data-state={editorState}><span className={`note-compact-dot ${editorState === 'saving' ? 'animate-pulse' : ''}`} aria-hidden="true" />{editorStatus}</span>
          </div>
        </> : <>
        {/* Modal Top Bar */}
        <div className="note-toolbar relative shrink-0 px-5 py-3.5 border-b border-line flex items-center justify-between gap-4 bg-sidebar/60">
          {frame === 'zoom' && <div className="note-heading flex items-center gap-3 truncate">
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
              <div className="font-serif font-semibold text-fg text-sm truncate">
                {String(metadata.title || note.title || t('editor.untitled'))}
              </div>
              <div className="text-xs text-muted font-mono truncate">
                {note.path}
              </div>
            </div>
          </div>}

          <div className="note-controls flex items-center gap-2">
            {!autoSave && !readOnly && <Button variant="primary" aria-label={t('editor.saveToGitHub')} title={t('editor.saveToGitHub')} disabled={locked || !hasUnsavedChanges} onClick={handleExplicitSave} className="note-save editor-action" ><Save className="editor-mobile-icon w-5 h-5" /><span>{isSaving ? t('editor.saving') : t('editor.saveToGitHub')}</span></Button>}
            {isMarkdown && <MarkdownEditorModeSwitch mode={editorMode} onChange={setEditorMode} />}
            <button type="button" aria-pressed={showLineNumbers} aria-label={t('editor.lineNumbers')} title={t('editor.lineNumbers')}
              onClick={() => setShowLineNumbers(value => !value)}
              className="ui-icon-button toolbar-icon-button editor-line-numbers-action"><ListOrdered aria-hidden="true" /></button>

            <button type="button" aria-label={t(copyState === 'copied' ? 'editor.noteCopied' : copyState === 'error' ? 'editor.noteCopyFailed' : 'editor.copyNote')} title={t(copyState === 'copied' ? 'editor.noteCopied' : copyState === 'error' ? 'editor.noteCopyFailed' : 'editor.copyNote')} onClick={copyNote}
              className="ui-icon-button toolbar-icon-button">{copyState === 'copied' ? <Check aria-hidden="true" /> : copyState === 'error' ? <AlertTriangle aria-hidden="true" /> : <Copy aria-hidden="true" />}</button>
            {onAddToFocus && <button type="button" aria-label={t('focus.addTo')} title={t('focus.addTo')} onClick={onAddToFocus}
              className="ui-icon-button toolbar-icon-button"><LayoutGrid aria-hidden="true" /></button>}
            <div ref={setInsertSlot} className="note-insert-actions" />
            {frame === 'zoom' && <button type="button" aria-label={t('editor.documentPanel')} title={t('editor.documentPanel')}
              aria-pressed={Boolean(notePanel)} onClick={() => { if (notePanel) setNotePanel(null); else if (lastNotePanel.current === 'outline') { if (isMarkdown) openOutline(); else openFind(); } else if (lastNotePanel.current === 'find') openFind(); else setNotePanel(lastNotePanel.current); }}
              className="ui-icon-button toolbar-icon-button editor-panel-action"><PanelRight aria-hidden="true" /></button>}
            {/* Close Button */}
            {onClose && <button
              aria-label={t('editor.closeNote')}
              title={t('editor.closeNote')}
              onClick={close}
              className="note-close ui-icon-button toolbar-icon-button"
            >
              <X aria-hidden="true" />
            </button>}
          </div>
        </div>

        <div className="note-editor-body">
          <MarkdownEditor ref={editorRef} content={content} path={note.path} mode={editorMode} readOnly={locked} onChange={setContent} onCaret={onCaret} insertSlot={insertSlot} ariaLabel="Note content" showLineNumbers={showLineNumbers} />
          {frame === 'zoom' ? <aside className="note-document-panel" data-open={Boolean(notePanel)} data-panel={notePanel || undefined} aria-label={t('editor.documentPanel')}>
            {panelTabs}
            {panelSections}
          </aside> : documentPanel?.target && notePanel && createPortal(<section className="note-document-panel" data-open="true" data-panel={notePanel} data-frame="rail" aria-label={t('editor.documentPanel')}>
            {panelSections}
          </section>, documentPanel.target)}
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
        </>}
      </div>
  );
});
NoteEditor.displayName = 'NoteEditor';
