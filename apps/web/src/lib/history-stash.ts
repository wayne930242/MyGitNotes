import type { HistoryTarget } from './history-api.js';

/** A file's text a person had before restoring an older text over it, kept on this device until they discard it. */
export interface StashedText {
  id: string;
  /** When it was kept, as an ISO time. */
  saved: string;
  content: string;
}

const PREFIX = 'github-notes:history-stash:';
const keyOf = (target: HistoryTarget) => PREFIX + JSON.stringify([target.notebookId ?? '', target.repository ?? '', target.path]);

const isStashed = (value: unknown): value is StashedText => {
  const entry = value as StashedText | null;
  return typeof entry === 'object' && entry !== null && typeof entry.id === 'string' && typeof entry.saved === 'string' && typeof entry.content === 'string';
};

/** The file's kept texts on this device, newest first. */
export function readStash(target: HistoryTarget): StashedText[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(keyOf(target)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isStashed) : [];
  } catch {
    return [];
  }
}

function writeStash(target: HistoryTarget, entries: StashedText[]): StashedText[] {
  if (entries.length) localStorage.setItem(keyOf(target), JSON.stringify(entries));
  else localStorage.removeItem(keyOf(target));
  return entries;
}

/** Keeps one more text, never replacing an earlier one; throws when the device's storage is full. */
export function stashText(target: HistoryTarget, content: string, now = new Date()): StashedText[] {
  const entry = { id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, saved: now.toISOString(), content };
  return writeStash(target, [entry, ...readStash(target)]);
}

export function discardStash(target: HistoryTarget, id: string): StashedText[] {
  return writeStash(target, readStash(target).filter(entry => entry.id !== id));
}
