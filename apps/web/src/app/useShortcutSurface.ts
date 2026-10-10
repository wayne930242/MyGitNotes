import { useState } from 'react';
import type { ShortcutSurfaceMode } from '../components/KeyboardShortcuts.js';
import { WorkspaceTab } from '../lib/routes.js';
import type { Availability, CommandSpec } from '../lib/commands/registry.js';
import { FOCUS_DIVISIONS, focusTabKey } from '@mygitnotes/core/focus-page';
import { CURRENT_FOCUS } from '../lib/focus-view.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { useFocusPanes } from './useFocusPanes.js';
import type { useFocusNoteNavigation } from './useFocusNoteNavigation.js';

interface Params {
  noteFocus: ReturnType<typeof useFocusPanes>['noteFocus'];
  focusDisplay: ReturnType<typeof useFocusPanes>['focusDisplay'];
  t: I18nContextValue['t'];
  activeTab: WorkspaceTab;
  showFocus: ReturnType<typeof useFocusPanes>['showFocus'];
  zoomFocusNote: ReturnType<typeof useFocusNoteNavigation>['zoomFocusNote'];
}

const available = (enabled: boolean, reason: string): Availability => enabled ? { enabled: true } : { enabled: false, reason };

export function useShortcutSurface({ noteFocus, focusDisplay, t, activeTab, showFocus, zoomFocusNote }: Params) {
  const [shortcutMode, setShortcutMode] = useState<ShortcutSurfaceMode | null>(null);

  // Palette commands for the displayed Focus; they act on the active pane.
  const activeFocusPane = noteFocus.entry ? focusDisplay?.panes.find(pane => pane.panes.includes(noteFocus.entry!.activePane)) : undefined;
  const cycleFocusPane = (delta: number) => {
    if (!focusDisplay || !activeFocusPane) return;
    const panes = focusDisplay.panes, target = panes[(panes.indexOf(activeFocusPane) + delta + panes.length) % panes.length];
    noteFocus.activate(target.pane);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-focus-pane="${target.pane}"] [role="tab"][aria-selected="true"]`)?.focus());
  };
  const cycleFocusTab = (delta: number) => {
    if (!noteFocus.layout || !activeFocusPane) return;
    const tabs = activeFocusPane.panes.flatMap(pane => noteFocus.layout!.panes[pane].tabs.map(tab => ({ pane, key: focusTabKey(tab) })));
    const index = tabs.findIndex(tab => tab.key === activeFocusPane.key);
    const target = tabs[(index + delta + tabs.length) % tabs.length];
    if (target) void noteFocus.show(target.pane, target.key);
  };
  const lastFocus = noteFocus.view.last && (noteFocus.view.last === CURRENT_FOCUS || noteFocus.focuses.some(item => item.id === noteFocus.view.last)) ? noteFocus.view.last : CURRENT_FOCUS;
  const zoomablePath = activeFocusPane?.key?.startsWith('note:') ? activeFocusPane.key.slice('note:'.length) : null;
  const focusCommands: CommandSpec[] = [{ id: 'focus-toggle', group: 'focus', title: t(noteFocus.shown ? 'focus.close' : 'focus.open'), description: t('shortcuts.describe.focusToggle'), availability: () => available(activeTab === 'notes', t('shortcuts.requiresNotes')), run: () => void showFocus(noteFocus.shown ? null : lastFocus) }, { id: 'focus-next-pane', group: 'focus', title: t('focus.nextPane'), description: t('shortcuts.describe.focusNextPane'), availability: () => available((focusDisplay?.panes.length ?? 0) >= 2, t('shortcuts.requiresTwoFocusPanes')), run: () => cycleFocusPane(1) }, { id: 'focus-previous-pane', group: 'focus', title: t('focus.previousPane'), description: t('shortcuts.describe.focusPreviousPane'), availability: () => available((focusDisplay?.panes.length ?? 0) >= 2, t('shortcuts.requiresTwoFocusPanes')), run: () => cycleFocusPane(-1) }, { id: 'focus-next-tab', group: 'focus', title: t('focus.nextTab'), description: t('shortcuts.describe.focusNextTab'), availability: () => available(Boolean(activeFocusPane), t('shortcuts.requiresFocusTab')), run: () => cycleFocusTab(1) }, { id: 'focus-previous-tab', group: 'focus', title: t('focus.previousTab'), description: t('shortcuts.describe.focusPreviousTab'), availability: () => available(Boolean(activeFocusPane), t('shortcuts.requiresFocusTab')), run: () => cycleFocusTab(-1) }, {
    id: 'focus-close-tab',
    group: 'focus',
    title: t('focus.closeCurrentTab'),
    description: t('shortcuts.describe.focusCloseTab'),
    availability: () => available(Boolean(noteFocus.editable && activeFocusPane?.key), t('shortcuts.requiresEditableFocusTab')),
    run: () => {
      if (activeFocusPane?.key) void noteFocus.close(activeFocusPane.key, activeFocusPane.pane).catch(() => {});
    },
  }, {
    id: 'focus-zoom-tab',
    group: 'focus',
    title: t('focus.zoomCurrentTab'),
    description: t('shortcuts.describe.focusZoomTab'),
    availability: () => available(Boolean(zoomablePath), t('shortcuts.requiresFocusNote')),
    run: () => {
      if (zoomablePath) zoomFocusNote(zoomablePath);
    },
  }, ...FOCUS_DIVISIONS.map((division): CommandSpec => ({ id: `focus-division-${division}`, group: 'focus', title: t('focus.divisionCommand', { name: t(`focus.division.${division}`) }), description: t('shortcuts.describe.focusDivision'), availability: () => available(Boolean(noteFocus.editable && noteFocus.layout && noteFocus.layout.division !== division), t('shortcuts.requiresEditableFocus')), run: () => void noteFocus.setDivision(division).catch(() => {}) }))];

  return { focusCommands, shortcutMode, setShortcutMode };
}
