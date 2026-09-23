import { useCallback, useState } from 'react';
import type { TagOperationPlan } from '@mygitnotes/core/tag-ops';

export type TagOperationKind = 'rename' | 'merge' | 'delete' | 'add' | 'remove';

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
