import { focusTabKey, type FocusTab } from '@mygitnotes/core/focus-page';

/** Folder and tags combine with Or (either matches) unless both are set and Combine is switched to And (both must match). */
export function batchAddMode(hasFolder: boolean, hasTags: boolean, combine: 'or' | 'and'): 'and' | 'or' {
  return hasFolder && hasTags && combine === 'or' ? 'or' : 'and';
}

/** Or unions two independently-queried path lists; And already comes from a single combined query. */
export function batchAddCandidates(mode: 'and' | 'or', andPaths: readonly string[], folderPaths: readonly string[], tagPaths: readonly string[]): string[] {
  return mode === 'or' ? [...new Set([...folderPaths, ...tagPaths])] : [...andPaths];
}

/** Candidate paths as tabs, sorted by path so newly-added tabs appear in a stable order. */
export function batchAddTabs(paths: readonly string[]): FocusTab[] {
  return [...paths].sort().map(path => ({ kind: 'note', path }));
}

/** How many of `tabs` are already held, for reporting alongside `addBatch`'s `{added, skipped}` outcome. */
export function batchAddExisting(tabs: readonly FocusTab[], heldKeys: ReadonlySet<string>): number {
  return tabs.filter(tab => heldKeys.has(focusTabKey(tab))).length;
}

/** Splits addBatch's single `skipped` count into "already present" and "budget exceeded" for the result message. */
export function batchAddResult(outcome: { added: number; skipped: number }, existing: number): { added: number; existing: number; full: number } {
  return { added: outcome.added, existing, full: outcome.skipped - existing };
}
