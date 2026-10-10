import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Search, X } from 'lucide-react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { useTranslation } from '../lib/i18n/index.js';
import { useNoteCandidateResults } from '../lib/note-completion.js';
import { type CommandSpec, type ResolvedCommand, useCommands, useRegisterCommands } from '../lib/commands/registry.js';
import { useCompositionTracker } from '../lib/keyboard/KeyboardDispatcher.js';
import { formatKeys } from '../lib/keyboard/keys.js';
import { SHORTCUT_GROUPS } from '../lib/keyboard/keymap.js';
import { keyEnvironment } from '../lib/keyboard/platform.js';
import { ShortcutHelp } from './palette/ShortcutHelp.js';

export type ShortcutSurfaceMode = 'palette' | 'help';

interface KeyboardShortcutsProps {
  mode: ShortcutSurfaceMode | null;
  onModeChange: (mode: ShortcutSurfaceMode | null) => void;
  /** While the commit dialog is open the palette and its keys stay closed. */
  suspended?: boolean;
  selectedNotebookId: string;
  onOpenNote: (note: NoteListItem) => void | Promise<void>;
}

/** One row of the quick-open palette: either a registered command or a note search result. */
type PaletteEntry = { kind: 'command'; command: ResolvedCommand; } | { kind: 'note'; note: NoteListItem; };

const paletteEntryId = (entry: PaletteEntry) => entry.kind === 'command' ? entry.command.id : entry.note.path;
const paletteOptionId = (id: string) => `shortcut-command-${encodeURIComponent(id)}`;
const unavailable = (command: ResolvedCommand) => !command.availability.enabled;
const unavailableReason = (command: ResolvedCommand) => command.availability.enabled ? undefined : command.availability.reason;
/** Groups in help order; within a group, palette-only commands come before keyed ones. */
const paletteOrder = (command: ResolvedCommand) => SHORTCUT_GROUPS.indexOf(command.group) * 2 + (command.keys.length ? 1 : 0);

