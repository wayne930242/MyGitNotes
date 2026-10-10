import { useEffect, useMemo, useRef, useState } from 'react';
import YAML from 'yaml';
import { chooseOutlineHeading, findOutlineIndexForLine, findTextMatches, parseMarkdownOutline } from '../../lib/note-navigation.js';
import { isEditableTarget } from '../../lib/keyboard/context.js';
import { matchesCommand } from '../../lib/keyboard/keymap.js';
import type { MarkdownEditorHandle, MarkdownEditorMode } from '../MarkdownEditor.js';
import type { NotePanelMode } from './types.js';
import { usePiAgentAvailable } from '../../lib/pi-agent/session.js';

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

const PANEL_KEY = 'mygitnotes.documentPanel';
const PANEL_OPEN_KEY = 'mygitnotes.documentPanel.open';

/** The section the user last opened, else the default for the file. */
function savedPanel(isMarkdown: boolean): NotePanelMode {
  try {
    const saved = localStorage.getItem(PANEL_KEY);
    // The info section now sits under the frontmatter.
    if (saved === 'info') return 'frontmatter';
    if (['find', 'outline', 'frontmatter', 'view', 'history', 'agent'].includes(saved || '')) return saved as NotePanelMode;
  } catch { /* Use the default panel when storage is unavailable. */ }
  return isMarkdown ? 'outline' : 'find';
}

/** The document panel's visibility, find/outline navigation, its frontmatter form/tag state, and its keyboard leader menu. */
export function useNoteDocumentPanel({ frame, active, isMarkdown, content, editorMode, documentPanel, editorRef, metadata, notePath, branch, draftScope, readOnly }: UseNoteDocumentPanelParams) {
  const lastNotePanel = useRef<NotePanelMode>(savedPanel(isMarkdown));
  // A zoomed note reopens its panel as the user left it; a Focus pane follows the rail, which remembers its own.
  const [ownPanel, updateNotePanel] = useState<NotePanelMode | null>(() => {
    try {
      return localStorage.getItem(PANEL_OPEN_KEY) === 'true' ? savedPanel(isMarkdown) : null;
    } catch {
      return null;
    }
  });
  const requestedPanel = frame === 'pane' ? documentPanel?.mode ?? null : ownPanel;
  // A remembered agent tab opens the default section on a computer without Pi, where the tab is hidden.
  const agentAvailable = usePiAgentAvailable();
  const notePanel = requestedPanel === 'agent' && !agentAvailable ? isMarkdown ? 'outline' : 'find' : requestedPanel;
  const setNotePanel = (next: NotePanelMode | null) => {
    try {
      if (next) {
        lastNotePanel.current = next;
        localStorage.setItem(PANEL_KEY, next);
      }
      if (frame !== 'pane') localStorage.setItem(PANEL_OPEN_KEY, String(next !== null));
    } catch { /* The in-memory preference remains available. */ }
    if (frame === 'pane') documentPanel?.onChange(next);
    else updateNotePanel(next);
  };

  const isFindOpen = notePanel === 'find';
  const isOutlineOpen = notePanel === 'outline';
  const showFrontmatter = notePanel === 'frontmatter';
  const isViewPanelOpen = notePanel === 'view';
  const isHistoryOpen = notePanel === 'history';
  const isAgentOpen = notePanel === 'agent';
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
    // The leader (Mod+Shift+E in the table) opens the note commands in zoom only.
    if (matchesCommand(event, 'editor.leader')) {
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
      // Help and quick open own the keys typed in them, Escape included.
      if (event.target instanceof Element && event.target.closest('[data-key-scope="help"], [data-key-scope="palette"]')) return;
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

  return { editorRef, notePanel, setNotePanel, lastNotePanel, isFindOpen, isOutlineOpen, showFrontmatter, isViewPanelOpen, isHistoryOpen, isAgentOpen, findQuery, setFindQuery, findIndex, matches, stepFind, findInputRef, outline, outlineIndex, setOutlineIndex, chooseOutline, moveOutline, openFind, openOutline, isEditorLeaderOpen, setIsEditorLeaderOpen, newFieldKey, setNewFieldKey, frontmatterViewMode, setFrontmatterViewMode, yamlText, setYamlText, yamlError, setYamlError, tagInput, setTagInput, isTagDropdownOpen, setIsTagDropdownOpen };
}

/** The document panel state the editor parts that render it share. */
export type NoteDocumentPanelState = ReturnType<typeof useNoteDocumentPanel>;
