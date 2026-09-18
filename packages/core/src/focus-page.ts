import { z } from 'zod';
import type { WorkspaceDocument } from './workspace-documents.js';
import type { ScreenPage } from './screen-page.js';

export const FOCUS_PAGE_FILE = '.github-notes-focus.yaml';
export const FOCUS_MAX_BYTES = 512 * 1024;
export const FOCUS_MAX_FOCUSES = 40;
export const FOCUS_MAX_TABS = 100;

export const FOCUS_DIVISIONS = ['single', 'columns-2', 'rows-2', 'major-left', 'major-top', 'columns-3', 'grid-2x2'] as const;
export type FocusDivision = typeof FOCUS_DIVISIONS[number];
const PANE_COUNTS: Record<FocusDivision, number> = { single: 1, 'columns-2': 2, 'rows-2': 2, 'major-left': 3, 'major-top': 3, 'columns-3': 3, 'grid-2x2': 4 };
export function focusPaneCount(division: FocusDivision): number { return PANE_COUNTS[division]; }

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const repoPath = z.string().min(1).max(2048).refine(value => !/[\\\x00-\x1f\x7f]/.test(value)
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'Invalid workspace path');
const notebookId = z.string().min(1).max(128);

export const FocusTabSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('note'), path: repoPath }).strict(),
  z.object({ kind: z.literal('lane'), id }).strict(),
]);
export const FocusPaneSchema = z.object({ tabs: z.array(FocusTabSchema) }).strict();
export type FocusTab = z.infer<typeof FocusTabSchema>;
export type FocusPane = z.infer<typeof FocusPaneSchema>;

export function focusTabKey(tab: FocusTab): string { return tab.kind === 'note' ? `note:${tab.path}` : `lane:${tab.id}`; }

/** Shared by a bare layout and a named Focus: pane shape must match the division, tab identity is unique, and the tab budget is layout-wide. */
function checkFocusLayout(layout: { division: FocusDivision; panes: { tabs: FocusTab[] }[] }, context: z.RefinementCtx): void {
  if (layout.panes.length !== focusPaneCount(layout.division)) context.addIssue({ code: 'custom', message: 'Focus pane count must match the division' });
  const keys = new Set<string>(); let total = 0;
  for (const pane of layout.panes) for (const tab of pane.tabs) {
    total++;
    const key = focusTabKey(tab);
    if (keys.has(key)) context.addIssue({ code: 'custom', message: 'Duplicate tab in Focus layout' });
    keys.add(key);
  }
  if (total > FOCUS_MAX_TABS) context.addIssue({ code: 'custom', message: 'Focus layout has too many tabs' });
}

const layoutFields = { division: z.enum(FOCUS_DIVISIONS), panes: z.array(FocusPaneSchema) };
export const FocusLayoutSchema = z.object(layoutFields).strict().superRefine(checkFocusLayout);
export const FocusSchema = z.object({ id, notebookId, name: z.string().trim().min(1).max(100), ...layoutFields }).strict().superRefine(checkFocusLayout);
export type FocusLayout = z.infer<typeof FocusLayoutSchema>;
export type Focus = z.infer<typeof FocusSchema>;

export const FocusPageSchema = z.object({ version: z.literal(1), focuses: z.array(FocusSchema).max(FOCUS_MAX_FOCUSES) }).strict()
  .superRefine((page, context) => {
    const ids = new Set<string>(); const names = new Map<string, Set<string>>();
    for (const focus of page.focuses) {
      if (ids.has(focus.id)) context.addIssue({ code: 'custom', message: 'Duplicate Focus id' });
      ids.add(focus.id);
      const used = names.get(focus.notebookId) || new Set<string>();
      if (used.has(focus.name)) context.addIssue({ code: 'custom', message: 'Duplicate Focus name in notebook' });
      used.add(focus.name);
      names.set(focus.notebookId, used);
    }
  });
export type FocusPage = z.infer<typeof FocusPageSchema>;

export class FocusError extends Error {
  constructor(public readonly code: 'tab-limit' | 'focus-limit' | 'duplicate-name' | 'unknown-focus' | 'invalid-pane', message: string) {
    super(message);
  }
}

