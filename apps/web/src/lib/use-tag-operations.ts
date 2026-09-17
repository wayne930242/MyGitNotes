import { useCallback, useState } from 'react';
import type { TagOperationPlan } from '@mygitnotes/core/tag-ops';
import { NoteItem } from './types.js';

export type TagOperationKind = 'rename' | 'merge' | 'delete';

export interface TagOperationRecord {
  id: string;
  kind: TagOperationKind;
  label: string;
  plan: TagOperationPlan;
}

let nextRecordId = 0;

/** Prepend a record built from a just-applied plan. Pure, so it is easy to test without React. */
export function pushTagOperationRecord(history: TagOperationRecord[], kind: TagOperationKind, label: string, plan: TagOperationPlan): TagOperationRecord[] {
  return [{ id: `tag-op-${++nextRecordId}`, kind, label, plan }, ...history];
}

/** Sets each matching note's `tags` (and mirrored `metadata.tags`) from `entries`; leaves other notes untouched. */
export function applyTagEntriesToNotes(notes: NoteItem[], entries: { path: string; notebookId: string; tags: string[] }[]): NoteItem[] {
  if (entries.length === 0) return notes;
  const byKey = new Map(entries.map(entry => [`${entry.notebookId}:${entry.path}`, entry.tags]));
  return notes.map(note => {
    const tags = byKey.get(`${note.notebookId}:${note.path}`);
    if (!tags) return note;
    return { ...note, tags, metadata: { ...note.metadata, tags } };
  });
}

/**
 * Session-lifetime history of tag operations, each independently undoable until page reload.
 * A record is only dismissed once its undo has actually been applied (see App.tsx's
 * handleUndoTagOperation) — a failed undo attempt keeps the record so the user can retry.
 */
export function useTagOperations() {
  const [history, setHistory] = useState<TagOperationRecord[]>([]);

  const record = useCallback((kind: TagOperationKind, label: string, plan: TagOperationPlan) => {
    setHistory(previous => pushTagOperationRecord(previous, kind, label, plan));
  }, []);

  const dismiss = useCallback((id: string) => {
    setHistory(previous => previous.filter(entry => entry.id !== id));
  }, []);

  return { history, record, dismiss };
}
