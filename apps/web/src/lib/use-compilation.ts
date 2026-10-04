import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type CompilationPage, type CompilationRow, compilationSlug, uniqueCompilationPath } from '@mygitnotes/core/compilation';
import { type NoteListItem, type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import { useCompilationActions } from './compilation-actions.js';
import { compilationMetadata, compilationText, parseCompilationNote, type ParsedCompilation, planCompilationWrites } from './compilation-rows.js';
import { useEditorRegistry } from './note-editing.js';
import { useNoteList, useNoteLookup } from './use-note-queries.js';
import type { NotebookConfig } from './types.js';

/** The pause after the last edit before a compilation file is written. */
const WRITE_DELAY = 350;

/** What a view of compilations holds: the rows, and `change` to write the difference back. */
export interface CompilationController {
  page: CompilationPage;
  /** Files that do not open, with the reason. */
  invalid: ParsedCompilation[];
  /** Replaces the rows; changed rows are written, new rows created and missing rows deleted. */
  change: (next: CompilationPage) => void;
  /** Writes what is waiting and resolves once nothing is in flight. */
  save: () => Promise<void>;
  loading: boolean;
  saving: boolean;
  error: string;
  setError: (message: string) => void;
  /** Whether every compilation shown may be written. */
  writable: boolean;
}

interface ControllerInput {
  entries: NoteListItem[];
  notebooks: readonly NotebookConfig[];
  loading: boolean;
  error: string;
  /** Registers the pending writes with the editors that are saved before the page unmounts. */
  registryKey: string;
  /** Where a new row's file goes; without it a view cannot add rows. */
  newPath?: (row: CompilationRow, taken: ReadonlySet<string>) => string;
}

/** Keeps edits made to rows as pending until the stored files show them, writes them after a pause, and reports failures. */
function useCompilationController({ entries, notebooks, loading, error: loadError, registryKey, newPath }: ControllerInput): CompilationController {
  const actions = useCompilationActions();
  const register = useEditorRegistry();
  const parsed = useMemo(() => entries.map(entry => parseCompilationNote(entry, notebooks)), [entries, notebooks]);
  const stored = useMemo(() => parsed.flatMap(entry => entry.row ? [entry.row] : []), [parsed]);
  // Rows edited here and not yet seen in the stored files; null stands for a deleted file.
  const [pending, setPending] = useState<Record<string, CompilationRow | null>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const rows = useMemo(() => {
    const result = stored.filter(row => pending[row.path] !== null).map(row => pending[row.path] ?? row);
    const known = new Set(stored.map(row => row.path));
    for (const [path, row] of Object.entries(pending)) if (row && !known.has(path)) result.push(row);
    return result;
  }, [stored, pending]);

  const latest = useRef({ pending, stored, entries, rows, actions, newPath });
  /* eslint-disable react/refs -- The write timer and the unmount flush read the newest state without restarting. */
  latest.current = { pending, stored, entries, rows, actions, newPath };
  /* eslint-enable react/refs */
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inflight = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(new Map<string, CompilationRow | null>());

  // A pending edit ends once the stored file shows it.
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Pending edits are settled against the stored files after each query answer. */
    setPending(current => {
      let changed = false;
      const next: Record<string, CompilationRow | null> = {};
      for (const [path, row] of Object.entries(current)) {
        const file = stored.find(candidate => candidate.path === path);
        const settled = row === null ? !file : Boolean(file) && compilationText(file!) === compilationText(row) && !queued.current.has(path);
        if (settled) changed = true;
        else next[path] = row;
      }
      return changed ? next : current;
    });
    /* eslint-enable react/set-state-in-effect */
  }, [stored]);

  const write = useCallback(async () => {
    const batch = [...queued.current];
    queued.current.clear();
    if (!batch.length) return;
    const { stored: existing, entries: listed, actions: api } = latest.current;
    const failed: string[] = [];
    for (const [path, row] of batch) {
      try {
        const entry = listed.find(candidate => candidate.path === path);
        if (row === null) {
          if (entry) await api.remove(entry);
        } else if (existing.some(candidate => candidate.path === path)) await api.save({ path, notebookId: row.notebookId }, compilationText(row), compilationMetadata(row));
        else await api.create(row.notebookId, path, compilationText(row), compilationMetadata(row));
      } catch (caught) {
        failed.push(path);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
    if (failed.length) setPending(current => Object.fromEntries(Object.entries(current).filter(([path]) => !failed.includes(path))));
  }, []);
  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setSaving(true);
    inflight.current = inflight.current.then(write).finally(() => {
      if (!queued.current.size && !timer.current) setSaving(false);
    });
    return inflight.current;
  }, [write]);
  const save = useCallback(async () => {
    await flush();
  }, [flush]);

  const change = useCallback((next: CompilationPage) => {
    const { rows: current, actions: api, newPath: placeNew } = latest.current;
    const writes = planCompilationWrites(current, next.rows);
    if (!writes.save.length && !writes.create.length && !writes.remove.length) return;
    const taken = new Set([...current.map(row => row.path), ...Object.keys(latest.current.pending)]);
    const created = writes.create.flatMap(row => {
      if (row.path) return [row];
      if (!placeNew) return [];
      const path = placeNew(row, taken);
      taken.add(path);
      return [{ ...row, path }];
    });
    const updates: Record<string, CompilationRow | null> = {};
    for (const row of [...writes.save, ...created]) {
      if (!api.canWrite(row.notebookId)) continue;
      updates[row.path] = row;
      queued.current.set(row.path, row);
    }
    for (const path of writes.remove) {
      updates[path] = null;
      queued.current.set(path, null);
    }
    setPending(previous => ({ ...previous, ...updates }));
    setError('');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), WRITE_DELAY);
  }, [flush]);

  // Edits waiting for the pause are written before the view goes away, and before the app saves its editors.
  useEffect(() =>
    register(registryKey, async () => {
      if (!queued.current.size) return true;
      await flush();
      return !queued.current.size;
    }), [register, registryKey, flush]);
  useEffect(() => () => {
    if (queued.current.size) void flush();
  }, [flush]);

  const writable = rows.length > 0 ? rows.every(row => actions.canWrite(row.notebookId)) : false;
  return { page: { rows }, invalid: parsed.filter(entry => entry.error), change, save, loading, saving, error: error || loadError, setError, writable };
}

