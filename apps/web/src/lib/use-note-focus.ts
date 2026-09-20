import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { changeDivision, closeTab, emptyFocusLayout, findFocusTabInPane, FOCUS_MAX_FOCUSES, FOCUS_MAX_TABS, type FocusDivision, FocusError, type FocusLayout, focusPaneCount, type FocusTab, focusTabCount, focusTabKey, moveTab as moveFocusTab, nameFocus, notebookFocuses, placeTab, placeTabs, pruneFocus, removeFocus, renameFocus, updateFocus } from '@mygitnotes/core/focus-page';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
import type { FocusPageController } from './use-focus-page.js';
import { useNoteLookup } from './use-note-queries.js';
import { activatePane, browseTarget, CURRENT_FOCUS, emptyFocusView, entryView, type FocusEntryView, type FocusViewState, focusViewStorageKey, readFocusView, shownAfterClose, showTab, sideTarget } from './focus-view.js';

interface NoteFocusOptions {
  page: FocusPageController;
  notebookId: string;
  /** Separates view state per source. */
  scope: string;
  /** The `focus` URL parameter. */
  focusKey: string | null;
  writable: boolean;
  /** The notebook's lanes, or undefined while they are unknown. */
  lanes: readonly ScreenRow[] | undefined;
  /** Saves the pending edits of the editors of `paths` before they unmount; false keeps the current view. */
  flushEditors: (paths?: readonly string[]) => Promise<boolean>;
}

/** Why a note did not open in the displayed Focus; the caller opens zoom instead. */
export type OpenResult = 'opened' | 'full' | 'readonly' | 'blocked';

function loadView(key: string): FocusViewState {
  try {
    const raw = localStorage.getItem(key);
    return raw ? readFocusView(JSON.parse(raw)) : emptyFocusView();
  } catch {
    return emptyFocusView();
  }
}
const notePath = (key: string | null) => key?.startsWith('note:') ? key.slice('note:'.length) : undefined;
const notePaths = (keys: (string | null)[]) => keys.map(notePath).filter((path): path is string => Boolean(path));

