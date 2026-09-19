import { displayPanes, emptyFocusLayout, findFocusTabInPane, type FocusDivision, type FocusLayout, FocusLayoutSchema, focusTabKey } from '@mygitnotes/core/focus-page';

export const CURRENT_FOCUS = 'current';

/** View state for one Focus (the unnamed (current) one under key CURRENT_FOCUS, or a named one under its id). */
export interface FocusEntryView {
  activePane: number;
  /** Per pane: the key (focusTabKey) of the displayed tab, or null when the pane is empty. */
  shown: (string | null)[];
  /** Pane indices, most recently used first. */
  recent: number[];
  /** Split sizes (percentages) keyed by a group id chosen by the layout component. */
  ratios: Record<string, number[]>;
  /** Per pane: its tab bar stays hidden until pointed at. */
  autoHide: boolean[];
}

export interface FocusViewState {
  /** Layout of the unnamed (current) Focus; it lives only in this browser. */
  current: FocusLayout;
  entries: Record<string, FocusEntryView>;
  /** Focus key last displayed in this notebook; null means normal browsing. */
  last: string | null;
  /** Browse region: left dock width (px), top dock height (px), collapsed flag. */
  dock: { left: number; top: number; collapsed: boolean; };
}

const FOCUS_KEY_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readEntry(raw: unknown): FocusEntryView | null {
  if (!isRecord(raw)) return null;
  const { activePane, shown, recent, ratios, autoHide } = raw;
  if (typeof activePane !== 'number') return null;
  if (!Array.isArray(shown) || !shown.every(value => value === null || typeof value === 'string')) return null;
  if (!Array.isArray(recent) || !recent.every(value => typeof value === 'number')) return null;
  if (!isRecord(ratios) || !Object.values(ratios).every(value => Array.isArray(value) && value.every(n => typeof n === 'number'))) return null;
  // Entries stored before auto-hide existed have no autoHide.
  if (autoHide !== undefined && !(Array.isArray(autoHide) && autoHide.every(value => typeof value === 'boolean'))) return null;
  return { activePane, shown: [...shown] as (string | null)[], recent: [...recent] as number[], ratios: ratios as Record<string, number[]>, autoHide: autoHide ? [...autoHide] as boolean[] : [] };
}

export function emptyFocusView(): FocusViewState {
  return { current: emptyFocusLayout(), entries: {}, last: null, dock: { left: 320, top: 280, collapsed: false } };
}

/** Tolerant reader for whatever JSON was stored: never throws, drops or defaults whatever doesn't validate. */
export function readFocusView(raw: unknown): FocusViewState {
  if (!isRecord(raw)) return emptyFocusView();
  const parsedCurrent = FocusLayoutSchema.safeParse(raw.current);
  const current = parsedCurrent.success ? parsedCurrent.data : emptyFocusLayout();
  const entries: Record<string, FocusEntryView> = {};
  if (isRecord(raw.entries)) {
    for (const [key, value] of Object.entries(raw.entries)) {
      const entry = readEntry(value);
      if (entry) entries[key] = entry;
    }
  }
  const last = typeof raw.last === 'string' && FOCUS_KEY_RE.test(raw.last) ? raw.last : null;
  const defaults = emptyFocusView().dock;
  const dockRaw = isRecord(raw.dock) ? raw.dock : {};
  const left = typeof dockRaw.left === 'number' && Number.isFinite(dockRaw.left) && dockRaw.left >= 0 ? dockRaw.left : defaults.left;
  // Views stored before the card dock moved to the top keep their height under `bottom`.
  const topRaw = dockRaw.top ?? dockRaw.bottom;
  const top = typeof topRaw === 'number' && Number.isFinite(topRaw) && topRaw >= 0 ? topRaw : defaults.top;
  const collapsed = typeof dockRaw.collapsed === 'boolean' ? dockRaw.collapsed : defaults.collapsed;
  return { current, entries, last, dock: { left, top, collapsed } };
}