export function KeyboardShortcuts({ mode, onModeChange, suspended = false, selectedNotebookId, onOpenNote }: KeyboardShortcutsProps) {
  const { t } = useTranslation();
  const composition = useCompositionTracker();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  /* eslint-disable react/refs -- The palette synchronizes its mode and selection before immediate keyboard events can run. */
  selectedIdRef.current = selectedId;
  /* eslint-enable react/refs */
  const modeRef = useRef<ShortcutSurfaceMode | null>(null);
  /** The query a keyboard opening asks for (`>` from Cmd/Ctrl+Shift+P); the header button and Cmd/Ctrl+Shift+F leave it empty. */
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
    if (modeRef.current === 'palette') {
      setQuery(initialQuery);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    openingQuery.current = initialQuery;
    requestMode('palette');
    setQuery(initialQuery);
    selectedIdRef.current = null;
    setSelectedId(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [requestMode]);

  // The surface's own commands: the dispatcher runs them for their keys, the palette and help list them.
  const suspendedReason = t('shortcuts.requiresClosedDialog');
  const whenNotSuspended = () => suspended ? { enabled: false as const, reason: suspendedReason } : { enabled: true as const };
  const surfaceCommands: CommandSpec[] = [{ id: 'palette.notes', palette: false, availability: whenNotSuspended, run: () => openPalette() }, { id: 'palette.commands', palette: false, availability: whenNotSuspended, run: () => openPalette('>') }, { id: 'help.open', availability: whenNotSuspended, run: () => modeRef.current === 'help' ? dismiss() : requestMode('help') }];
  useRegisterCommands(surfaceCommands);
  const allCommands = useCommands();

  const palette = mode === 'palette';
  /** VS Code-style mode switch: a leading `>` or `/` reaches the command list; any other query searches notes. */
  const paletteKind: 'notes' | 'commands' = query.startsWith('>') || query.startsWith('/') ? 'commands' : 'notes';
  const commandFilterText = paletteKind === 'commands' ? query.slice(1).trim().toLocaleLowerCase() : '';
  const noteSearchText = paletteKind === 'notes' ? query : '';

  const paletteCommands = useMemo(() => allCommands.filter(command => command.palette).map((command, index) => ({ command, index })).sort((a, b) => paletteOrder(a.command) - paletteOrder(b.command) || a.index - b.index).map(({ command }) => command), [allCommands]);
  const filteredCommands = commandFilterText ? paletteCommands.filter(command => `${command.title} ${command.englishTitle} ${command.id} ${command.description ?? ''}`.toLocaleLowerCase().includes(commandFilterText)) : paletteCommands;

  // Notes are searched by title, path and notebook, matching a note the same way clicking it in the list would open it.
  const { notes: noteCandidates, loading: noteCandidatesLoading } = useNoteCandidateResults(palette && paletteKind === 'notes' ? noteSearchText : null, '');
  const sortedNoteCandidates = useMemo(() => {
    if (noteCandidates.length < 2) return noteCandidates;
    const current = noteCandidates.filter(note => note.notebookId === selectedNotebookId);
    const others = noteCandidates.filter(note => note.notebookId !== selectedNotebookId);
    return current.length && others.length ? [...current, ...others] : noteCandidates;
  }, [noteCandidates, selectedNotebookId]);

  const paletteEntries: PaletteEntry[] = paletteKind === 'commands' ? filteredCommands.map(command => ({ kind: 'command' as const, command })) : sortedNoteCandidates.map(note => ({ kind: 'note' as const, note }));
  const enabledEntries = paletteEntries.filter(entry => entry.kind !== 'command' || !unavailable(entry.command));

  const executeEntry = useCallback((entry: PaletteEntry | undefined): boolean => {
    if (!entry) return false;
    if (entry.kind === 'note') {
      dismiss(false);
      void onOpenNote(entry.note);
      return true;
    }
    const { command } = entry;
    if (unavailable(command) || !command.run) return false;
    // Help replaces the palette in the same panel; every other command closes it first.
    if (command.id !== 'help.open') dismiss(false);
    void command.run({ source: 'palette', previousFocus: previousFocus.current });
    return true;
  }, [dismiss, onOpenNote]);

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
      requestAnimationFrame(() => (panelRef.current?.querySelector<HTMLElement>('input') ?? panelRef.current)?.focus());
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
    document.getElementById(paletteOptionId(selectedId))?.scrollIntoView({ block: 'nearest' });
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

  // Keys inside the open surface; the chords that open it belong to the dispatcher.
  useEffect(() => {
    if (!mode) return;
    const keydown = (event: KeyboardEvent) => {
      // IME owns Enter, arrows and Escape while choosing or cancelling a candidate.
      if (composition.composing(event)) return;
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
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [composition, dismiss, enabledEntries, executeEntry, mode]);

  if (!mode) return null;
  const modeHintKey = paletteKind === 'commands' ? 'shortcuts.commandsModeHint' : 'shortcuts.notesModeHint';
  const searchLabelKey = paletteKind === 'commands' ? 'shortcuts.searchCommands' : 'shortcuts.searchNotes';
  const placeholderKey = paletteKind === 'commands' ? 'shortcuts.searchPlaceholder' : 'shortcuts.notesPlaceholder';
  const noResultsKey = paletteKind === 'commands' ? 'shortcuts.noResults' : noteCandidatesLoading ? 'shortcuts.loadingNotes' : 'shortcuts.noNoteResults';
  const footerKey = paletteKind === 'commands' ? 'shortcuts.paletteFooter' : 'shortcuts.paletteFooterNotes';
  /* eslint-disable react/refs -- The palette synchronizes its mode and selection before immediate keyboard events can run. */
  return (
    <div ref={panelRef} role='dialog' aria-modal='false' aria-label={t(palette ? 'shortcuts.paletteTitle' : 'shortcuts.title')} data-mode={mode} data-key-scope={mode} className='keyboard-shortcuts-panel' tabIndex={-1}>
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
      {palette
        ? (
          <>
            <div className='keyboard-shortcuts-search'>
              <Search aria-hidden='true' />
              <input ref={inputRef} type='text' role='combobox' aria-expanded='true' aria-controls='shortcut-command-list' aria-activedescendant={selectedId ? paletteOptionId(selectedId) : undefined} aria-label={t(searchLabelKey)} placeholder={t(placeholderKey)} value={query} onChange={event => setQuery(event.target.value)} autoComplete='off' />
            </div>
            <div id='shortcut-command-list' className='keyboard-shortcuts-list' role='listbox'>
              {paletteEntries.map(entry => {
                const id = paletteEntryId(entry);
                const command = entry.kind === 'command' ? entry.command : null;
                const disabled = command ? unavailable(command) : false;
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
                    {command
                      ? (
                        <span className='keyboard-shortcuts-command'>
                          <span className='keyboard-shortcuts-command-title'>
                            <span>{command.title}</span>
                            <code>{command.id}</code>
                          </span>
                          {command.description && <small className='keyboard-shortcuts-description'>{command.description}</small>}
                        </span>
                      )
                      : <span>{entry.kind === 'note' && (entry.note.title || entry.note.path)}</span>}
                    {command ? (disabled ? <small>{unavailableReason(command)}</small> : command.keys[0] && <kbd>{formatKeys(command.keys[0], keyEnvironment).join(' ')}</kbd>) : entry.kind === 'note' && <small>{entry.note.path}</small>}
                  </button>
                );
              })}
              {paletteEntries.length === 0 && <p className='keyboard-shortcuts-empty' role='status'>{t(noResultsKey)}</p>}
            </div>
          </>
        )
        : <ShortcutHelp commands={allCommands} />}
      <p className='keyboard-shortcuts-footer'>{t(palette ? footerKey : 'shortcuts.escape')}</p>
    </div>
  );
  /* eslint-enable react/refs */
}