/** Named Focus (Git-synced through the Focus workspace document) and this browser's (current) Focus and view state for one notebook. */
export function useNoteFocus({ page, notebookId, scope, focusKey, writable, lanes, flushEditors }: NoteFocusOptions) {
  const key = focusViewStorageKey(scope, notebookId);
  const [stored, setStored] = useState(() => ({ key, view: loadView(key) }));
  const view = stored.key === key ? stored.view : loadView(key);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (stored.key !== key) setStored({ key, view: loadView(key) });
  }, [key, stored.key]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key) setStored({ key, view: loadView(key) });
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [key]);
  const update = useCallback((change: (view: FocusViewState) => FocusViewState) => {
    const next = change(viewRef.current);
    viewRef.current = next;
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch { /* The view still applies to this tab. */ }
    setStored({ key, view: next });
  }, [key]);

  const available = !page.loading && !page.error;
  const focuses = useMemo(() => available ? notebookFocuses(page.page, notebookId) : [], [available, page.page, notebookId]);
  const known = (target: string) => target === CURRENT_FOCUS || focuses.some(focus => focus.id === target);
  const storedLayout = (target: string): FocusLayout | undefined => target === CURRENT_FOCUS ? viewRef.current.current : focuses.find(focus => focus.id === target);
  const shown = focusKey && known(focusKey) ? focusKey : null;
  // The displayed Focus's notes are read (without bodies) for tab titles and to hide notes that no longer exist.
  const storedPaths = shown ? (storedLayout(shown)?.panes ?? []).flatMap(pane => pane.tabs.flatMap(tab => tab.kind === 'note' ? [tab.path] : [])) : [];
  const lookup = useNoteLookup(storedPaths, false);
  const notes = useMemo(() => new Map(lookup.notes.map(note => [note.path, note])), [lookup.notes]);
  const settled = !lookup.loading && !lookup.error;
  /** A tab is kept until its note or lane is known to be missing. */
  const present = (tab: FocusTab) => tab.kind === 'note' ? !settled || !storedPaths.includes(tab.path) || notes.has(tab.path) : !lanes || lanes.some(row => row.id === tab.id);
  /** Missing notes and lanes are hidden now and dropped on the next write. */
  const layoutOf = (target: string) => {
    const layout = storedLayout(target);
    return layout && pruneFocus(layout, present);
  };
  const entryOf = (target: string, layout = layoutOf(target)) => layout ? entryView(viewRef.current, target, layout) : undefined;
  const namedWritable = writable && page.writable && available;
  const editable = (target: string) => target === CURRENT_FOCUS || namedWritable;

  const layout = shown ? layoutOf(shown) ?? null : null;
  const entry = shown && layout ? entryView(view, shown, layout) : null;

  // Remember the displayed Focus so returning to this notebook shows it again.
  useEffect(() => {
    if (shown && viewRef.current.last !== shown) update(current => ({ ...current, last: shown }));
  }, [shown, update]);

  const setEntry = (target: string, change: (entry: FocusEntryView) => FocusEntryView, layout = layoutOf(target)) => {
    if (!layout) return;
    update(current => ({ ...current, entries: { ...current.entries, [target]: change(entryView(current, target, layout)) } }));
  };
  const [mutationError, setMutationError] = useState<FocusError | null>(null);
  // An error belongs to the Focus it was raised on.
  useEffect(() => setMutationError(null), [shown]);
  /** Applies a structural change; false when the target cannot be written to. Throws (and records) FocusError when the change itself is invalid. */
  const mutate = (target: string, change: (layout: FocusLayout) => FocusLayout): boolean => {
    if (!editable(target)) return false;
    try {
      if (target === CURRENT_FOCUS) update(current => ({ ...current, current: change(pruneFocus(current.current, present)) }));
      else page.change(updateFocus(page.page, target, focus => ({ ...focus, ...change(pruneFocus(focus, present)) })));
      setMutationError(null);
      return true;
    } catch (caught) {
      if (caught instanceof FocusError) setMutationError(caught);
      throw caught;
    }
  };

  /** Opens a note from the browse region (into the active pane) or from inside pane `source` (into the most recently used other pane); a copy already open in another pane is untouched there. */
  const openNote = async (path: string, source?: number): Promise<OpenResult> => {
    if (!shown || !layout || !entry) return 'readonly';
    const tab: FocusTab = { kind: 'note', path }, tabKey = focusTabKey(tab);
    const pane = source === undefined ? browseTarget(entry) : sideTarget(entry, source, layout.panes.length);
    const found = findFocusTabInPane(layout, pane, tabKey) !== -1;
    if (!found && !editable(shown)) return 'readonly';
    if (!found && focusTabCount(layout) >= FOCUS_MAX_TABS) return 'full';
    if (!await flushEditors(notePaths([entry.shown[pane]]))) return 'blocked';
    // The tab count is already checked above; a FocusError here means the layout changed since, so it counts as full too.
    if (!found) {
      try {
        if (!mutate(shown, current => placeTab(current, tab, pane))) return 'full';
      } catch {
        setMutationError(null);
        return 'full';
      }
    }
    setEntry(shown, current => showTab(current, pane, tabKey), layout);
    return 'opened';
  };
  /** Places `tab` in `pane` of any Focus (a drop, the Add to Focus picker, or batch add) and shows it there; a copy of `tab` already open in another pane is untouched there. Throws FocusError. */
  const place = async (target: string, tab: FocusTab, pane: number, index?: number): Promise<boolean> => {
    const current = layoutOf(target), before = entryOf(target, current);
    if (!current || !before || !editable(target)) return false;
    const tabKey = focusTabKey(tab);
    if (target === shown && !await flushEditors(notePaths([before.shown[pane]]))) return false;
    if (!mutate(target, layout => placeTab(layout, tab, pane, index))) return false;
    setEntry(target, entry => showTab(entry, pane, tabKey), current);
    return true;
  };
  /** Moves the tab `key` from `fromPane` to `toPane` (or reorders it within the same pane), for a tab-bar drag without the copy modifier. Throws FocusError. */
  const moveTab = async (target: string, key: string, fromPane: number, toPane: number, index?: number): Promise<boolean> => {
    const current = layoutOf(target), before = entryOf(target, current);
    if (!current || !before || !editable(target)) return false;
    const leavesSource = fromPane !== toPane && before.shown[fromPane] === key;
    const toFlush = leavesSource ? [before.shown[fromPane], before.shown[toPane]] : [before.shown[toPane]];
    if (target === shown && !await flushEditors(notePaths(toFlush))) return false;
    const sourceNext = leavesSource ? shownAfterClose(current, fromPane, key) : null;
    if (!mutate(target, layout => moveFocusTab(layout, fromPane, toPane, key, index))) return false;
    setEntry(target, entry => {
      const withSource = leavesSource ? { ...entry, shown: entry.shown.map((value, i) => i === fromPane ? sourceNext : value) } : entry;
      return showTab(withSource, toPane, key);
    }, current);
    return true;
  };
  const show = async (pane: number, tabKey: string) => {
    if (!shown || !entry) return;
    const previous = entry.shown[pane];
    if (previous !== tabKey && !await flushEditors(notePaths([previous]))) return;
    setEntry(shown, current => showTab(current, pane, tabKey));
  };
  const activate = (pane: number) => {
    if (shown && entry && entry.activePane !== pane) setEntry(shown, current => activatePane(current, pane));
  };
  /** Closes `tabKey` in `pane` only; a copy in another pane is untouched. Throws FocusError if the shown Focus was removed since it was read. */
  const close = async (tabKey: string, pane: number) => {
    if (!shown || !layout || !entry) return;
    if (findFocusTabInPane(layout, pane, tabKey) === -1) return;
    const visible = entry.shown[pane] === tabKey;
    if (visible && !await flushEditors(notePaths([tabKey]))) return;
    const next = shownAfterClose(layout, pane, tabKey);
    if (!mutate(shown, current => closeTab(current, pane, tabKey))) return;
    if (visible) setEntry(shown, current => ({ ...current, shown: current.shown.map((key, index) => index === pane ? next : key) }), layout);
  };
  /** Adds every tab in `tabs` to `pane` of `target`, skipping any already there; reports how many were added vs. skipped. False when the target cannot be written to. Throws FocusError. */
  const addBatch = (target: string, tabs: FocusTab[], pane: number): { added: number; skipped: number; } | false => {
    if (!editable(target)) return false;
    let outcome = { added: 0, skipped: 0 };
    if (
      !mutate(target, layout => {
        const result = placeTabs(layout, tabs, pane);
        outcome = { added: result.added, skipped: result.skipped };
        return result.layout;
      })
    ) return false;
    return outcome;
  };
  /** Folding panes keeps the active pane's tab on screen: it lands on the last remaining pane, which becomes active. Throws FocusError if the shown Focus was removed since it was read. */
  const setDivision = async (division: FocusDivision) => {
    if (!shown || !layout || !entry || division === layout.division) return;
    const count = focusPaneCount(division);
    // Every pane is laid out again, so every displayed editor remounts.
    if (!await flushEditors(notePaths(entry.shown))) return;
    if (!mutate(shown, current => changeDivision(current, division))) return;
    const kept = entry.activePane >= count ? entry.shown[entry.activePane] : undefined;
    setEntry(shown, current => {
      const next = { ...current, shown: current.shown.slice(0, count), recent: current.recent.filter(pane => pane < count) };
      return kept ? showTab(next, count - 1, kept) : next;
    }, changeDivision(layout, division));
  };
  const setRatios = (group: string, sizes: number[]) => {
    if (shown) setEntry(shown, current => ({ ...current, ratios: { ...current.ratios, [group]: sizes } }));
  };
  const setAutoHide = (pane: number, on: boolean) => {
    if (shown) setEntry(shown, current => ({ ...current, autoHide: current.autoHide.map((value, index) => index === pane ? on : value) }));
  };
  const setDock = (dock: Partial<FocusViewState['dock']>) => update(current => ({ ...current, dock: { ...current.dock, ...dock } }));
  const forget = () => update(current => ({ ...current, last: null }));

  const canName = namedWritable && page.page.focuses.length < FOCUS_MAX_FOCUSES;
  /** Names (current): it becomes a named Focus with the same view, and (current) starts empty. Throws FocusError. */
  const name = (label: string): string => {
    const { page: next, focus } = nameFocus(page.page, pruneFocus(viewRef.current.current, present), notebookId, label);
    page.change(next);
    update(current => {
      const { [CURRENT_FOCUS]: moved, ...entries } = current.entries;
      return { ...current, current: emptyFocusLayout(), entries: moved ? { ...entries, [focus.id]: moved } : entries, last: focus.id };
    });
    return focus.id;
  };
  /** Throws FocusError for a duplicate name. */
  const rename = (id: string, label: string) => page.change(renameFocus(page.page, id, label));
  const remove = async (id: string) => {
    if (id === shown && entry && !await flushEditors(notePaths(entry.shown))) return false;
    page.change(removeFocus(page.page, id));
    update(current => {
      const { [id]: _removed, ...entries } = current.entries;
      return { ...current, entries, last: current.last === id ? null : current.last };
    });
    return true;
  };

  return { notebookId, focuses, error: page.error, loading: page.loading, view, shown, layout, entry, notes, mutationError, dismissMutationError: () => setMutationError(null), editable: shown ? editable(shown) : false, canName, layoutOf, entryOf, editableFocus: editable, openNote, place, moveTab, show, activate, close, addBatch, setDivision, setRatios, setAutoHide, setDock, forget, name, rename, remove };
}
export type NoteFocus = ReturnType<typeof useNoteFocus>;
