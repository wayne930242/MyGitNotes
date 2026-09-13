import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, X } from 'lucide-react';
import type { WorkspaceTab } from '../lib/routes.js';
import { useTranslation } from '../lib/i18n/index.js';

type ShortcutMode = 'leader' | 'help';

interface KeyboardShortcutsProps {
  activeTab: WorkspaceTab;
  canCreateNote: boolean;
  onNavigate: (tab: WorkspaceTab) => void | Promise<void>;
  onCreateNote: () => void;
  onFocusSearch: () => void;
}

export function KeyboardShortcuts({ activeTab, canCreateNote, onNavigate, onCreateNote, onFocusSearch }: KeyboardShortcutsProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ShortcutMode | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(true);
  const wasOpen = useRef(false);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  const dismiss = useCallback((restore = true) => {
    restoreFocus.current = restore;
    setMode(null);
  }, []);

  const commands = useMemo(() => [
    { id: 'notes', key: '1', displayKey: '1', label: t('nav.notes'), disabled: false, run: () => onNavigate('notes') },
    { id: 'agent', key: '2', displayKey: '2', label: t('nav.agent'), disabled: false, run: () => onNavigate('agent') },
    { id: 'assets', key: '3', displayKey: '3', label: t('nav.assets'), disabled: false, run: () => onNavigate('assets') },
    { id: 'screen', key: '4', displayKey: '4', label: t('nav.screen'), disabled: false, run: () => onNavigate('screen') },
    { id: 'new-note', key: 'n', displayKey: 'N', label: t('header.newNote'), disabled: !canCreateNote, run: onCreateNote },
    { id: 'search', key: '/', displayKey: '/', label: t('shortcuts.search'), disabled: activeTab !== 'notes', run: onFocusSearch },
    { id: 'settings', key: ',', dataKey: 'comma', displayKey: ',', label: t('nav.settings'), disabled: false, run: () => onNavigate('settings') },
    { id: 'help', key: '?', displayKey: '?', label: t('shortcuts.help'), disabled: false, run: () => setMode('help') },
  ], [activeTab, canCreateNote, onCreateNote, onFocusSearch, onNavigate, t]);

  const runCommand = useCallback((key: string) => {
    const command = commands.find(item => item.key === key);
    if (!command || command.disabled) return false;
    if (command.id === 'help') command.run();
    else { dismiss(false); command.run(); }
    return true;
  }, [commands, dismiss]);

  useEffect(() => {
    if (mode && !wasOpen.current) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      restoreFocus.current = true;
      requestAnimationFrame(() => panelRef.current?.focus());
    } else if (!mode && wasOpen.current && restoreFocus.current) {
      previousFocus.current?.focus();
    }
    wasOpen.current = Boolean(mode);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'leader') return;
    const timer = window.setTimeout(() => dismiss(), 2500);
    return () => window.clearTimeout(timer);
  }, [dismiss, mode]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const primary = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (event.key.toLowerCase() === 'k' && primary) {
        if (!event.altKey || event.shiftKey) return;
        event.preventDefault(); event.stopPropagation();
        if (mode) dismiss(); else setMode('leader');
        return;
      }
      if (!mode) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); dismiss(); return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const command = commands.find(item => item.key === key);
      if (!command) return;
      event.preventDefault(); event.stopPropagation();
      runCommand(key);
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [commands, dismiss, isMac, mode, runCommand]);

  if (!mode) return null;
  return <div ref={panelRef} role="dialog" aria-modal="false" aria-label={t('shortcuts.title')} data-mode={mode}
    className="keyboard-shortcuts-panel" tabIndex={-1}>
    <div className="keyboard-shortcuts-heading">
      <div><Keyboard aria-hidden="true" /><div><h2>{t(mode === 'help' ? 'shortcuts.title' : 'shortcuts.pending')}</h2><p>{t('shortcuts.chord', { modifier: isMac ? '⌘+⌥' : 'Ctrl+Alt' })}</p></div></div>
      <button type="button" className="ui-icon-button" aria-label={t('common.close')} onClick={() => dismiss()}><X size={16} /></button>
    </div>
    <div className="keyboard-shortcuts-list">
      {commands.map(command => <button type="button" key={command.id} data-shortcut-key={command.dataKey || command.displayKey}
        disabled={command.disabled} aria-disabled={command.disabled} onClick={() => runCommand(command.key)}>
        <kbd>{command.displayKey}</kbd><span>{command.label}</span>{command.disabled && <small>{t('shortcuts.unavailable')}</small>}
      </button>)}
    </div>
    <p className="keyboard-shortcuts-footer">{t(mode === 'help' ? 'shortcuts.escape' : 'shortcuts.timeout')}</p>
  </div>;
}
