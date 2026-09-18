import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NoteItem } from './types.js';
import type { NoteEditorSharedProps } from '../components/NoteEditor.js';

type Flush = () => Promise<boolean>;

/** Zoom shows a note with its own editor, or with the editor of the host that owns it moved into `slot`. */
export interface ZoomState { path: string; borrowed: boolean; slot: HTMLElement | null }

/**
 * Places that can show a note's editor: Focus panes and graph cards. A note has one mounted editor,
 * owned by the first registered host of its path; the others show a preview until they claim it.
 */
export class NoteHosts {
  private hosts = new Map<string, string[]>();
  private listeners = new Set<() => void>();
  private version = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  private emit() { this.version++; this.listeners.forEach(listener => listener()); }
  owner(path: string): string | undefined { return this.hosts.get(path)?.[0]; }
  register(path: string, id: string) {
    const ids = this.hosts.get(path) ?? [];
    if (ids.includes(id)) return;
    this.hosts.set(path, [...ids, id]); this.emit();
  }
  release(path: string, id: string) {
    const ids = (this.hosts.get(path) ?? []).filter(other => other !== id);
    if (ids.length) this.hosts.set(path, ids); else this.hosts.delete(path);
    this.emit();
  }
  /** Makes `id` the owner; it must be registered for `path`. */
  claim(path: string, id: string) {
    const ids = this.hosts.get(path) ?? [];
    if (!ids.includes(id) || ids[0] === id) return;
    this.hosts.set(path, [id, ...ids.filter(other => other !== id)]); this.emit();
  }
}

interface NoteEditingValue {
  /** Props every editor of `note` shares; `committed` is the note's committed version when it has a staged draft. */
  editorProps: (note: NoteItem, committed?: NoteItem) => NoteEditorSharedProps;
  hosts: NoteHosts;
  /** Saves the current owner's edits and refreshes the notes, then hands `path` to host `id`; false when the save failed. */
  claimEditor: (path: string, id: string) => Promise<boolean>;
  /** Saves the mounted editors of `paths`, or all of them; false when one could not be saved. */
  flushEditors: (paths?: readonly string[]) => Promise<boolean>;
  /** Settles the note queries, so a host that opens an editor reads the notes as saved. */
  refreshNotes: () => Promise<void>;
  zoom: ZoomState | null;
  setZoom: (zoom: ZoomState | null) => void;
  closeZoom: () => void;
  /** The Add to Focus action for `note`, or undefined when it cannot join a Focus. */
  addToFocus: (note: NoteItem) => (() => void) | undefined;
}

const NoteEditingContext = createContext<NoteEditingValue | null>(null);
const RegistryContext = createContext<(path: string, flush: Flush) => () => void>(() => () => {});

export function useNoteEditing(): NoteEditingValue {
  const context = useContext(NoteEditingContext);
  if (!context) throw new Error('useNoteEditing must be used within a NoteEditingProvider');
  return context;
}
/** Lets a mounted editor offer its pending edits to `flushEditors`. */
export const useEditorRegistry = () => useContext(RegistryContext);

/** Tracks mounted editors so a caller can save their pending edits before it unmounts them. */
export function useNoteEditorRegistry() {
  const editors = useRef(new Set<{ path: string; flush: Flush }>());
  const register = useCallback((path: string, flush: Flush) => {
    const entry = { path, flush };
    editors.current.add(entry);
    return () => { editors.current.delete(entry); };
  }, []);
  /** Saves the editors of `paths`, or all of them; false when one could not be saved. */
  const flushEditors = useCallback(async (paths?: readonly string[]) => {
    for (const entry of [...editors.current]) {
      if (paths && !paths.includes(entry.path)) continue;
      if (!await entry.flush()) return false;
    }
    return true;
  }, []);
  return { register, flushEditors };
}

export function NoteEditingProvider({ register, children, ...value }: Omit<NoteEditingValue, 'zoom' | 'setZoom' | 'hosts' | 'claimEditor'> & {
  register: (path: string, flush: Flush) => () => void; children: ReactNode;
}) {
  const [zoom, setZoom] = useState<ZoomState | null>(null);
  const [hosts] = useState(() => new NoteHosts());
  const { editorProps, flushEditors, refreshNotes, closeZoom, addToFocus } = value;
  // The claiming host opens its editor from the notes it reads, so a save's refetch lands first.
  const claimEditor = useCallback(async (path: string, id: string) => {
    if (!await flushEditors([path])) return false;
    await refreshNotes();
    hosts.claim(path, id);
    return true;
  }, [flushEditors, refreshNotes, hosts]);
  const context = useMemo(() => ({ editorProps, hosts, claimEditor, flushEditors, refreshNotes, closeZoom, addToFocus, zoom, setZoom }),
    [editorProps, hosts, claimEditor, flushEditors, refreshNotes, closeZoom, addToFocus, zoom]);
  return <RegistryContext.Provider value={register}>
    <NoteEditingContext.Provider value={context}>{children}</NoteEditingContext.Provider>
  </RegistryContext.Provider>;
}
