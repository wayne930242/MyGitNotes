import { noteQuerySearch } from '@mygitnotes/core/note-query';
import type { NoteAgenda, NoteFacets, NoteGraph, NoteLookup, NotePaths, NoteQuery, NoteQueryPage } from '@mygitnotes/core/note-query';
import { responseError } from './api.js';

const API_BASE = '/api';
/** The lookup route accepts at most 200 paths per request. */
const LOOKUP_BATCH = 200;

async function readJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw await responseError(res, fallback);
  return res.json();
}

export interface NoteQueryRequest {
  revision?: string;
  cursor?: string;
  limit?: number;
  content?: boolean;
}

export function fetchNoteQuery(query: NoteQuery, options: NoteQueryRequest = {}): Promise<NoteQueryPage> {
  return readJson(`${API_BASE}/notes/query?${noteQuerySearch(query, options)}`, 'Failed to query notes');
}

export function fetchNotePaths(query: NoteQuery, revision?: string): Promise<NotePaths> {
  return readJson(`${API_BASE}/notes/query?${noteQuerySearch(query, { revision, select: 'paths' })}`, 'Failed to query notes');
}

export function fetchNoteFacets(showHidden: boolean, revision?: string): Promise<NoteFacets> {
  const params = new URLSearchParams();
  if (showHidden) params.set('showHidden', '1');
  if (revision) params.set('revision', revision);
  const search = params.toString();
  return readJson(`${API_BASE}/notes/facets${search ? `?${search}` : ''}`, 'Failed to load note counts');
}

export function fetchNoteAgenda(notebookId: string, options: { showHidden?: boolean; revision?: string; } = {}): Promise<NoteAgenda> {
  const params = new URLSearchParams({ notebookId });
  if (options.showHidden) params.set('showHidden', '1');
  if (options.revision) params.set('revision', options.revision);
  return readJson(`${API_BASE}/notes/agenda?${params}`, 'Failed to load the agenda');
}

export function fetchNoteGraph(revision?: string): Promise<NoteGraph> {
  const params = new URLSearchParams();
  if (revision) params.set('revision', revision);
  const search = params.toString();
  return readJson(`${API_BASE}/notes/graph${search ? `?${search}` : ''}`, 'Failed to load the note graph');
}

/** Reads notes by path, in batches the route accepts; the result keeps the requested order. */
export async function lookupNotes(paths: string[], options: { content?: boolean; revision?: string; } = {}): Promise<NoteLookup> {
  const unique = [...new Set(paths)];
  if (!unique.length) return { revision: options.revision || '', notes: [] };
  const batches: string[][] = [];
  for (let index = 0; index < unique.length; index += LOOKUP_BATCH) batches.push(unique.slice(index, index + LOOKUP_BATCH));
  const pages = await Promise.all(batches.map(async batch => {
    const res = await fetch(`${API_BASE}/notes/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: batch, content: options.content, revision: options.revision }) });
    if (!res.ok) throw await responseError(res, 'Failed to read notes');
    return res.json() as Promise<NoteLookup>;
  }));
  return { revision: pages[0]?.revision || options.revision || '', notes: pages.flatMap(page => page.notes) };
}
