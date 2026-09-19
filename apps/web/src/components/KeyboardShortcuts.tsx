import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Search, X } from 'lucide-react';
import type { WorkspaceTab } from '../lib/routes.js';
import { useTranslation } from '../lib/i18n/index.js';
import { isEditableTarget } from '../lib/note-navigation.js';

export type ShortcutSurfaceMode = 'palette' | 'help';

/** A palette-only command supplied by the page that owns it; it has no direct key. */
export interface PaletteCommand {
  id: string;
  label: string;
  disabled: boolean;
  run: () => void;
}

interface KeyboardShortcutsProps {
  mode: ShortcutSurfaceMode | null;
  onModeChange: (mode: ShortcutSurfaceMode | null) => void;
  suspended?: boolean;
  activeTab: WorkspaceTab;
  canCreateNote: boolean;
  onNavigate: (tab: WorkspaceTab) => void | Promise<void>;
  onCreateNote: () => void;
  onFocusSearch: () => void;
  pageCommands?: readonly PaletteCommand[];
}

interface ShortcutCommand {
  id: string;
  accelerator?: string;
  dataKey?: string;
  label: string;
  disabled: boolean;
  run: () => void;
}

export function KeyboardShortcuts({ mode, onModeChange, suspended = false, activeTab, canCreateNote, onNavigate, onCreateNote, onFocusSearch, pageCommands = [] }: KeyboardShortcutsProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  /* eslint-disable react/refs -- The palette synchronizes its mode and selection before immediate keyboard events can run. */
  selectedIdRef.current = selectedId;
  /* eslint-enable react/refs */
  const modeRef = useRef<ShortcutSurfaceMode | null>(null);
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
      setQuery('');
      selectedIdRef.current = 'notes';
      setSelectedId('notes');
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
  const openPalette = useCallback(() => {
    requestMode('palette');
    setQuery('');
    selectedIdRef.current = 'notes';
    setSelectedId('notes');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [requestMode]);

  const commands = useMemo<ShortcutCommand[]>(() => [{ id: 'notes', accelerator: '1', label: t('nav.notes'), disabled: false, run: () => onNavigate('notes') }, { id: 'agent', accelerator: '2', label: t('nav.agent'), disabled: false, run: () => onNavigate('agent') }, { id: 'assets', accelerator: '3', label: t('nav.assets'), disabled: false, run: () => onNavigate('assets') }, { id: 'screen', accelerator: '4', label: t('nav.screen'), disabled: false, run: () => onNavigate('screen') }, { id: 'new-note', accelerator: 'N', label: t('header.newNote'), disabled: !canCreateNote, run: onCreateNote }, { id: 'search', accelerator: '/', label: t('shortcuts.search'), disabled: activeTab !== 'notes', run: onFocusSearch }, { id: 'settings', accelerator: ',', dataKey: 'comma', label: t('nav.settings'), disabled: false, run: () => onNavigate('settings') }, { id: 'toggle-screen-sidebar', accelerator: '[', label: t('shortcuts.toggleScreenSidebar'), disabled: activeTab !== 'screen', run: () => window.dispatchEvent(new CustomEvent('toggle-screen-sidebar')) }, { id: 'help', accelerator: '?', label: t('shortcuts.help'), disabled: false, run: () => requestMode('help') }, ...pageCommands], [activeTab, canCreateNote, onCreateNote, onFocusSearch, onNavigate, pageCommands, requestMode, t]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  /* eslint-disable react/refs -- The palette synchronizes its mode and selection before immediate keyboard events can run. */
  const visibleCommands = useMemo(() => normalizedQuery ? commands.filter(command => `${command.label} ${command.id}`.toLocaleLowerCase().includes(normalizedQuery)) : commands, [commands, normalizedQuery]);
  /* eslint-enable react/refs */
  /* eslint-disable react/refs -- The palette synchronizes its mode and selection before immediate keyboard events can run. */
  const enabledCommands = useMemo(() => visibleCommands.filter(command => !command.disabled), [visibleCommands]);
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

  useEffect(() => {
    const priorMode = previousMode.current;
    if (mode && !priorMode) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      restoreFocus.current = true;
    }
    if (mode === 'palette' && priorMode !== 'palette') {
      setQuery('');
      selectedIdRef.current = 'notes';
      setSelectedId('notes');
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (mode === 'help' && priorMode !== 'help') {
      requestAnimationFrame(() => panelRef.current?.focus());
    } else if (!mode && priorMode && restoreFocus.current) {
      previousFocus.current?.focus();
    }
    previousMode.current = mode;
  }, [mode]);

  useEffect(() => {
    if (mode !== 'palette') return;
    if (!enabledCommands.some(command => command.id === selectedId)) {
      const next = enabledCommands[0]?.id || null;
      selectedIdRef.current = next;
      /* eslint-disable react/set-state-in-effect -- Refresh the selected command when filtering changes the enabled command list. */
      setSelectedId(next);
      /* eslint-enable react/set-state-in-effect */
    }
  }, [enabledCommands, mode, selectedId]);

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
        if (enabledCommands.length === 0) return;
        const currentIndex = enabledCommands.findIndex(command => command.id === selectedIdRef.current);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = currentIndex < 0 ? (delta > 0 ? 0 : enabledCommands.length - 1) : (currentIndex + delta + enabledCommands.length) % enabledCommands.length;
        selectedIdRef.current = enabledCommands[nextIndex].id;
        setSelectedId(enabledCommands[nextIndex].id);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        executeCommand(enabledCommands.find(command => command.id === selectedIdRef.current) || enabledCommands[0]);
        return;
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [dismiss, enabledCommands, executeCommand, isMac, mode, openPalette, requestMode, suspended]);

  if (!mode) return null;
  const palette = mode === 'palette';
  /* eslint-disable react/refs -- The palette synchronizes its mode and selection before immediate keyboard events can run. */
  const listedCommands = palette ? visibleCommands : commands.filter(command => command.accelerator);
  /* eslint-enable react/refs */
  /* eslint-disable react/refs -- The palette synchronizes its mode and selection before immediate keyboard events can run. */
  return (
    <div ref={panelRef} role='dialog' aria-modal='false' aria-label={t(palette ? 'shortcuts.paletteTitle' : 'shortcuts.title')} data-mode={mode} className='keyboard-shortcuts-panel' tabIndex={-1}>
      <div className='keyboard-shortcuts-heading'>
        <div>
          <Keyboard aria-hidden='true' />
          <div>
            <h2>{t(palette ? 'shortcuts.paletteTitle' : 'shortcuts.title')}</h2>
            <p>{palette ? t('shortcuts.openHint', { shortcut: paletteShortcut }) : t('shortcuts.escape')}</p>
          </div>
        </div>
        <button type='button' className='ui-icon-button' aria-label={t('common.close')} onClick={() => dismiss()}>
          <X size={16} />
        </button>
      </div>
      {palette && (
        <div className='keyboard-shortcuts-search'>
          <Search aria-hidden='true' />
          <input ref={inputRef} type='text' role='combobox' aria-expanded='true' aria-controls='shortcut-command-list' aria-activedescendant={selectedId ? `shortcut-command-${selectedId}` : undefined} aria-label={t('shortcuts.searchCommands')} placeholder={t('shortcuts.searchPlaceholder')} value={query} onChange={event => setQuery(event.target.value)} autoComplete='off' />
        </div>
      )}
      <div id='shortcut-command-list' className='keyboard-shortcuts-list' role={palette ? 'listbox' : 'list'}>
        {listedCommands.map(command => (
          <button
            type='button'
            key={command.id}
            id={`shortcut-command-${command.id}`}
            data-command-id={command.id}
            data-shortcut-key={command.dataKey || command.accelerator}
            className={palette && command.id === selectedId ? 'is-active' : ''}
            role={palette ? 'option' : 'listitem'}
            aria-selected={palette ? command.id === selectedId : undefined}
            disabled={command.disabled}
            aria-disabled={command.disabled}
            onMouseEnter={() => {
              if (palette && !command.disabled) {
                selectedIdRef.current = command.id;
                setSelectedId(command.id);
              }
            }}
            onClick={() => executeCommand(command)}
          >
            {command.accelerator ? <kbd>{command.accelerator}</kbd> : <i aria-hidden='true' />}
            <span>{command.label}</span>
            {command.disabled && <small>{t('shortcuts.unavailable')}</small>}
          </button>
        ))}
        {palette && listedCommands.length === 0 && <p className='keyboard-shortcuts-empty' role='status'>{t('shortcuts.noResults')}</p>}
      </div>
      <p className='keyboard-shortcuts-footer'>{t(palette ? 'shortcuts.paletteFooter' : 'shortcuts.escape')}</p>
    </div>
  );
  /* eslint-enable react/refs */
}