export const emptyFocusPage = (): FocusPage => ({ version: 1, focuses: [] });
export const emptyFocusLayout = (): FocusLayout => ({ division: 'single', panes: [{ tabs: [] }] });
export function readFocusPage(value: unknown): FocusPage { return FocusPageSchema.parse(value); }

export function findFocusTab(layout: FocusLayout, key: string): { pane: number; index: number } | undefined {
  for (let pane = 0; pane < layout.panes.length; pane++) {
    const index = layout.panes[pane].tabs.findIndex(tab => focusTabKey(tab) === key);
    if (index !== -1) return { pane, index };
  }
  return undefined;
}
export function focusTabCount(layout: FocusLayout): number { return layout.panes.reduce((total, pane) => total + pane.tabs.length, 0); }

/** Growing a division appends empty panes; shrinking folds every removed pane's tabs, in pane order, onto the end of the last remaining pane. */
export function changeDivision<T extends FocusLayout>(layout: T, division: FocusDivision): T {
  if (division === layout.division) return layout;
  const count = focusPaneCount(division);
  if (count >= layout.panes.length) {
    const panes = [...layout.panes, ...Array.from({ length: count - layout.panes.length }, () => ({ tabs: [] }))];
    return { ...layout, division, panes } as T;
  }
  const kept = layout.panes.slice(0, count);
  const overflow = layout.panes.slice(count).flatMap(pane => pane.tabs);
  const panes = kept.map((pane, index) => index === kept.length - 1 ? { tabs: [...pane.tabs, ...overflow] } : pane);
  return { ...layout, division, panes } as T;
}

export function placeTab<T extends FocusLayout>(layout: T, tab: FocusTab, pane: number, index?: number): T {
  if (pane < 0 || pane >= layout.panes.length) throw new FocusError('invalid-pane', 'Pane is out of range');
  const key = focusTabKey(tab);
  const existing = findFocusTab(layout, key);
  if (!existing && focusTabCount(layout) >= FOCUS_MAX_TABS) throw new FocusError('tab-limit', 'Focus layout has too many tabs');
  const panes = layout.panes.map(current => ({ tabs: [...current.tabs] }));
  if (existing) panes[existing.pane].tabs.splice(existing.index, 1);
  const target = panes[pane].tabs;
  const at = index === undefined ? target.length : Math.max(0, Math.min(index, target.length));
  target.splice(at, 0, tab);
  return { ...layout, panes } as T;
}

export function closeTab<T extends FocusLayout>(layout: T, key: string): T {
  const existing = findFocusTab(layout, key);
  if (!existing) return layout;
  const panes = layout.panes.map((pane, index) => index === existing.pane ? { tabs: pane.tabs.filter((_, i) => i !== existing.index) } : pane);
  return { ...layout, panes } as T;
}

export function pruneFocus<T extends FocusLayout>(layout: T, exists: (tab: FocusTab) => boolean): T {
  const panes = layout.panes.map(pane => ({ tabs: pane.tabs.filter(exists) }));
  if (focusTabCount(layout) === focusTabCount({ division: layout.division, panes })) return layout;
  return { ...layout, panes } as T;
}

const DISPLAY_2: Record<FocusDivision, FocusDivision> = { single: 'single', 'columns-2': 'columns-2', 'rows-2': 'rows-2', 'major-left': 'columns-2', 'major-top': 'rows-2', 'columns-3': 'columns-2', 'grid-2x2': 'columns-2' };

/** Narrow-screen display mapping: panes beyond capacity fold into the last displayed pane, in stored pane order. */
export function displayPanes(division: FocusDivision, capacity: 1 | 2 | 4): { division: FocusDivision; groups: number[][] } {
  const count = focusPaneCount(division);
  if (count <= capacity) return { division, groups: Array.from({ length: count }, (_, index) => [index]) };
  if (capacity === 1) return { division: 'single', groups: [Array.from({ length: count }, (_, index) => index)] };
  return { division: DISPLAY_2[division], groups: [[0], Array.from({ length: count - 1 }, (_, index) => index + 1)] };
}