/** Normalizes a stored entry (if any) against `layout`: one shown slot and auto-hide flag per pane, a valid activePane, and recent covering every pane. */
export function entryView(state: FocusViewState, key: string, layout: FocusLayout): FocusEntryView {
  const stored = state.entries[key];
  const paneCount = layout.panes.length;
  const activePane = stored && Number.isInteger(stored.activePane) && stored.activePane >= 0 && stored.activePane < paneCount ? stored.activePane : 0;
  const shown = layout.panes.map((pane, index) => {
    const storedKey = stored?.shown[index];
    if (storedKey && pane.tabs.some(tab => focusTabKey(tab) === storedKey)) return storedKey;
    return pane.tabs[0] ? focusTabKey(pane.tabs[0]) : null;
  });
  const seen = new Set<number>();
  const recent: number[] = [];
  for (const pane of stored?.recent || []) {
    if (Number.isInteger(pane) && pane >= 0 && pane < paneCount && !seen.has(pane)) {
      seen.add(pane);
      recent.push(pane);
    }
  }
  for (let pane = 0; pane < paneCount; pane++) {
    if (!seen.has(pane)) {
      seen.add(pane);
      recent.push(pane);
    }
  }
  const autoHide = layout.panes.map((_, index) => stored?.autoHide[index] === true);
  return { activePane, shown, recent, ratios: stored?.ratios || {}, autoHide };
}

export function activatePane(entry: FocusEntryView, pane: number): FocusEntryView {
  return { ...entry, activePane: pane, recent: [pane, ...entry.recent.filter(p => p !== pane)] };
}

export function showTab(entry: FocusEntryView, pane: number, key: string): FocusEntryView {
  const shown = entry.shown.map((value, index) => index === pane ? key : value);
  return activatePane({ ...entry, shown }, pane);
}

/** The pane a row clicked in the browse region opens into. */
export function browseTarget(entry: FocusEntryView): number {
  return entry.activePane;
}

/** For lane cards and [[links]] opened from inside a pane: the most recently used pane other than the source. */
export function sideTarget(entry: FocusEntryView, sourcePane: number, paneCount: number): number {
  if (paneCount <= 1) return sourcePane;
  const found = entry.recent.find(pane => pane !== sourcePane);
  return found !== undefined ? found : (sourcePane + 1) % paneCount;
}

/** Given the layout before closing `key` in `pane`, the key that should be shown afterward: next tab right, else left, else none. */
export function shownAfterClose(layout: FocusLayout, pane: number, key: string): string | null {
  const index = findFocusTabInPane(layout, pane, key);
  if (index === -1) return null;
  const tabs = layout.panes[pane].tabs;
  const right = tabs[index + 1];
  if (right) return focusTabKey(right);
  const left = tabs[index - 1];
  return left ? focusTabKey(left) : null;
}

/** Narrow screens display several stored panes as one merged pane; picks which stored pane and key to show for it. */
export function groupShown(entry: FocusEntryView, layout: FocusLayout, group: number[]): { pane: number; key: string | null; } {
  const keyIn = (pane: number): string | null => {
    const key = entry.shown[pane];
    return key && layout.panes[pane]?.tabs.some(tab => focusTabKey(tab) === key) ? key : null;
  };
  if (group.includes(entry.activePane)) return { pane: entry.activePane, key: keyIn(entry.activePane) };
  for (const pane of group) {
    const key = keyIn(pane);
    if (key) return { pane, key };
  }
  return { pane: group[0], key: null };
}

/** One pane on screen: the stored panes it stands for, and the stored pane and tab key it currently shows. */
export interface DisplayedPane {
  panes: number[];
  pane: number;
  key: string | null;
}

/** What the screen shows at `capacity` panes (1, 2 or 4): the display division and one entry per displayed pane. */
export function displayedPanes(entry: FocusEntryView, layout: FocusLayout, capacity: 1 | 2 | 4): { division: FocusDivision; panes: DisplayedPane[]; } {
  const display = displayPanes(layout.division, capacity);
  return { division: display.division, panes: display.groups.map(group => ({ panes: group, ...groupShown(entry, layout, group) })) };
}
