export const LINE_NUMBERS_STORAGE_KEY = 'github-notes:show-line-numbers';

/** Workspace-configured default, applied when this device has not made its own choice yet. */
let configuredDefaultShowLineNumbers = false;

export function setDefaultShowLineNumbers(value: boolean) {
  configuredDefaultShowLineNumbers = value;
}

export function readShowLineNumbers(storage?: Pick<Storage, 'getItem'>): boolean {
  try {
    const value = (storage ?? globalThis.localStorage).getItem(LINE_NUMBERS_STORAGE_KEY);
    return value === null ? configuredDefaultShowLineNumbers : value === 'true';
  } catch {
    return configuredDefaultShowLineNumbers;
  }
}

export function writeShowLineNumbers(value: boolean, storage?: Pick<Storage, 'setItem'>) {
  try {
    (storage ?? globalThis.localStorage).setItem(LINE_NUMBERS_STORAGE_KEY, String(value));
  } catch { /* Keep the in-page preference. */ }
}
