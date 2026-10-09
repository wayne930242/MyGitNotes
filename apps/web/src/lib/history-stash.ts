import type { HistoryTarget } from './history-api.js';
import { parseNotebookKey } from '@mygitnotes/core/notebook-key';

/** A file's text a person had before restoring an older text over it, kept on this device until they discard it. */
export interface StashedText {
  id: string;
  /** When it was kept, as an ISO time. */
  saved: string;
  content: string;
}

const PREFIX = 'github-notes:history-stash:';
const storageKey = (notebookId: string, target: HistoryTarget) => PREFIX + JSON.stringify([notebookId, target.repository ?? '', target.path]);

/**
 * Where a file's kept texts are stored. Texts kept before notebook keys, under the notebook's local id, move to its
 * key once; they leave the old key so a later discard is not undone.
 */
function keyOf(target: HistoryTarget): string {
  const key = storageKey(target.notebookId ?? '', target);
  const localId = target.notebookId ? parseNotebookKey(target.notebookId)?.localId : undefined;
  if (!localId || localStorage.getItem(key) !== null) return key;
  const legacyKey = storageKey(localId, target);
  const legacy = localStorage.getItem(legacyKey);
  if (legacy !== null) {
    localStorage.setItem(key, legacy);
    localStorage.removeItem(legacyKey);
  }
  return key;
}

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
