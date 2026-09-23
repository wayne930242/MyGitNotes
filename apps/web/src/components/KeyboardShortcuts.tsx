import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Search, X } from 'lucide-react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { WorkspaceTab } from '../lib/routes.js';
import { useTranslation } from '../lib/i18n/index.js';
import { isEditableTarget } from '../lib/note-navigation.js';
import { useNoteCandidateResults } from '../lib/note-completion.js';

export type ShortcutSurfaceMode = 'palette' | 'help';

/** A palette-only command supplied by the page that owns it; it has no direct key. */
export interface PaletteCommand {
  id: string;
  label: string;
  disabled: boolean;
  unavailableReason?: string;
  run: () => void;
}

interface KeyboardShortcutsProps {
  mode: ShortcutSurfaceMode | null;
  onModeChange: (mode: ShortcutSurfaceMode | null) => void;
  suspended?: boolean;
  /** The note editor owns Alt+/ and the page stays put, so only Cmd/Ctrl+Shift+P reaches the palette and notes. */
  noteEditorOpen?: boolean;
  activeTab: WorkspaceTab;
  canCreateNote: boolean;
  selectedNotebookId: string;
  onNavigate: (tab: WorkspaceTab) => void | Promise<void>;
  onCreateNote: () => void;
  onFocusSearch: () => void;
  onOpenNote: (note: NoteListItem) => void | Promise<void>;
  pageCommands?: readonly PaletteCommand[];
}

interface ShortcutCommand {
  id: string;
  accelerator?: string;
  paletteVisible?: boolean;
  label: string;
  disabled: boolean;
  unavailableReason?: string;
  run: () => void;
}

/** One row of the quick-open palette: either an existing command or a note search result. */
type PaletteEntry = { kind: 'command'; command: ShortcutCommand; } | { kind: 'note'; note: NoteListItem; };

const paletteEntryId = (entry: PaletteEntry) => entry.kind === 'command' ? entry.command.id : entry.note.path;
const paletteOptionId = (id: string) => `shortcut-command-${encodeURIComponent(id)}`;
const isComposingKey = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229;

