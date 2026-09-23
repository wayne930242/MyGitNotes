import { useState } from 'react';
import type { ShortcutSurfaceMode } from '../components/KeyboardShortcuts.js';
import { WorkspaceTab } from '../lib/routes.js';
import { type PaletteCommand } from '../components/KeyboardShortcuts.js';
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
  const focusCommands: PaletteCommand[] = [{ id: 'focus-toggle', label: t(noteFocus.shown ? 'focus.close' : 'focus.open'), description: t('shortcuts.describe.focusToggle'), disabled: activeTab !== 'notes', unavailableReason: t('shortcuts.requiresNotes'), run: () => void showFocus(noteFocus.shown ? null : lastFocus) }, { id: 'focus-next-pane', label: t('focus.nextPane'), description: t('shortcuts.describe.focusNextPane'), disabled: (focusDisplay?.panes.length ?? 0) < 2, unavailableReason: t('shortcuts.requiresTwoFocusPanes'), run: () => cycleFocusPane(1) }, { id: 'focus-previous-pane', label: t('focus.previousPane'), description: t('shortcuts.describe.focusPreviousPane'), disabled: (focusDisplay?.panes.length ?? 0) < 2, unavailableReason: t('shortcuts.requiresTwoFocusPanes'), run: () => cycleFocusPane(-1) }, { id: 'focus-next-tab', label: t('focus.nextTab'), description: t('shortcuts.describe.focusNextTab'), disabled: !activeFocusPane, unavailableReason: t('shortcuts.requiresFocusTab'), run: () => cycleFocusTab(1) }, { id: 'focus-previous-tab', label: t('focus.previousTab'), description: t('shortcuts.describe.focusPreviousTab'), disabled: !activeFocusPane, unavailableReason: t('shortcuts.requiresFocusTab'), run: () => cycleFocusTab(-1) }, {
    id: 'focus-close-tab',
    label: t('focus.closeCurrentTab'),
    description: t('shortcuts.describe.focusCloseTab'),
    disabled: !noteFocus.editable || !activeFocusPane?.key,
    unavailableReason: t('shortcuts.requiresEditableFocusTab'),
    run: () => {
      if (activeFocusPane?.key) void noteFocus.close(activeFocusPane.key, activeFocusPane.pane).catch(() => {});
    },
  }, {
    id: 'focus-zoom-tab',
    label: t('focus.zoomCurrentTab'),
    description: t('shortcuts.describe.focusZoomTab'),
    disabled: !zoomablePath,
    unavailableReason: t('shortcuts.requiresFocusNote'),
    run: () => {
      if (zoomablePath) zoomFocusNote(zoomablePath);
    },
  }, ...FOCUS_DIVISIONS.map(division => ({ id: `focus-division-${division}`, label: t('focus.divisionCommand', { name: t(`focus.division.${division}`) }), description: t('shortcuts.describe.focusDivision'), disabled: !noteFocus.editable || !noteFocus.layout || noteFocus.layout.division === division, unavailableReason: t('shortcuts.requiresEditableFocus'), run: () => void noteFocus.setDivision(division).catch(() => {}) }))];

  return { focusCommands, shortcutMode, setShortcutMode };
}
