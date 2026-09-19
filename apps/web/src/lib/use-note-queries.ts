import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { keepPreviousData, type QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { DEFAULT_NOTE_QUERY } from '@mygitnotes/core/note-query';
import type { NoteAgenda, NotebookFacets, NoteFacets, NoteListItem, NoteQuery, NoteQueryPage } from '@mygitnotes/core/note-query';
import type { NoteGraphData } from '@mygitnotes/core/note-graph';
import { ApiError } from './api.js';
import { fetchNoteAgenda, fetchNoteFacets, fetchNoteGraph, fetchNotePaths, fetchNoteQuery, lookupNotes } from './notes-api.js';
import { draftGraphNotes, overlayDraftAgenda, overlayDraftFacets, overlayDraftLookup, overlayDraftPaths, overlayDraftRows, overlayGraphDrafts } from './draft-overlay.js';
import { sameValue } from './merge-note.js';
import type { WorkingNotes } from './working-notes.js';

/**
 * Every note query is answered by the server for one workspace revision, so the source and
 * revision belong in each key: a commit or refresh changes them and the views refetch, while
 * local drafts are overlaid on the answers instead of invalidating them.
 */
export interface NoteQueryScope {
  sourceId: string;
  revision: string;
  drafts: WorkingNotes;
}

const EMPTY_DRAFTS: WorkingNotes = {};
let currentScope: NoteQueryScope = { sourceId: '', revision: '', drafts: EMPTY_DRAFTS };
const listeners = new Set<() => void>();
const readScope = () => currentScope;

/** Publishes the workspace identity every note query runs against; components read it through `useNoteQueryScope`. */
export function setNoteQueryScope(next: NoteQueryScope): void {
  if (currentScope.sourceId === next.sourceId && currentScope.revision === next.revision && currentScope.drafts === next.drafts) return;
  currentScope = next;
  /* eslint-disable unicorn/no-useless-spread -- Snapshot the collection because callbacks may mutate subscriptions or editors during iteration. */
  for (const listener of [...listeners]) listener();
  /* eslint-enable unicorn/no-useless-spread */
}

export function useNoteQueryScope(): NoteQueryScope {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    readScope,
    readScope,
  );
}

/**
 * `revision` is a consistency token: the server answers from the branch head and rejects a
 * request that names another one (409), as it rejects a cursor from another query (400).
 * Both mean the same thing here — refresh the workspace and restart the lists from page one.
 */
const staleListeners = new Set<(message: string) => void>();
let lastStaleReport = 0;

export function handleNoteQueryError(error: unknown, query: { queryKey: readonly unknown[]; state: { data?: unknown; }; }): void {
  if (query.queryKey[0] !== NOTE_QUERY_KEY[0]) return;
  const status = error instanceof ApiError ? error.status : 0;
  const loadedPages = (query.state.data as { pages?: unknown[]; } | undefined)?.pages?.length ?? 0;
  // A 400 on a first page is a malformed query, not a stale cursor; restarting it would loop.
  if (status !== 409 && !(status === 400 && loadedPages > 0)) return;
  if (Date.now() - lastStaleReport < 2000) return;
  lastStaleReport = Date.now();
  const message = error instanceof Error ? error.message : '';
  /* eslint-disable unicorn/no-useless-spread -- Snapshot the collection because callbacks may mutate subscriptions or editors during iteration. */
  for (const listener of [...staleListeners]) listener(message);
  /* eslint-enable unicorn/no-useless-spread */
}

/** Runs when a note query was answered for another repository state. */
export function useStaleNoteQueries(handler: (message: string) => void): void {
  const latest = useRef(handler);
  /* eslint-disable react/refs -- Stable query values and current event handlers use refs to preserve subscription identity. */
  latest.current = handler;
  /* eslint-enable react/refs */
  useEffect(() => {
    const listener = (message: string) => latest.current(message);
    staleListeners.add(listener);
    return () => {
      staleListeners.delete(listener);
    };
  }, []);
}

export const NOTE_QUERY_KEY = ['notes'] as const;
export const NOTE_PAGE_SIZE = 50;
/** Local writes keep the same (empty) revision, so their queries are refetched explicitly. */
export const invalidateNoteQueries = (client: QueryClient) => client.invalidateQueries({ queryKey: NOTE_QUERY_KEY });

