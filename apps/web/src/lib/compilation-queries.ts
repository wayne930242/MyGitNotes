import { useQueries } from '@tanstack/react-query';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import type { NoteListItem, NotePaths, NoteQuery } from '@mygitnotes/core/note-query';
import { notePathsOptions, useNoteList, useNoteLookup, useNotePaths, useNoteQueryScope } from './use-note-queries.js';

/** Whether a dynamic lane follows the order the user set by hand. */
function isManual(row: CompilationRow | undefined): boolean {
  return row?.kind === 'dynamic' && row.sort?.field === 'manual';
}

/** The server query a dynamic lane's membership comes from; its filter mirrors `compilationNotes`. */
export function laneNoteQuery(row: CompilationRow): Partial<NoteQuery> | null {
  if (row.kind !== 'dynamic') return null;
  const source = row.source;
  return { notebookId: row.notebookId, tags: source.kind === 'tag' ? [source.tag] : [], folders: source.kind === 'folder' ? [source.path] : [], descendants: source.kind === 'folder' ? source.recursive : true, status: row.study?.status || null, showHidden: false, sort: !row.sort || row.sort.field === 'manual' ? 'title' : row.sort.field, order: row.sort?.order || 'asc' };
}

export interface LaneNotes {
  notes: NoteListItem[];
  loading: boolean;
  error: string;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}

/**
 * A lane's notes: a dynamic lane queries the server, a custom lane reads its pinned paths.
 * `all` skips paging for a study session, which needs the whole queue to order it.
 */
export function useLaneNotes(row: CompilationRow | undefined, requested: { content?: boolean; all?: boolean; } = {}): LaneNotes {
  // A manual order can place any member first, so it needs every member rather than the first page.
  const options = { ...requested, all: requested.all || isManual(row) };
  const dynamic = row?.kind === 'dynamic' ? laneNoteQuery(row) : null;
  const paged = useNoteList(options.all ? null : dynamic, { content: options.content });
  const allPaths = useNotePaths(options.all ? dynamic : null);
  const pinned = row?.kind === 'custom' ? row.items.flatMap(item => item.kind === 'note' ? [{ notebookId: item.notebookId, path: item.path }] : []) : [];
  const lookupNotes = row?.kind === 'custom' ? pinned : (options.all ? allPaths.notes : []);
  const lookup = useNoteLookup(lookupNotes, Boolean(options.content));
  if (row?.kind === 'custom' || options.all) {
    return { notes: lookup.notes, loading: allPaths.loading || lookup.loading, error: allPaths.error || lookup.error, hasMore: false, loadingMore: false, loadMore: () => {} };
  }
  return { notes: [...paged.uncommitted, ...paged.notes], loading: paged.loading, error: paged.error, hasMore: paged.hasMore, loadingMore: paged.loadingMore, loadMore: paged.loadMore };
}

/** The note paths each lane holds, for views that draw several lanes at once (the graph); a lane stays inside one notebook, where a path names one note. */
export function useLanePaths(rows: CompilationRow[]): { paths: Map<string, string[]>; loading: boolean; error: string; } {
  const scope = useNoteQueryScope();
  const dynamic = rows.filter(row => row.kind === 'dynamic');
  const results = useQueries({ queries: dynamic.map(row => notePathsOptions(scope, laneNoteQuery(row)!)) });
  const paths = new Map<string, string[]>();
  for (const row of rows) {
    if (row.kind === 'custom') paths.set(row.id, row.items.flatMap(item => item.kind === 'note' ? [item.path] : []));
  }
  dynamic.forEach((row, index) => paths.set(row.id, ((results[index]?.data as NotePaths | undefined)?.notes ?? []).map(note => note.path)));
  const failed = results.find(result => result.error);
  return { paths, loading: results.some(result => result.isPending), error: failed?.error instanceof Error ? failed.error.message : '' };
}
