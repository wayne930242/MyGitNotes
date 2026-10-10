import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { useNoteEditing } from './note-editing.js';

/** The note slot an open compilation edits: a Book section or a lane card, and the note's `noteRefKey`. */
export interface EditingSlot {
  /** The card or section id: an item id, plus the note path for a folder sub-section. */
  slot: string;
  key: string;
}

export interface CompilationEditing {
  editing: EditingSlot | null;
  /** Saves the slot being edited, then edits `next`; false (and nothing changes) when that save failed. */
  start: (next: EditingSlot) => Promise<boolean>;
  /** Saves the slot being edited and returns it to reading; false (and the slot keeps editing) when that save failed. */
  finish: () => Promise<boolean>;
}

/**
 * The editing state of one open compilation: at most one slot edits at a time, across arrangements. A slot
 * only gives way once its note is saved, so a failed save keeps the slot in edit mode with the editor's notice.
 */
export function useCompilationEditing(): CompilationEditing {
  const { flushEditors, refreshNotes } = useNoteEditing();
  const [editing, setEditing] = useState<EditingSlot | null>(null);
  const current = useRef<EditingSlot | null>(null);
  // Requests run one after another, so two quick clicks cannot both save and then both win.
  const queue = useRef<Promise<boolean> | Promise<void>>(Promise.resolve());
  const commit = useCallback((next: EditingSlot | null) => {
    current.current = next;
    setEditing(next);
  }, []);
  const switchTo = useCallback((next: EditingSlot | null) => {
    const result = (async () => {
      await queue.current;
      const from = current.current;
      try {
        if (from && from.slot !== next?.slot) {
          if (!await flushEditors([from.key])) return false;
          // The reading view of the slot just left shows the note as saved.
          try {
            await refreshNotes();
          } catch {
            // The editor's own save already succeeded; a stale reading view heals on the next refresh.
          }
        }
      } catch {
        return false;
      }
      commit(next);
      return true;
    })();
    queue.current = result;
    return result;
  }, [commit, flushEditors, refreshNotes]);
  const start = useCallback((next: EditingSlot) => switchTo(next), [switchTo]);
  const finish = useCallback(() => switchTo(null), [switchTo]);
  return useMemo(() => ({ editing, start, finish }), [editing, start, finish]);
}

const CompilationEditingContext = createContext<CompilationEditing | null>(null);
export const CompilationEditingProvider = CompilationEditingContext.Provider;

/** The open compilation's editing state; a note slot only exists inside one. */
export function useCompilationEditingContext(): CompilationEditing {
  const context = useContext(CompilationEditingContext);
  if (!context) throw new Error('useCompilationEditingContext must be used within a CompilationEditingProvider');
  return context;
}

/**
 * The order of `items` while a slot edits (E11): the order they had when editing began, members that arrive
 * appended, members that left kept, each as the latest copy there is. With nothing held, `items` as they are.
 */
export function holdOrder<T extends { id: string; }>(items: readonly T[], held: readonly T[] | null): T[] {
  if (!held) return [...items];
  const live = new Map(items.map(item => [item.id, item]));
  const kept = held.map(item => live.get(item.id) ?? item);
  const known = new Set(held.map(item => item.id));
  return [...kept, ...items.filter(item => !known.has(item.id))];
}

/** `items` in the order `holdOrder` keeps while the open compilation edits a slot, and as they are otherwise. */
export function useHeldOrder<T extends { id: string; }>(items: readonly T[]): T[] {
  const { editing } = useCompilationEditingContext();
  const [held, setHeld] = useState<readonly T[] | null>(null);
  // Derived while rendering, so the order captured is the one on screen when editing began.
  if (editing && !held) setHeld(items);
  else if (!editing && held) setHeld(null);
  return holdOrder(items, editing ? held : null);
}

/**
 * `notes` in the order and with the copies `useHeldOrder` keeps while a slot edits. A note's `id` is not unique
 * across folders and notebooks (two `index.md`), so they are held under their repository key.
 */
export function useHeldNotes<T extends { notebookId: string; path: string; }>(notes: readonly T[]): T[] {
  return useHeldOrder(notes.map(note => ({ id: noteRefKey(note), note }))).map(held => held.note);
}
