// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LINE_NUMBERS_STORAGE_KEY, readShowLineNumbers, setDefaultShowLineNumbers, writeShowLineNumbers } from './editor-preferences.js';

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
    expect(readShowLineNumbers(storage)).toBe(true);
  });
});
