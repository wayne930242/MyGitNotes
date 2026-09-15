import { mergeNote, sameValue } from './merge-note.js';
import type { NoteItem } from './types.js';

export interface GraphDraft { base: NoteItem; draft: NoteItem; dirty: boolean; saving: boolean; error: string; blocked: boolean; past: string[]; future: string[] }
export type GraphSave = (params: { path: string; content: string; metadata: Record<string, unknown>; baseNote: NoteItem; revision?: string; notebookId?: string }) => Promise<NoteItem>;
export class GraphDrafts {
  entries = new Map<string, GraphDraft>();
  private listeners = new Set<() => void>();
  private flights = new Map<string, Promise<void>>();
  version = 0;
  constructor(public save: GraphSave, private persist: (value: GraphDraft | null, path: string) => void) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  private emit() { this.version++; this.listeners.forEach(listener => listener()); }
  get(note: NoteItem): GraphDraft { return this.entries.get(note.path) || { base: note, draft: note, dirty: false, saving: false, error: '', blocked: false, past: [], future: [] }; }
  recover(base: NoteItem, draft: NoteItem) {
    if (this.entries.has(base.path)) return;
    const entry = { ...this.get(base), base, draft, dirty: true };
    this.entries.set(base.path, entry); this.emit();
  }
  edit(note: NoteItem, content: string, history = true) {
    const entry = this.get(note);
    if (entry.blocked || content === entry.draft.content) return;
    if (history) { entry.past = [...entry.past.slice(-99), entry.draft.content]; entry.future = []; }
    entry.draft = { ...entry.draft, content }; entry.dirty = true; entry.error = '';
    this.entries.set(note.path, entry); this.persist(entry, note.path); this.emit();
  }
  undo(note: NoteItem, redo = false) {
    const entry = this.get(note), source = redo ? entry.future : entry.past;
    if (!source.length || entry.blocked) return;
    const next = source.pop()!;
    (redo ? entry.past : entry.future).push(entry.draft.content);
    this.edit(note, next, false);
  }
  reconcile(latest: NoteItem) {
    const entry = this.entries.get(latest.path);
    if (!entry || entry.saving || entry.blocked || latest.content === entry.base.content && sameValue(latest.metadata, entry.base.metadata)) return;
    const result = mergeNote(entry.base, entry.draft, latest);
    if (result.conflict) { entry.blocked = true; entry.error = '遠端內容與草稿衝突，草稿已保留。請先處理衝突。'; }
    else { entry.base = latest; entry.draft = { ...latest, ...result.draft }; entry.dirty = entry.draft.content !== latest.content || !sameValue(entry.draft.metadata, latest.metadata); }
    this.persist(entry.dirty ? entry : null, latest.path); this.emit();
  }
  async flush(path: string): Promise<void> {
    const flight = this.flights.get(path); if (flight) return flight;
    const entry = this.entries.get(path);
    if (!entry?.dirty) return;
    if (entry.blocked) throw Error(entry.error);
    const sent = entry.draft, base = entry.base;
    entry.saving = true; entry.error = ''; this.emit();
    const promise = (async () => {
      try {
        const saved = await this.save({ path, content: sent.content, metadata: sent.metadata, baseNote: base, revision: base.revision, notebookId: sent.notebookId });
        const latest = this.entries.get(path)!;
        const changedWhileSaving = latest.draft.content !== sent.content;
        latest.base = saved;
        latest.draft = changedWhileSaving ? { ...saved, content: latest.draft.content } : saved;
        latest.dirty = changedWhileSaving;
        this.persist(latest.dirty ? latest : null, path);
      } catch (error) { entry.error = (error as Error).message; this.persist(entry, path); throw error; }
      finally { entry.saving = false; this.flights.delete(path); this.emit(); }
    })();
    this.flights.set(path, promise); return promise;
  }
  async flushAll() {
    for (const [path, entry] of this.entries) {
      while (entry.dirty) await this.flush(path);
    }
  }
}
