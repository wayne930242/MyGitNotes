import { type CSSProperties, useSyncExternalStore } from 'react';
import { notebookPreferences } from './notebook-preferences.js';

export const LINE_NUMBERS_STORAGE_KEY = 'github-notes:show-line-numbers';

/** This device's choice once it has made one; until then the preference of the repository serving `notebookId`. */
export function readShowLineNumbers(notebookId?: string, storage?: Pick<Storage, 'getItem'>): boolean {
  const fallback = notebookPreferences(notebookId).defaultShowLineNumbers;
  try {
    const value = (storage ?? globalThis.localStorage).getItem(LINE_NUMBERS_STORAGE_KEY);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

export function writeShowLineNumbers(value: boolean, storage?: Pick<Storage, 'setItem'>) {
  try {
    (storage ?? globalThis.localStorage).setItem(LINE_NUMBERS_STORAGE_KEY, String(value));
  } catch { /* Keep the in-page preference. */ }
}

export const FORMAT_TOOLBAR_STORAGE_KEY = 'github-notes:show-format-toolbar';

/** The note editor's formatting toolbar stays hidden until this device shows it. */
export function readShowFormatToolbar(storage?: Pick<Storage, 'getItem'>): boolean {
  try {
    return (storage ?? globalThis.localStorage).getItem(FORMAT_TOOLBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeShowFormatToolbar(value: boolean, storage?: Pick<Storage, 'setItem'>) {
  try {
    (storage ?? globalThis.localStorage).setItem(FORMAT_TOOLBAR_STORAGE_KEY, String(value));
  } catch { /* Keep the in-page preference. */ }
}

export const NOTE_VIEW_STORAGE_KEY = 'github-notes:note-view';
/** Body text sizes in pixels; the smallest stays at 16px so mobile browsers do not zoom a focused editor. */
export const NOTE_FONT_SIZES = [16, 18, 20, 22] as const;
export type NoteFontSize = (typeof NOTE_FONT_SIZES)[number];
/** Maximum width of the live editor's page; the choice is offered on desktop only. */
export const NOTE_CONTENT_WIDTHS = { standard: '880px', wide: '1200px', full: 'none' } as const;
export type NoteContentWidth = keyof typeof NOTE_CONTENT_WIDTHS;
export interface NoteViewPreferences {
  fontSize: NoteFontSize;
  contentWidth: NoteContentWidth;
}
const DEFAULT_NOTE_VIEW: NoteViewPreferences = { fontSize: 16, contentWidth: 'standard' };

export function readNoteViewPreferences(storage?: Pick<Storage, 'getItem'>): NoteViewPreferences {
  try {
    const saved = JSON.parse((storage ?? globalThis.localStorage).getItem(NOTE_VIEW_STORAGE_KEY) || '{}');
    return { fontSize: NOTE_FONT_SIZES.includes(saved.fontSize) ? saved.fontSize : DEFAULT_NOTE_VIEW.fontSize, contentWidth: Object.hasOwn(NOTE_CONTENT_WIDTHS, saved.contentWidth) ? saved.contentWidth : DEFAULT_NOTE_VIEW.contentWidth };
  } catch {
    return DEFAULT_NOTE_VIEW;
  }
}

let noteView: NoteViewPreferences | undefined;
const noteViewListeners = new Set<() => void>();

/** Current view preferences, shared by every open editor of this page. */
export const getNoteViewPreferences = () => noteView ??= readNoteViewPreferences();

export function subscribeNoteViewPreferences(listener: () => void) {
  noteViewListeners.add(listener);
  return () => noteViewListeners.delete(listener);
}

export function writeNoteViewPreferences(change: Partial<NoteViewPreferences>, storage?: Pick<Storage, 'setItem'>) {
  noteView = { ...getNoteViewPreferences(), ...change };
  try {
    (storage ?? globalThis.localStorage).setItem(NOTE_VIEW_STORAGE_KEY, JSON.stringify(noteView));
  } catch { /* Keep the in-page preference. */ }
  for (const listener of noteViewListeners) listener();
}

/** CSS custom properties the live editor theme reads for its body size and page width. */
export const noteViewStyle = ({ fontSize, contentWidth }: NoteViewPreferences) => ({ '--note-font-size': `${fontSize}px`, '--note-content-width': NOTE_CONTENT_WIDTHS[contentWidth] }) as CSSProperties;

export const useNoteViewPreferences = () => useSyncExternalStore(subscribeNoteViewPreferences, getNoteViewPreferences);
