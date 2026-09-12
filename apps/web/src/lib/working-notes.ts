import YAML from 'yaml';
import type { NoteItem } from './types.js';
import { sameValue } from './merge-note.js';

export interface WorkingNote { note: NoteItem; base: NoteItem | null; blocked?: string }
export type WorkingNotes = Record<string, WorkingNote>;
const prefix = 'gh_notes_working:';
export const workingNotesKey = (scope: string) => prefix + scope;

export function readWorkingNotes(scope: string): WorkingNotes {
  const raw = localStorage.getItem(workingNotesKey(scope));
  if (!raw) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Local working changes could not be read. Keep browser data for recovery.');
  return value;
}

/** Persist before announcing success; quota errors leave the in-memory draft visible. */
export function updateWorkingNote(scope: string, path: string, entry: WorkingNote | null): WorkingNotes {
  const entries = readWorkingNotes(scope);
  if (entry?.base && !entry.blocked && sameValue(entry.note.content, entry.base.content) && sameValue(entry.note.metadata, entry.base.metadata)) entry = null;
  if (entry) entries[path] = entry; else delete entries[path];
  localStorage.setItem(workingNotesKey(scope), JSON.stringify(entries));
  return entries;
}

/** Clear only the committed version, preserving any edit made during the request. */
export function clearCommittedNotes(scope: string, sent: WorkingNotes): WorkingNotes {
  const entries = readWorkingNotes(scope);
  for (const [path, entry] of Object.entries(sent)) if (sameValue(entries[path], entry)) delete entries[path];
  localStorage.setItem(workingNotesKey(scope), JSON.stringify(entries));
  return entries;
}

export function overlayWorkingNotes(notes: NoteItem[], entries: WorkingNotes): NoteItem[] {
  const byPath = new Map(notes.map(note => [note.path, note]));
  for (const entry of Object.values(entries)) byPath.set(entry.note.path, entry.note);
  return [...byPath.values()];
}

export function workingDiff(entries: WorkingNotes): string {
  const raw = (note: NoteItem) => `---\n${YAML.stringify(note.metadata)}---\n${note.content}`;
  return Object.values(entries).map(({ note, base }) => {
    const before = base ? raw(base).split('\n') : [];
    const after = raw(note).split('\n');
    return `--- ${base ? note.path : '/dev/null'}\n+++ ${note.path}\n@@ -1,${before.length} +1,${after.length} @@\n${before.map(line => '-' + line).join('\n')}\n${after.map(line => '+' + line).join('\n')}`;
  }).join('\n\n');
}
