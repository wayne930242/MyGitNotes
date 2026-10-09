import YAML from 'yaml';
import type { NoteItem } from './types.js';
import { sameValue } from './merge-note.js';
import { createUnifiedDiff } from './unified-diff.js';
import { isBareNotebookId } from '@mygitnotes/core/notebook-key';
import { isNotebookKey, notebookIdCodec } from './notebook-keys.js';

export interface WorkingNote {
  note: NoteItem;
  base: NoteItem | null;
  blocked?: string;
  /** The note is deleted: `base` is the committed note it removes, kept for its diff and for the trash's Restore. */
  deleted?: true;
}
export type WorkingNotes = Record<string, WorkingNote>;
const prefix = 'gh_notes_working:';
export const workingNotesKey = (scope: string) => prefix + scope;

/** Where one repository's working changes are stored, and the alias that names its notebooks by key. */
export interface DraftStore {
  scope: string;
  alias: string;
}

/** The working changes as this browser stores them: their notes carry the repository's local notebook ids. */
export function readStoredWorkingNotes(scope: string): WorkingNotes {
  const raw = localStorage.getItem(workingNotesKey(scope));
  if (!raw) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Local working changes could not be read. Keep browser data for recovery.');
  return value;
}

const named = (note: unknown) => Boolean(note && typeof note === 'object' && isBareNotebookId(String((note as NoteItem).notebookId)));

/**
 * A stored working change with its notebook named by key. One whose notebook ids cannot be read is returned as stored:
 * it stays in storage and in Changes for recovery, and is never dropped.
 */
export function keyedWorkingNote(entry: WorkingNote, alias: string): WorkingNote {
  if (!named(entry?.note) || entry.base && !named(entry.base)) return entry;
  const { toKey } = notebookIdCodec(alias);
  return { ...entry, note: { ...entry.note, notebookId: toKey(entry.note.notebookId) }, base: entry.base ? { ...entry.base, notebookId: toKey(entry.base.notebookId) } : entry.base };
}

/** A working change as it is stored, with the repository's local notebook ids; one kept as stored stays so. */
export function storedWorkingNote(entry: WorkingNote, alias: string): WorkingNote {
  if (!isNotebookKey(String(entry.note?.notebookId))) return entry;
  const { toLocal } = notebookIdCodec(alias);
  return { ...entry, note: { ...entry.note, notebookId: toLocal(entry.note.notebookId) }, base: entry.base ? { ...entry.base, notebookId: toLocal(entry.base.notebookId) } : entry.base };
}

const keyedEntries = (entries: WorkingNotes, alias: string): WorkingNotes => Object.fromEntries(Object.entries(entries).map(([path, entry]) => [path, keyedWorkingNote(entry, alias)]));

/** One repository's working changes, their notebooks named by key. */
export function readWorkingNotes(store: DraftStore): WorkingNotes {
  return keyedEntries(readStoredWorkingNotes(store.scope), store.alias);
}

/** Persist before announcing success; quota errors leave the in-memory draft visible. */
export function updateWorkingNote(store: DraftStore, path: string, entry: WorkingNote | null): WorkingNotes {
  const entries = readStoredWorkingNotes(store.scope);
  if (entry?.base && !entry.blocked && !entry.deleted && sameValue(entry.note.content, entry.base.content) && sameValue(entry.note.metadata, entry.base.metadata)) entry = null;
  if (entry) entries[path] = storedWorkingNote(entry, store.alias);
  else delete entries[path];
  localStorage.setItem(workingNotesKey(store.scope), JSON.stringify(entries));
  return keyedEntries(entries, store.alias);
}

/** Clear only the committed version, preserving any edit made during the request. */
export function clearCommittedNotes(store: DraftStore, sent: WorkingNotes): WorkingNotes {
  const entries = readStoredWorkingNotes(store.scope);
  for (const [path, entry] of Object.entries(sent)) if (entries[path] && sameValue(keyedWorkingNote(entries[path], store.alias), entry)) delete entries[path];
  localStorage.setItem(workingNotesKey(store.scope), JSON.stringify(entries));
  return keyedEntries(entries, store.alias);
}

export function workingDiff(entries: WorkingNotes): string {
  const raw = (note: NoteItem) => `---\n${YAML.stringify(note.metadata)}---\n${note.content}`;
  return Object.values(entries).map(({ note, base, deleted }) => createUnifiedDiff(note.path, note.path, base ? raw(base) : null, deleted ? null : raw(note))).filter(Boolean).join('\n');
}

/** A working change that deletes the committed note `base`. */
export const deletionEntry = (base: NoteItem): WorkingNote => ({ note: base, base, deleted: true });