/** Mutates `page` in place, matching Screen relocation (see file-manager.ts). Returns whether any note path changed. */
export function relocateFocusPaths(page: FocusPage, notebookId: string, move: (path: string) => string): boolean {
  let changed = false;
  for (const focus of page.focuses) {
    if (focus.notebookId !== notebookId) continue;
    for (const pane of focus.panes) for (const tab of pane.tabs) {
      if (tab.kind !== 'note') continue;
      const next = move(tab.path);
      if (next !== tab.path) { tab.path = next; changed = true; }
    }
  }
  return changed;
}

export function notebookFocuses(page: FocusPage, notebookId: string): Focus[] { return page.focuses.filter(focus => focus.notebookId === notebookId); }

export function nameFocus(page: FocusPage, layout: FocusLayout, notebookId: string, name: string): { page: FocusPage; focus: Focus } {
  if (page.focuses.length >= FOCUS_MAX_FOCUSES) throw new FocusError('focus-limit', 'Too many Focus entries');
  const trimmed = name.trim();
  if (page.focuses.some(focus => focus.notebookId === notebookId && focus.name === trimmed)) throw new FocusError('duplicate-name', 'Focus name already used in this notebook');
  const focus = { ...layout, id: globalThis.crypto.randomUUID(), notebookId, name: trimmed };
  const next = FocusPageSchema.parse({ ...page, focuses: [...page.focuses, focus] });
  return { page: next, focus: next.focuses[next.focuses.length - 1] };
}

export function renameFocus(page: FocusPage, id: string, name: string): FocusPage {
  const focus = page.focuses.find(focus => focus.id === id);
  if (!focus) throw new FocusError('unknown-focus', 'Unknown Focus');
  const trimmed = name.trim();
  if (trimmed !== focus.name && page.focuses.some(other => other.notebookId === focus.notebookId && other.name === trimmed)) {
    throw new FocusError('duplicate-name', 'Focus name already used in this notebook');
  }
  return FocusPageSchema.parse({ ...page, focuses: page.focuses.map(f => f.id === id ? { ...f, name: trimmed } : f) });
}

export function updateFocus(page: FocusPage, id: string, change: (focus: Focus) => Focus): FocusPage {
  if (!page.focuses.some(focus => focus.id === id)) throw new FocusError('unknown-focus', 'Unknown Focus');
  return FocusPageSchema.parse({ ...page, focuses: page.focuses.map(focus => focus.id === id ? change(focus) : focus) });
}

export function removeFocus(page: FocusPage, id: string): FocusPage {
  if (!page.focuses.some(focus => focus.id === id)) return page;
  return { ...page, focuses: page.focuses.filter(focus => focus.id !== id) };
}

const within = (path: string, root: string) => path === root || path.startsWith(root + '/');

/**
 * Tab content must belong to the Focus's notebook: a note by its notebook root, a lane by the Screen lane's notebook.
 * A lane id no Screen lane carries is stale, not foreign; stale tabs are hidden and dropped on the next write.
 */
export function foreignFocusTab(tab: FocusTab, notebookId: string, notebooks: readonly { id: string; root: string }[], screen: ScreenPage): boolean {
  if (tab.kind === 'lane') { const row = screen.rows.find(row => row.id === tab.id); return Boolean(row && row.notebookId !== notebookId); }
  const owner = [...notebooks].sort((a, b) => b.root.length - a.root.length).find(notebook => within(tab.path, notebook.root));
  return owner?.id !== notebookId;
}

/** Drops every tab that belongs to another notebook and reports whether any was dropped. */
export function ownFocusPage(page: FocusPage, notebooks: readonly { id: string; root: string }[], screen: ScreenPage): { page: FocusPage; foreign: boolean } {
  let foreign = false;
  const focuses = page.focuses.map(focus => pruneFocus(focus, tab => {
    const outside = foreignFocusTab(tab, focus.notebookId, notebooks, screen);
    if (outside) foreign = true;
    return !outside;
  }));
  return foreign ? { page: { ...page, focuses }, foreign } : { page, foreign };
}

export const FOCUS_DOCUMENT: WorkspaceDocument<FocusPage> = {
  file: FOCUS_PAGE_FILE, label: 'Focus', maxBytes: FOCUS_MAX_BYTES, scopes: ['focus', 'folders', 'files'],
  schema: FocusPageSchema, fileSchema: FocusPageSchema, empty: emptyFocusPage, read: readFocusPage, relocate: relocateFocusPaths, own: ownFocusPage,
};