export function KeyboardShortcuts({ mode, onModeChange, suspended = false, noteEditorOpen = false, activeTab, canCreateNote, selectedNotebookId, onNavigate, onCreateNote, onFocusSearch, onOpenNote, pageCommands = [] }: KeyboardShortcutsProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  /* eslint-disable react/refs -- The palette synchronizes its mode and selection before immediate keyboard events can run. */
  selectedIdRef.current = selectedId;
  /* eslint-enable react/refs */
  const modeRef = useRef<ShortcutSurfaceMode | null>(null);
  /** The query a keyboard opening asks for (`>` from Cmd/Ctrl+Shift+P); the header button and Alt+/ leave it empty. */
  const openingQuery = useRef('');
  /* eslint-disable react/refs -- The palette synchronizes its mode and selection before immediate keyboard events can run. */
  modeRef.current = mode;
  /* eslint-enable react/refs */
  const syncedMode = useRef<ShortcutSurfaceMode | null>(null);
  /** Resets query/selection synchronously during render, not in the `[mode]` effect below - that
   *  effect only fires after the palette's first commit, so any external caller (e.g. a header
   *  button click) that starts typing right after the panel appears can race ahead of the reset. */
  /* eslint-disable react/refs -- The palette synchronizes its mode and selection before immediate keyboard events can run. */
  if (syncedMode.current !== mode) {
    syncedMode.current = mode;
    if (mode === 'palette') {
      setQuery(openingQuery.current);
      selectedIdRef.current = null;
      setSelectedId(null);
    }
  }
  /* eslint-enable react/refs */
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(true);
  const previousMode = useRef<ShortcutSurfaceMode | null>(null);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const paletteShortcut = isMac ? '⌥+/' : 'Alt+/';
  const commandPaletteShortcut = isMac ? '⌘+⇧+P' : 'Ctrl+Shift+P';
  const helpShortcut = isMac ? '⌘+/' : 'Ctrl+/';

  /** Updates `modeRef` in lockstep with the request, so a keydown listener whose closure hasn't
   *  been re-registered yet still sees the mode we just asked for, not a stale render's value. */
  const requestMode = useCallback((next: ShortcutSurfaceMode | null) => {
    modeRef.current = next;
    onModeChange(next);
  }, [onModeChange]);

  const dismiss = useCallback((restore = true) => {
    restoreFocus.current = restore;
    requestMode(null);
  }, [requestMode]);

  /** Opens the palette and resets its query/selection/focus immediately, instead of waiting on
   *  the `[mode]` effect below - which a same-batch close+reopen can cause React to skip. */
  const openPalette = useCallback((initialQuery = '') => {
    openingQuery.current = initialQuery;
    requestMode('palette');
    setQuery(initialQuery);
    selectedIdRef.current = null;
    setSelectedId(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [requestMode]);

  const commands = useMemo<ShortcutCommand[]>(() => [...[{ id: 'notes', label: t('nav.notes'), disabled: false, run: () => onNavigate('notes') }, { id: 'agent', label: t('nav.agent'), disabled: false, run: () => onNavigate('agent') }, { id: 'assets', label: t('nav.assets'), disabled: false, run: () => onNavigate('assets') }, { id: 'screen', label: t('nav.screen'), disabled: false, run: () => onNavigate('screen') }, { id: 'new-note', label: t('header.newNote'), disabled: !canCreateNote, unavailableReason: t('shortcuts.requiresWriteAccess'), run: onCreateNote }, { id: 'search', label: t('shortcuts.search'), disabled: activeTab !== 'notes', unavailableReason: t('shortcuts.requiresNotes'), run: onFocusSearch }, { id: 'settings', label: t('nav.settings'), disabled: false, run: () => onNavigate('settings') }, { id: 'toggle-screen-sidebar', accelerator: '[', label: t('shortcuts.toggleScreenSidebar'), disabled: activeTab !== 'screen', unavailableReason: t('shortcuts.requiresScreen'), run: () => window.dispatchEvent(new CustomEvent('toggle-screen-sidebar')) }, ...pageCommands].map(command => noteEditorOpen && !command.disabled ? { ...command, disabled: true, unavailableReason: t('shortcuts.requiresClosedNote') } : command), { id: 'help', accelerator: helpShortcut, label: t('shortcuts.help'), disabled: false, run: () => requestMode('help') }, { id: 'open-palette', accelerator: paletteShortcut, paletteVisible: false, label: t('shortcuts.open'), disabled: false, run: () => openPalette() }, { id: 'open-command-palette', accelerator: commandPaletteShortcut, paletteVisible: false, label: t('shortcuts.openCommands'), disabled: false, run: () => openPalette('>') }], [activeTab, canCreateNote, commandPaletteShortcut, helpShortcut, noteEditorOpen, onCreateNote, onFocusSearch, onNavigate, openPalette, pageCommands, paletteShortcut, requestMode, t]);

  const palette = mode === 'palette';
  /** VS Code-style mode switch: a leading `>` or `/` reaches the unchanged command list; any other query searches notes. */
  const paletteKind: 'notes' | 'commands' = query.startsWith('>') || query.startsWith('/') ? 'commands' : 'notes';
  const commandFilterText = paletteKind === 'commands' ? query.slice(1).trim().toLocaleLowerCase() : '';
  const noteSearchText = paletteKind === 'notes' ? query : '';

  /* eslint-disable react/refs -- The palette synchronizes its mode and selection before immediate keyboard events can run. */
  const paletteCommands = useMemo(() => commands.filter(command => command.paletteVisible !== false), [commands]);
  const filteredCommands = useMemo(() => commandFilterText ? paletteCommands.filter(command => `${command.label} ${command.id}`.toLocaleLowerCase().includes(commandFilterText)) : paletteCommands, [commandFilterText, paletteCommands]);
  /* eslint-enable react/refs */

  // Notes are searched by title, path and notebook, matching a note the same way clicking it in the list would open it.
  const { notes: noteCandidates, loading: noteCandidatesLoading } = useNoteCandidateResults(palette && paletteKind === 'notes' ? noteSearchText : null, '');
  const sortedNoteCandidates = useMemo(() => {
    if (noteCandidates.length < 2) return noteCandidates;
    const current = noteCandidates.filter(note => note.notebookId === selectedNotebookId);
    const others = noteCandidates.filter(note => note.notebookId !== selectedNotebookId);
    return current.length && others.length ? [...current, ...others] : noteCandidates;
  }, [noteCandidates, selectedNotebookId]);

  const paletteEntries = useMemo<PaletteEntry[]>(() => paletteKind === 'commands' ? filteredCommands.map(command => ({ kind: 'command' as const, command })) : sortedNoteCandidates.map(note => ({ kind: 'note' as const, note })), [paletteKind, filteredCommands, sortedNoteCandidates]);
  /* eslint-disable react/refs -- The palette synchronizes its mode and selection before immediate keyboard events can run. */
  const enabledEntries = useMemo(() => paletteEntries.filter(entry => entry.kind !== 'command' || !entry.command.disabled), [paletteEntries]);
  /* eslint-enable react/refs */

  const executeCommand = useCallback((command: ShortcutCommand | undefined) => {
    if (!command || command.disabled) return false;
    if (command.id === 'help') command.run();
    else {
      dismiss(false);
      command.run();
    }
    return true;
  }, [dismiss]);

  const executeEntry = useCallback((entry: PaletteEntry | undefined): boolean => {
    if (!entry) return false;
    if (entry.kind === 'command') return executeCommand(entry.command);
    dismiss(false);
    void onOpenNote(entry.note);
    return true;
  }, [executeCommand, dismiss, onOpenNote]);

  useEffect(() => {
    const priorMode = previousMode.current;
    if (mode && !priorMode) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      restoreFocus.current = true;
    }
    if (mode === 'palette' && priorMode !== 'palette') {
      setQuery(openingQuery.current);
      openingQuery.current = '';
      selectedIdRef.current = null;
      setSelectedId(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (mode === 'help' && priorMode !== 'help') {
      requestAnimationFrame(() => panelRef.current?.focus());
    } else if (!mode && priorMode && restoreFocus.current) {
      previousFocus.current?.focus();
    }
    previousMode.current = mode;
  }, [mode]);

  if (mode === 'palette' && !enabledEntries.some(entry => paletteEntryId(entry) === selectedId)) {
    const next = enabledEntries[0] ? paletteEntryId(enabledEntries[0]) : null;
    if (next !== selectedId) setSelectedId(next);
  }

  useEffect(() => {
    if (!selectedId || mode !== 'palette') return;
    document.getElementById(`shortcut-command-${selectedId}`)?.scrollIntoView({ block: 'nearest' });
  }, [mode, selectedId]);

  useEffect(() => {
    if (!mode) return;
    const pointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) dismiss();
    };
    document.addEventListener('pointerdown', pointerDown);
    return () => document.removeEventListener('pointerdown', pointerDown);
  }, [dismiss, mode]);

  useEffect(() => {
    if (suspended && mode) dismiss(false);
  }, [dismiss, mode, suspended]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (suspended) return;
      const slashKey = event.code === 'Slash' || event.key === '/';
      const primary = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if ((event.code === 'KeyP' || event.key.toLowerCase() === 'p') && primary && event.shiftKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        if (modeRef.current === 'palette') {
          setQuery('>');
          requestAnimationFrame(() => inputRef.current?.focus());
        } else openPalette('>');
        return;
      }
      if (noteEditorOpen && !mode) return;
      if (slashKey && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        if (modeRef.current === 'palette') dismiss();
        else openPalette();
        return;
      }
      if (slashKey && primary && !event.altKey && !event.shiftKey && !isEditableTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        if (modeRef.current === 'help') dismiss();
        else requestMode('help');
        return;
      }
      if (!mode) return;
      // IME owns Enter, arrows and Escape while choosing or cancelling a candidate.
      if (mode === 'palette' && isComposingKey(event)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
        return;
      }
      if (mode !== 'palette') return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        if (enabledEntries.length === 0) return;
        const currentIndex = enabledEntries.findIndex(entry => paletteEntryId(entry) === selectedIdRef.current);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = currentIndex < 0 ? (delta > 0 ? 0 : enabledEntries.length - 1) : (currentIndex + delta + enabledEntries.length) % enabledEntries.length;
        selectedIdRef.current = paletteEntryId(enabledEntries[nextIndex]);
        setSelectedId(paletteEntryId(enabledEntries[nextIndex]));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        executeEntry(enabledEntries.find(entry => paletteEntryId(entry) === selectedIdRef.current) || enabledEntries[0]);
        return;
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [dismiss, enabledEntries, executeEntry, isMac, mode, noteEditorOpen, openPalette, requestMode, suspended]);

  if (!mode) return null;
  const modeHintKey = paletteKind === 'commands' ? 'shortcuts.commandsModeHint' : 'shortcuts.notesModeHint';
  const searchLabelKey = paletteKind === 'commands' ? 'shortcuts.searchCommands' : 'shortcuts.searchNotes';
  const placeholderKey = paletteKind === 'commands' ? 'shortcuts.searchPlaceholder' : 'shortcuts.notesPlaceholder';
  const noResultsKey = paletteKind === 'commands' ? 'shortcuts.noResults' : noteCandidatesLoading ? 'shortcuts.loadingNotes' : 'shortcuts.noNoteResults';
  const footerKey = paletteKind === 'commands' ? 'shortcuts.paletteFooter' : 'shortcuts.paletteFooterNotes';
  /* eslint-disable react/refs -- The palette synchronizes its mode and selection before immediate keyboard events can run. */
  return (
    <div ref={panelRef} role='dialog' aria-modal='false' aria-label={t(palette ? 'shortcuts.paletteTitle' : 'shortcuts.title')} data-mode={mode} className='keyboard-shortcuts-panel' tabIndex={-1}>
      <div className='keyboard-shortcuts-heading'>
        <div>
          <Keyboard aria-hidden='true' />
          <div>
            <h2>{t(palette ? 'shortcuts.paletteTitle' : 'shortcuts.title')}</h2>
            <p>{palette ? t(modeHintKey) : t('shortcuts.escape')}</p>
          </div>
        </div>
        <button type='button' className='ui-icon-button' aria-label={t('common.close')} onClick={() => dismiss()}>
          <X size={16} />
        </button>
      </div>
      {palette && (
        <div className='keyboard-shortcuts-search'>
          <Search aria-hidden='true' />
          <input ref={inputRef} type='text' role='combobox' aria-expanded='true' aria-controls='shortcut-command-list' aria-activedescendant={selectedId ? paletteOptionId(selectedId) : undefined} aria-label={t(searchLabelKey)} placeholder={t(placeholderKey)} value={query} onChange={event => setQuery(event.target.value)} autoComplete='off' />
        </div>
      )}
      <div id='shortcut-command-list' className='keyboard-shortcuts-list' role={palette ? 'listbox' : 'list'}>
        {palette
          ? paletteEntries.map(entry => {
            const id = paletteEntryId(entry);
            const disabled = entry.kind === 'command' && entry.command.disabled;
            const label = entry.kind === 'command' ? entry.command.label : (entry.note.title || entry.note.path);
            return (
              <button
                type='button'
                key={id}
                id={paletteOptionId(id)}
                data-command-id={id}
                className={id === selectedId ? 'is-active' : ''}
                role='option'
                aria-selected={id === selectedId}
                disabled={disabled}
                aria-disabled={disabled}
                onMouseEnter={() => {
                  if (!disabled) {
                    selectedIdRef.current = id;
                    setSelectedId(id);
                  }
                }}
                onClick={() => executeEntry(entry)}
              >
                <span>{label}</span>
                {entry.kind === 'command' ? (disabled && <small>{entry.command.unavailableReason}</small>) : <small>{entry.note.path}</small>}
              </button>
            );
          })
          : commands.filter(command => command.accelerator).map(command => (
            <button type='button' key={command.id} id={`shortcut-command-${command.id}`} data-command-id={command.id} data-shortcut-key={command.accelerator} role='listitem' disabled={command.disabled} aria-disabled={command.disabled} onClick={() => executeCommand(command)}>
              <kbd>{command.accelerator}</kbd>
              <span>{command.label}</span>
              {command.disabled && <small>{command.unavailableReason}</small>}
            </button>
          ))}
        {palette && paletteEntries.length === 0 && <p className='keyboard-shortcuts-empty' role='status'>{t(noResultsKey)}</p>}
      </div>
      <p className='keyboard-shortcuts-footer'>{t(palette ? footerKey : 'shortcuts.escape')}</p>
    </div>
  );
  /* eslint-enable react/refs */
}
