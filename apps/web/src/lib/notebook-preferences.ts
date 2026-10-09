import { DEFAULT_WORKSPACE_PREFERENCES, type ResolvedPreferences } from '@mygitnotes/core/workspace-preferences';

/** Answers a notebook's preferences: its repository's; with no notebook, or one no repository serves, the default repository's. */
export type NotebookPreferences = (notebookId?: string) => ResolvedPreferences;

let preferencesOf: NotebookPreferences = () => DEFAULT_WORKSPACE_PREFERENCES;

/**
 * Sets how every editor and preview of this page finds its preferences. Each asks with its own note's notebook, so
 * hosts showing notes of different repositories each apply their repository's preferences. The workspace sets this
 * while rendering, because children read it in `useState` initializers, which run before any effect.
 */
export function setNotebookPreferences(next: NotebookPreferences) {
  preferencesOf = next;
}

/** The preferences a note of `notebookId` starts with when this device has made no choice of its own. */
export const notebookPreferences: NotebookPreferences = notebookId => preferencesOf(notebookId);

/** The notebook of the note an element shows, as its editor or preview marks it with `data-source-notebook`. */
export const elementNotebook = (element: Element): string | undefined => element.closest<HTMLElement>('[data-source-notebook]')?.dataset.sourceNotebook;
