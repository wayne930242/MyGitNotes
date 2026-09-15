import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { GraphDrafts, type GraphSave } from './graph-drafts.js';
import { saveLocalDraft, clearLocalDraft } from './storage.js';
import type { NoteItem } from './types.js';

export function useGraphEditing(scope: string, notes: NoteItem[], writable: boolean, save: GraphSave) {
  const callback = useRef(save); callback.current = save;
  const store = useMemo(() => new GraphDrafts(params => callback.current(params), (value, path) => {
    const key = `graph-draft:${scope}:${path}`;
    if (value) { localStorage.setItem(key, JSON.stringify({ base: value.base, draft: value.draft })); saveLocalDraft(scope, path, value.draft.content, value.draft.metadata); }
    else { localStorage.removeItem(key); clearLocalDraft(scope, path); }
  }), [scope]);
  const version = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const recovered = useRef(new Set<string>());
  useEffect(() => {
    for (const note of notes) {
      const key = `graph-draft:${scope}:${note.path}`;
      if (!recovered.current.has(key)) {
        recovered.current.add(key);
        try { const raw = localStorage.getItem(key); if (raw) { const record = JSON.parse(raw); if (record.base?.path === note.path && typeof record.draft?.content === 'string') store.recover(record.base, record.draft); } } catch { /* Leave an unreadable recovery file intact. */ }
      }
      store.reconcile(note);
    }
  }, [notes, scope, store]);
  useEffect(() => {
    if (!writable) return;
    const timer = setTimeout(() => { for (const [path, entry] of store.entries) if (entry.dirty && !entry.saving && !entry.error) void store.flush(path).catch(() => {}); }, 750);
    return () => clearTimeout(timer);
  }, [version, writable, store]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if ([...store.entries.values()].some(entry => entry.dirty)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, [store]);
  return useMemo(() => ({ store, version, writable }), [store, version, writable]);
}
export type GraphEditing = ReturnType<typeof useGraphEditing>;
