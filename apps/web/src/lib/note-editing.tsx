import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { NoteItem } from './types.js';
import type { NoteEditorSharedProps } from '../components/note-editor/types.js';

type Flush = () => Promise<boolean>;

/** Zoom shows a note with its own editor, or with the editor of the host that owns it moved into `slot`. */
export interface ZoomState {
  /** The zoomed note's `noteRefKey`. */
  key: string;
  borrowed: boolean;
  slot: HTMLElement | null;
}

/**
 * Places that can show a note's editor: Focus panes and graph cards. A note has one mounted editor,
 * owned by the first registered host of its `noteRefKey`; the others show a preview until they claim it.
 */
export class NoteHosts {
  private hosts = new Map<string, string[]>();
  private listeners = new Set<() => void>();
  private version = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach(listener => listener());
  }
  owner(key: string): string | undefined {
    return this.hosts.get(key)?.[0];
  }
  register(key: string, id: string) {
    const ids = this.hosts.get(key) ?? [];
    if (ids.includes(id)) return;
    this.hosts.set(key, [...ids, id]);
    this.emit();
  }
  release(key: string, id: string) {
    const ids = (this.hosts.get(key) ?? []).filter(other => other !== id);
    if (ids.length) this.hosts.set(key, ids);
    else this.hosts.delete(key);
    this.emit();
  }
  /** Makes `id` the owner; it must be registered for `key`. */
  claim(key: string, id: string) {
    const ids = this.hosts.get(key) ?? [];
    if (!ids.includes(id) || ids[0] === id) return;
    this.hosts.set(key, [id, ...ids.filter(other => other !== id)]);
    this.emit();
  }
}

interface NoteEditingValue {
  /** Props every editor of `note` shares; `committed` is the note's committed version when it has a staged draft. */
  editorProps: (note: NoteItem, committed?: NoteItem) => NoteEditorSharedProps;
  hosts: NoteHosts;
  /** Saves the current owner's edits and refreshes the notes, then hands the note `key` to host `id`; false when the save failed. */
  claimEditor: (key: string, id: string) => Promise<boolean>;
  /** Saves the mounted editors of the notes `keys` name (`noteRefKey`), or all of them; false when one could not be saved. */
  flushEditors: (keys?: readonly string[]) => Promise<boolean>;
  /** Settles the note queries, so a host that opens an editor reads the notes as saved. */
  refreshNotes: () => Promise<void>;
  zoom: ZoomState | null;
  setZoom: (zoom: ZoomState | null) => void;
  closeZoom: () => void;
  /** The Add to Focus action for `note`, or undefined when it cannot join a Focus. */
  addToFocus: (note: NoteItem) => (() => void) | undefined;
  /** The Move to folder action for `note`, or undefined when its notebook is read-only. */
  moveNote?: (note: NoteItem) => (() => void) | undefined;
}

const NoteEditingContext = createContext<NoteEditingValue | null>(null);
const RegistryContext = createContext<(key: string, flush: Flush) => () => void>(() => () => {});

export function useNoteEditing(): NoteEditingValue {
  const context = useContext(NoteEditingContext);
  if (!context) throw new Error('useNoteEditing must be used within a NoteEditingProvider');
  return context;
}
/** Lets a mounted editor offer its pending edits to `flushEditors`, under its note's `noteRefKey`. */
export const useEditorRegistry = () => useContext(RegistryContext);

/** Tracks mounted editors so a caller can save their pending edits before it unmounts them. */
export function useNoteEditorRegistry() {
  const editors = useRef(new Set<{ key: string; flush: Flush; }>());
  const register = useCallback((key: string, flush: Flush) => {
    const entry = { key, flush };
    editors.current.add(entry);
    return () => {
      editors.current.delete(entry);
    };
  }, []);
  /** Saves the editors of the notes `keys` name, or all of them; false when one could not be saved. */
  const flushEditors = useCallback(async (keys?: readonly string[]) => {
    /* eslint-disable unicorn/no-useless-spread -- Snapshot the collection because callbacks may mutate subscriptions or editors during iteration. */
    for (const entry of [...editors.current]) {
      if (keys && !keys.includes(entry.key)) continue;
      if (!await entry.flush()) return false;
    }
    /* eslint-enable unicorn/no-useless-spread */
    return true;
  }, []);
  return { register, flushEditors };
}

export function NoteEditingProvider({ register, children, ...value }: Omit<NoteEditingValue, 'zoom' | 'setZoom' | 'hosts' | 'claimEditor'> & { register: (key: string, flush: Flush) => () => void; children: ReactNode; }) {
  const [zoom, setZoom] = useState<ZoomState | null>(null);
  const [hosts] = useState(() => new NoteHosts());
  const { editorProps, flushEditors, refreshNotes, closeZoom, addToFocus, moveNote } = value;
  const claims = useRef(new Map<string, Promise<boolean>>());
  // The claiming host opens its editor from the notes it reads, so a save's refetch lands first.
  // Claims for the same note are chained: a claim never runs its own flush and refresh until
  // the previous claim for that note has settled, so concurrent claims cannot land out of order.
  const claimEditor = useCallback((key: string, id: string) => {
    const queued = (claims.current.get(key) ?? Promise.resolve(true)).catch(() => false).then(async () => {
      // A failed flush or refresh leaves the current owner in place.
      try {
        if (!await flushEditors([key])) return false;
        await refreshNotes();
      } catch {
        return false;
      }
      hosts.claim(key, id);
      return true;
    });
    claims.current.set(key, queued);
    queued.finally(() => {
      if (claims.current.get(key) === queued) claims.current.delete(key);
    });
    return queued;
  }, [flushEditors, refreshNotes, hosts]);
  const context = useMemo(() => ({ editorProps, hosts, claimEditor, flushEditors, refreshNotes, closeZoom, addToFocus, moveNote, zoom, setZoom }), [editorProps, hosts, claimEditor, flushEditors, refreshNotes, closeZoom, addToFocus, moveNote, zoom]);
  return (
    <RegistryContext.Provider value={register}>
      <NoteEditingContext.Provider value={context}>{children}</NoteEditingContext.Provider>
    </RegistryContext.Provider>
  );
}