/**
 * Every compilation of `notebookId`, for views that draw several at once (the graph page): the rows
 * come from the same query as the left pane, with the files' content, and new rows need a `path`.
 */
export function useCompilations(notebookId: string, notebooks: readonly NotebookConfig[]): CompilationController {
  const list = useNoteList({ notebookId, kind: 'compilation', showHidden: true, sort: 'title', order: 'asc' }, { content: true });
  const { hasMore, loadingMore, loadMore } = list;
  useEffect(() => {
    if (hasMore && !loadingMore) loadMore();
  }, [hasMore, loadingMore, loadMore]);
  const entries = useMemo(() => [...list.notes, ...list.uncommitted], [list.notes, list.uncommitted]);
  const newPath = useCallback((row: CompilationRow, taken: ReadonlySet<string>) => {
    const notebook = notebooks.find(candidate => candidate.id === row.notebookId);
    if (!notebook) throw new Error(`Notebook ${row.notebookId} is not configured.`);
    return newCompilationPath(notebook, row.name, path => taken.has(path));
  }, [notebooks]);
  return useCompilationController({ entries, notebooks, loading: list.loading || hasMore, error: list.error, registryKey: `compilations:${notebookId}`, newPath });
}

/** The path a new compilation named `name` is written to in the root of `notebook`, unused by the rows shown. */
export function newCompilationPath(notebook: Pick<NotebookConfig, 'root'>, name: string, taken: (path: string) => boolean, folder = ''): string {
  return uniqueCompilationPath([notebook.root.replace(/\/$/, ''), folder.replace(/^\/|\/$/g, '')].filter(Boolean).join('/'), compilationSlug(name), taken);
}

/** One open compilation, read with its content: `page.rows` holds its row, or `invalid` says why it does not open. */
export function useCompilation(ref: NoteRef, notebooks: readonly NotebookConfig[]): CompilationController & { note: NoteListItem | undefined; missing: boolean; } {
  const lookup = useNoteLookup([ref], true);
  const entries = useMemo(() => lookup.notes, [lookup.notes]);
  const controller = useCompilationController({ entries, notebooks, loading: lookup.loading, error: lookup.error, registryKey: noteRefKey(ref) });
  return { ...controller, note: entries[0], missing: !lookup.loading && !lookup.error && entries.length === 0 };
}