export const noteQueryInput = (query: Partial<NoteQuery>): NoteQuery => ({ ...DEFAULT_NOTE_QUERY, ...query });
const queryKey = (scope: NoteQueryScope, kind: string, params: unknown) => [...NOTE_QUERY_KEY, scope.sourceId, scope.revision, kind, params];
const errorText = (error: unknown) => error instanceof Error ? error.message : error ? String(error) : '';
const revisionOf = (scope: NoteQueryScope) => scope.revision || undefined;

/** Keeps a deeply equal value identical across renders, so inline query objects do not restart queries. */
function useStable<T>(value: T): T {
  const held = useRef(value);
  /* eslint-disable react/refs -- Stable query values and current event handlers use refs to preserve subscription identity. */
  if (!sameValue(held.current as unknown, value as unknown)) held.current = value;
  /* eslint-enable react/refs */
  /* eslint-disable react/refs -- Stable query values and current event handlers use refs to preserve subscription identity. */
  return held.current;
  /* eslint-enable react/refs */
}

export function noteLookupOptions(scope: NoteQueryScope, paths: string[], content: boolean) {
  const unique = [...new Set(paths)];
  return { queryKey: queryKey(scope, 'lookup', { paths: unique, content }), queryFn: () => lookupNotes(unique, { content, revision: revisionOf(scope) }), enabled: unique.length > 0 && Boolean(scope.sourceId) };
}

/** One page of a query, for callers that read outside React rendering. */
export function notePageOptions(scope: NoteQueryScope, query: Partial<NoteQuery>, options: { limit?: number; content?: boolean; } = {}) {
  const input = noteQueryInput(query);
  return { queryKey: queryKey(scope, 'page', { query: input, limit: options.limit ?? NOTE_PAGE_SIZE, content: Boolean(options.content) }), queryFn: () => fetchNoteQuery(input, { limit: options.limit ?? NOTE_PAGE_SIZE, content: options.content, revision: revisionOf(scope) }) };
}

export function notePathsOptions(scope: NoteQueryScope, query: Partial<NoteQuery>) {
  const input = noteQueryInput(query);
  return { queryKey: queryKey(scope, 'paths', input), queryFn: () => fetchNotePaths(input, revisionOf(scope)), enabled: Boolean(scope.sourceId) };
}

