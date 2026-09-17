import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { GraphDrafts, type GraphSave } from './graph-drafts.js';
import { saveLocalDraft, clearLocalDraft } from './storage.js';
import type { NoteItem } from './types.js';
import { useNoteLookup } from './use-note-queries.js';

const draftPrefix = (scope: string) => `graph-draft:${scope}:`;

export function useGraphEditing(scope: string, writable: boolean, save: GraphSave) {
  const callback = useRef(save); callback.current = save;
  const store = useMemo(() => new GraphDrafts(params => callback.current(params), (value, path) => {
    const key = `${draftPrefix(scope)}${path}`;
    if (value) { localStorage.setItem(key, JSON.stringify({ base: value.base, draft: value.draft })); saveLocalDraft(scope, path, value.draft.content, value.draft.metadata); }
    else { localStorage.removeItem(key); clearLocalDraft(scope, path); }
  }), [scope]);
  const version = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  // Drafts saved before a reload name their own notes; nothing holds a full note list any more.
  useEffect(() => {
    const prefix = draftPrefix(scope);
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const record = JSON.parse(localStorage.getItem(key) || 'null');
        if (record?.base?.path === key.slice(prefix.length) && typeof record.draft?.content === 'string') store.recover(record.base, record.draft);
      }
    } catch { /* Leave an unreadable recovery file intact. */ }
  }, [scope, store]);
  // Only notes that carry a draft are reconciled.
  const draftPaths = useMemo(() => [...store.entries.keys()], [store, version]);
  const lookup = useNoteLookup(draftPaths, true);
  useEffect(() => {
    // Reconciling uses the overlaid note on purpose: after a remote save the draft's merge base
    // IS the staged working note, so feeding the committed file in as "the latest version" would
    // make diff3 treat the staged edit as an outdated ancestor and drop it.
    for (const note of lookup.notes) if (typeof note.content === 'string') store.reconcile(note as NoteItem);
  }, [lookup.notes, store]);
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
