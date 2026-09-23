import { useEffect, useMemo, useRef, useState } from 'react';
import YAML from 'yaml';
import { chooseOutlineHeading, findOutlineIndexForLine, findTextMatches, isEditableTarget, parseMarkdownOutline } from '../../lib/note-navigation.js';
import type { MarkdownEditorHandle, MarkdownEditorMode } from '../MarkdownEditor.js';
import type { NotePanelMode } from '../NoteEditor.js';

export interface UseNoteDocumentPanelParams {
  frame: 'zoom' | 'pane' | 'compact';
  active: boolean;
  isMarkdown: boolean;
  content: string;
  editorMode: MarkdownEditorMode;
  documentPanel?: { target: HTMLElement | null; mode: NotePanelMode | null; onChange: (mode: NotePanelMode | null) => void; };
  /** Owned by the host `NoteEditor`, which renders the `MarkdownEditor` this ref points to. */
  editorRef: React.RefObject<MarkdownEditorHandle>;
  metadata: Record<string, unknown>;
  notePath: string;
  branch: string;
  draftScope?: string;
  readOnly: boolean;
}

/** The document panel's visibility, find/outline navigation, its frontmatter form/tag state, and its keyboard leader menu. */
export function useNoteDocumentPanel({ frame, active, isMarkdown, content, editorMode, documentPanel, editorRef, metadata, notePath, branch, draftScope, readOnly }: UseNoteDocumentPanelParams) {
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
      try {
        localStorage.setItem('mygitnotes.documentPanel', next);
      } catch { /* The in-memory preference remains available. */ }
    }
    if (frame === 'pane') documentPanel?.onChange(next);
    else updateNotePanel(next);
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

  // Frontmatter form state, kept here rather than in NoteFrontmatterPanel so it survives
  // switching to another document-panel tab and back.
  const [newFieldKey, setNewFieldKey] = useState('');
  const [frontmatterViewMode, setFrontmatterViewMode] = useState<'form' | 'yaml'>('form');
  const [yamlText, setYamlText] = useState(() => YAML.stringify(metadata || {}));
  const [yamlError, setYamlError] = useState('');

  // Tag autocomplete state
  const [tagInput, setTagInput] = useState('');
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);
  const matches = useMemo(() => findTextMatches(content, findQuery), [content, findQuery]);
  const outline = useMemo(() => parseMarkdownOutline(content), [content]);

  const [previousFindQuery, setPreviousFindQuery] = useState(findQuery);
  if (previousFindQuery !== findQuery) {
    setPreviousFindQuery(findQuery);
    setFindIndex(0);
  }
  if (isFindOpen && matches.length > 0 && findIndex >= matches.length) setFindIndex(matches.length - 1);
  if (isOutlineOpen && outline.length > 0 && outlineIndex >= outline.length) setOutlineIndex(outline.length - 1);
  useEffect(() => {
    if (!isFindOpen || matches.length === 0) return;
    const index = Math.min(findIndex, matches.length - 1);
    editorRef.current?.revealRange(matches[index].from, matches[index].to);
  }, [editorMode, editorRef, findIndex, isFindOpen, matches]);

  const openFind = () => {
    setIsEditorLeaderOpen(false);
    setNotePanel('find');
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  };
  const stepFind = (delta: number) => {
    if (matches.length === 0) return;
    setFindIndex(index => (index + delta + matches.length) % matches.length);
  };

  const escapeAction = useRef<() => boolean>(() => false);
  /* eslint-disable react/refs -- The editor keeps current draft and event callbacks in refs for async saves and imperative keyboard handlers. */
  escapeAction.current = () => {
    if (isEditorLeaderOpen) setIsEditorLeaderOpen(false);
    else if (notePanel) setNotePanel(null);
    else return false;
    return true;
  };
  /* eslint-enable react/refs */
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
  /* eslint-disable react/refs -- The editor keeps current draft and event callbacks in refs for async saves and imperative keyboard handlers. */
  shortcutAction.current = event => {
    const slashKey = event.code === 'Slash' || event.key === '/';
    const primary = /Mac|iPhone|iPad/.test(navigator.platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    // Cmd/Ctrl+Shift+E opens the note commands leader in zoom only.
    if ((event.code === 'KeyE' || event.key.toLowerCase() === 'e') && primary && event.shiftKey && !event.altKey) {
      if (frame !== 'zoom') return false;
      setIsEditorLeaderOpen(open => !open);
      return true;
    }
    if (isEditorLeaderOpen && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key.toLowerCase() === 'f') {
        openFind();
        return true;
      }
      if (slashKey) {
        openOutline();
        return true;
      }
    }
    if (isOutlineOpen && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (isEditableTarget(event.target) || (event.target instanceof Element && event.target.closest('[role="tablist"]'))) return false;
      if (event.key.toLowerCase() === 'j' || event.key === 'ArrowDown') {
        moveOutline(1);
        return true;
      }
      if (event.key.toLowerCase() === 'k' || event.key === 'ArrowUp') {
        moveOutline(-1);
        return true;
      }
      if (event.key === 'Enter') {
        chooseOutline(outlineIndex, false);
        return true;
      }
    }
    return false;
  };
  /* eslint-enable react/refs */
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open], [role="listbox"]')) return;
      if (shortcutAction.current(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === 'Escape' && !document.querySelector('dialog[open], [aria-label="Asset preview"]')) {
        if (escapeAction.current()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [active]);

  const [panelIdentity, setPanelIdentity] = useState({ notePath, branch, draftScope, readOnly });
  if (panelIdentity.notePath !== notePath || panelIdentity.branch !== branch || panelIdentity.draftScope !== draftScope || panelIdentity.readOnly !== readOnly) {
    setPanelIdentity({ notePath, branch, draftScope, readOnly });
    setFindQuery('');
    setFindIndex(0);
    setOutlineIndex(0);
    setIsEditorLeaderOpen(false);
    setTagInput('');
    setIsTagDropdownOpen(false);
  }

  useEffect(() => {
    if (!isOutlineOpen || outline.length === 0) return;
    const index = Math.min(outlineIndex, outline.length - 1);
    if (isEditableTarget(document.activeElement)) return;
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-outline-index="${index}"]`)?.focus());
  }, [isOutlineOpen, outline, outlineIndex]);

  return { editorRef, notePanel, setNotePanel, lastNotePanel, isAssetPickerOpen, isFindOpen, isOutlineOpen, showFrontmatter, isGitPanelOpen, findQuery, setFindQuery, findIndex, matches, stepFind, findInputRef, outline, outlineIndex, setOutlineIndex, chooseOutline, moveOutline, openFind, openOutline, isEditorLeaderOpen, setIsEditorLeaderOpen, newFieldKey, setNewFieldKey, frontmatterViewMode, setFrontmatterViewMode, yamlText, setYamlText, yamlError, setYamlError, tagInput, setTagInput, isTagDropdownOpen, setIsTagDropdownOpen };
}
