import { noteQuerySearch, type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import type { NoteAgenda, NoteFacets, NoteGraph, NoteLookup, NotePaths, NoteQuery, NoteQueryPage } from '@mygitnotes/core/note-query';
import type { RevisionSet } from '@mygitnotes/core/repository';
import { responseError } from './api.js';

const API_BASE = '/api';
/** The lookup route accepts at most 200 notes per request. */
const LOOKUP_BATCH = 200;

async function readJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw await responseError(res, fallback);
  return res.json();
}

/** Revisions go only with the repositories the caller holds; an empty set asks for the branch heads. */
const revisionParam = (params: URLSearchParams, revisions?: RevisionSet) => {
  if (revisions && Object.keys(revisions).length) params.set('revisions', JSON.stringify(revisions));
};

export interface NoteQueryRequest {
  revisions?: RevisionSet;
  cursor?: string;
  limit?: number;
  content?: boolean;
}

export function fetchNoteQuery(query: NoteQuery, options: NoteQueryRequest = {}): Promise<NoteQueryPage> {
  return readJson(`${API_BASE}/notes/query?${noteQuerySearch(query, options)}`, 'Failed to query notes');
}

export function fetchNotePaths(query: NoteQuery, revisions?: RevisionSet): Promise<NotePaths> {
  return readJson(`${API_BASE}/notes/query?${noteQuerySearch(query, { revisions, select: 'paths' })}`, 'Failed to query notes');
}

export function fetchNoteFacets(showHidden: boolean, revisions?: RevisionSet): Promise<NoteFacets> {
  const params = new URLSearchParams();
  if (showHidden) params.set('showHidden', '1');
  revisionParam(params, revisions);
  const search = params.toString();
  return readJson(`${API_BASE}/notes/facets${search ? `?${search}` : ''}`, 'Failed to load note counts');
}

export function fetchNoteAgenda(notebookId: string, options: { showHidden?: boolean; revisions?: RevisionSet; } = {}): Promise<NoteAgenda> {
  const params = new URLSearchParams({ notebookId });
  if (options.showHidden) params.set('showHidden', '1');
  revisionParam(params, options.revisions);
  return readJson(`${API_BASE}/notes/agenda?${params}`, 'Failed to load the agenda');
}

export function fetchNoteGraph(revisions?: RevisionSet): Promise<NoteGraph> {
  const params = new URLSearchParams();
  revisionParam(params, revisions);
  const search = params.toString();
  return readJson(`${API_BASE}/notes/graph${search ? `?${search}` : ''}`, 'Failed to load the note graph');
}

/** Reads notes by notebook and path, in batches the route accepts; the result keeps the requested order. */
export async function lookupNotes(notes: NoteRef[], options: { content?: boolean; revisions?: RevisionSet; } = {}): Promise<NoteLookup> {
  const unique = [...new Map(notes.map(note => [noteRefKey(note), { notebookId: note.notebookId, path: note.path }])).values()];
  if (!unique.length) return { revisions: options.revisions ?? {}, notes: [] };
  const batches: NoteRef[][] = [];
  for (let index = 0; index < unique.length; index += LOOKUP_BATCH) batches.push(unique.slice(index, index + LOOKUP_BATCH));
  const pages = await Promise.all(batches.map(async batch => {
    const res = await fetch(`${API_BASE}/notes/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: batch, content: options.content, revisions: options.revisions }) });
    if (!res.ok) throw await responseError(res, 'Failed to read notes');
    return res.json() as Promise<NoteLookup>;
  }));
  return { revisions: Object.assign({}, ...pages.map(page => page.revisions)), notes: pages.flatMap(page => page.notes) };
}