export interface NoteListResult {
  notes: NoteListItem[];
  uncommitted: NoteListItem[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string;
  loadMore: () => void;
}

export interface NoteListOptions {
  limit?: number;
  content?: boolean;
  hide?: string;
}

/** One page at a time of a server-side query, with staged drafts overlaid onto the loaded pages. */
export function useNoteList(query: Partial<NoteQuery> | null, options: NoteListOptions = {}): NoteListResult {
  const scope = useNoteQueryScope();
  const limit = options.limit ?? NOTE_PAGE_SIZE;
  const content = Boolean(options.content);
  const input = useStable(query ? noteQueryInput(query) : null);
  const result = useInfiniteQuery({ queryKey: queryKey(scope, 'query', { query: input, limit, content }), queryFn: ({ pageParam }) => fetchNoteQuery(input!, { revision: revisionOf(scope), cursor: pageParam, limit, content }), initialPageParam: undefined as string | undefined, getNextPageParam: (page: NoteQueryPage) => page.nextCursor ?? undefined, enabled: Boolean(input) && Boolean(scope.sourceId), placeholderData: keepPreviousData });
  // A disabled query keeps the previous answer as placeholder data; a view that asked for
  // nothing must still see nothing.
  const rows = useMemo(() => (input ? result.data?.pages.flatMap(page => page.notes) ?? [] : []), [result.data, input]);
  // Drafts belong to the query that was asked; a disabled list overlays nothing.
  const overlay = useMemo(() => (input ? overlayDraftRows(rows, input, scope.drafts, { hide: options.hide }) : { notes: [], uncommitted: [], removed: 0 }), [rows, input, scope.drafts, options.hide]);
  const fetchNextPage = result.fetchNextPage, hasNextPage = result.hasNextPage, fetchingNext = result.isFetchingNextPage;
  const loadMore = useCallback(() => {
    if (hasNextPage && !fetchingNext) void fetchNextPage();
  }, [hasNextPage, fetchingNext, fetchNextPage]);
  const serverTotal = (input && result.data?.pages[0]?.total) || 0;
  return { notes: overlay.notes, uncommitted: overlay.uncommitted, total: Math.max(0, serverTotal - (options.hide ? 1 : 0) - overlay.removed + overlay.uncommitted.length), loading: Boolean(input) && result.isPending, loadingMore: fetchingNext, hasMore: Boolean(hasNextPage), error: errorText(result.error), loadMore };
}

export function useNotePaths(query: Partial<NoteQuery> | null): { paths: string[]; loading: boolean; error: string; } {
  const scope = useNoteQueryScope();
  const input = useStable(query ? noteQueryInput(query) : null);
  const options = notePathsOptions(scope, input ?? DEFAULT_NOTE_QUERY);
  const result = useQuery({ ...options, enabled: options.enabled && Boolean(input), placeholderData: keepPreviousData });
  const paths = useMemo(() => (input ? overlayDraftPaths(result.data?.paths ?? [], input, scope.drafts) : []), [result.data, input, scope.drafts]);
  return { paths, loading: Boolean(input) && result.isPending, error: errorText(result.error) };
}

export function useNoteFacets(showHidden: boolean): { facets: Record<string, NotebookFacets> | undefined; loading: boolean; error: string; } {
  const scope = useNoteQueryScope();
  const result = useQuery({ queryKey: queryKey(scope, 'facets', { showHidden }), queryFn: () => fetchNoteFacets(showHidden, revisionOf(scope)), enabled: Boolean(scope.sourceId), placeholderData: keepPreviousData });
  const facets = useMemo(() => result.data ? overlayDraftFacets((result.data as NoteFacets).notebooks, scope.drafts, showHidden) : undefined, [result.data, scope.drafts, showHidden]);
  return { facets, loading: result.isPending, error: errorText(result.error) };
}

/** `notes` carries staged drafts; `committed` is what the server answered, for use as a merge base. */
export function useNoteLookup(paths: string[], content: boolean): { notes: NoteListItem[]; committed: NoteListItem[]; loading: boolean; error: string; } {
  const scope = useNoteQueryScope();
  const stable = useStable(paths);
  const options = noteLookupOptions(scope, stable, content);
  const result = useQuery(options);
  const committed = useMemo(() => result.data?.notes ?? [], [result.data]);
  const notes = useMemo(() => overlayDraftLookup(stable, committed, scope.drafts), [stable, committed, scope.drafts]);
  return { notes, committed, loading: stable.length > 0 && result.isPending, error: errorText(result.error) };
}

export function useNoteAgenda(notebookId: string, showHidden = false): { agenda: NoteAgenda | undefined; loading: boolean; error: string; } {
  const scope = useNoteQueryScope();
  const result = useQuery({ queryKey: queryKey(scope, 'agenda', { notebookId, showHidden }), queryFn: () => fetchNoteAgenda(notebookId, { showHidden, revision: revisionOf(scope) }), enabled: Boolean(scope.sourceId) && Boolean(notebookId), placeholderData: keepPreviousData });
  const agenda = useMemo(() => result.data ? overlayDraftAgenda(result.data, scope.drafts, { notebookId, showHidden }) : undefined, [result.data, scope.drafts, notebookId, showHidden]);
  return { agenda, loading: result.isPending, error: errorText(result.error) };
}

export function useNoteGraph(enabled = true): { graph: NoteGraphData | undefined; loading: boolean; error: string; } {
  const scope = useNoteQueryScope();
  const result = useQuery({ queryKey: queryKey(scope, 'graph', {}), queryFn: () => fetchNoteGraph(revisionOf(scope)), enabled: enabled && Boolean(scope.sourceId), placeholderData: keepPreviousData });
  const graph = useMemo(() => (enabled && result.data ? overlayGraphDrafts({ nodes: result.data.nodes, links: result.data.links }, draftGraphNotes(scope.drafts)) : undefined), [enabled, result.data, scope.drafts]);
  return { graph, loading: enabled && result.isPending, error: errorText(result.error) };
}
