// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import { getNoteViewPreferences, LINE_NUMBERS_STORAGE_KEY, NOTE_VIEW_STORAGE_KEY, noteViewStyle, readNoteViewPreferences, readShowLineNumbers, subscribeNoteViewPreferences, writeNoteViewPreferences, writeShowLineNumbers } from './editor-preferences.js';
import { setNotebookPreferences } from './notebook-preferences.js';

/** Every notebook's repository sets `defaultShowLineNumbers` to `value`. */
const setDefaultShowLineNumbers = (value: boolean) => setNotebookPreferences(() => ({ ...DEFAULT_WORKSPACE_PREFERENCES, defaultShowLineNumbers: value }));

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  setDefaultShowLineNumbers(false);
});

describe('Show-line-numbers preference', () => {
  it('follows the workspace default when this device has not chosen yet', () => {
    expect(readShowLineNumbers()).toBe(false);
    setDefaultShowLineNumbers(true);
    expect(readShowLineNumbers()).toBe(true);
  });

  it("keeps this device's stored choice once one exists, even after the default changes", () => {
    writeShowLineNumbers(false);
    setDefaultShowLineNumbers(true);
    expect(readShowLineNumbers()).toBe(false);

    writeShowLineNumbers(true);
    setDefaultShowLineNumbers(false);
    expect(readShowLineNumbers()).toBe(true);
  });

  it('persists through the documented localStorage key', () => {
    writeShowLineNumbers(true);
    expect(localStorage.getItem(LINE_NUMBERS_STORAGE_KEY)).toBe('true');
  });

  it('falls back to the configured default when storage throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    setDefaultShowLineNumbers(true);
    expect(readShowLineNumbers(undefined, storage)).toBe(true);
  });

  it("takes each note's own repository default until this device chooses", () => {
    setNotebookPreferences(notebookId => ({ ...DEFAULT_WORKSPACE_PREFERENCES, defaultShowLineNumbers: notebookId === 'code~src' }));
    expect(readShowLineNumbers('notes~life')).toBe(false);
    expect(readShowLineNumbers('code~src')).toBe(true);
    writeShowLineNumbers(false);
    expect(readShowLineNumbers('code~src')).toBe(false);
  });
});

describe('Note view preferences', () => {
  it('defaults to the standard size and width, and ignores unknown stored values', () => {
    expect(readNoteViewPreferences()).toEqual({ fontSize: 16, contentWidth: 'standard' });
    localStorage.setItem(NOTE_VIEW_STORAGE_KEY, JSON.stringify({ fontSize: 13, contentWidth: 'huge' }));
    expect(readNoteViewPreferences()).toEqual({ fontSize: 16, contentWidth: 'standard' });
    localStorage.setItem(NOTE_VIEW_STORAGE_KEY, '{not json');
    expect(readNoteViewPreferences()).toEqual({ fontSize: 16, contentWidth: 'standard' });
  });

  it('stores a change on this device and notifies every open editor', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNoteViewPreferences(listener);
    writeNoteViewPreferences({ fontSize: 20 });
    writeNoteViewPreferences({ contentWidth: 'full' });
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getNoteViewPreferences()).toEqual({ fontSize: 20, contentWidth: 'full' });
    expect(readNoteViewPreferences()).toEqual({ fontSize: 20, contentWidth: 'full' });
    writeNoteViewPreferences({ fontSize: 16, contentWidth: 'standard' });
  });

  it('maps preferences to the CSS variables the editor theme reads', () => {
    expect(noteViewStyle({ fontSize: 18, contentWidth: 'wide' })).toEqual({ '--note-font-size': '18px', '--note-content-width': '1200px' });
    expect(noteViewStyle({ fontSize: 22, contentWidth: 'full' })).toEqual({ '--note-font-size': '22px', '--note-content-width': 'none' });
  });
});
