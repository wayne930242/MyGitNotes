import type { NotebookConfig, NoteItem } from './types.js';
import type { SortField, SortOrder } from './note-sort.js';
import type { TodoTask } from './note-agenda.js';
import type { NoteGraphData } from './note-graph.js';
import { isNoteHidden, resolveNoteStatuses } from './note-status.js';

export const NOTE_DESCRIPTION_LIMIT = 240;

/** Frontmatter description, else the opening body line, bounded so a listing never carries a note body. */
export function noteDescription(note: { metadata: Record<string, unknown>; content: string; }): string {
  const stated = note.metadata.description;
  if (typeof stated === 'string' && stated.trim()) return stated.trim().slice(0, NOTE_DESCRIPTION_LIMIT);
  return (note.content.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('#')) || '').slice(0, NOTE_DESCRIPTION_LIMIT);
}

/** A listing entry: identity, frontmatter and a bounded description in place of the body. */
export function noteSummary(note: NoteItem) {
  return { id: note.id, path: note.path, notebookId: note.notebookId, title: note.title, description: noteDescription(note), status: note.status ?? null, tags: note.tags, metadata: note.metadata, size: note.size };
}

/** A note as returned by list queries; `content` is present only when requested. */
export interface NoteListItem {
  revision?: string;
  id: string;
  path: string;
  notebookId: string;
  title: string;
  status?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  mtime?: number;
  size?: number;
  content?: string;
  /** Body excerpt around a search query's match, present only when the query matched inside content. */
  matchSnippet?: string;
}

export interface NoteQuery {
  notebookId: string;
  folders: string[];
  descendants: boolean;
  tags: string[];
  tagMode: 'any' | 'all';
  status: string | null;
  /** Matches notes that carry no status; a Kanban board's unassigned column. */
  withoutStatus: boolean;
  showHidden: boolean;
  q: string;
  match: 'all' | 'title';
  exclude: string[];
  sort: SortField;
  order: SortOrder;
}

export const DEFAULT_NOTE_QUERY: NoteQuery = { notebookId: 'all', folders: [], descendants: true, tags: [], tagMode: 'any', status: null, withoutStatus: false, showHidden: false, q: '', match: 'all', exclude: [], sort: 'updated', order: 'desc' };

export interface NoteQueryPage {
  revision: string;
  notes: NoteListItem[];
  total: number;
  nextCursor: string | null;
}
export interface NotePaths {
  revision: string;
  paths: string[];
  total: number;
}
export interface NotebookFacets {
  total: number;
  hidden: number;
  statuses: Record<string, number>;
  tags: Record<string, number>;
  directories: Record<string, number>;
}
export interface NoteFacets {
  revision: string;
  notebooks: Record<string, NotebookFacets>;
}
export interface NoteAgenda {
  revision: string;
  tasks: TodoTask[];
  dated: NoteListItem[];
}
export interface NoteLookup {
  revision: string;
  notes: NoteListItem[];
}
export type NoteGraph = NoteGraphData & { revision: string; };

export const noteDirectory = (path: string) => path.slice(0, path.lastIndexOf('/'));

/** Same rules as `filterNotes`, plus `exclude` and title-only matching. Content must be present when `q` searches content. */
export function noteMatchesQuery(note: NoteListItem, query: NoteQuery): boolean {
  if (!query.showHidden && isNoteHidden({ ...note.metadata, status: note.status })) return false;
  if (query.notebookId !== 'all' && note.notebookId !== query.notebookId) return false;
  if (query.exclude.includes(note.path)) return false;
  if (
    query.folders.length && !query.folders.some(folder => {
      const directory = noteDirectory(note.path);
      return directory === folder || (query.descendants && directory.startsWith(folder + '/'));
    })
  ) return false;
  if (query.status && note.status !== query.status) return false;
  if (query.withoutStatus && note.status) return false;
  if (query.tags.length && !(query.tagMode === 'all' ? query.tags.every(tag => note.tags.includes(tag)) : query.tags.some(tag => note.tags.includes(tag)))) return false;
  const q = query.q.toLowerCase();
  if (!q.trim()) return true;
  const fields = query.match === 'title' ? [note.title, note.path, note.notebookId] : [note.title, note.path, note.content ?? '', note.status || '', ...note.tags];
  return fields.some(text => text.toLowerCase().includes(q));
}

export const NOTE_SNIPPET_CONTEXT = 60;

/** Body excerpt around the first case-insensitive match of `query` in `content`, or undefined when it does not occur there. */
export function noteContentSnippet(content: string, query: string, context = NOTE_SNIPPET_CONTEXT): string | undefined {
  const needle = query.trim();
  if (!needle) return undefined;
  const index = content.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) return undefined;
  const start = Math.max(0, index - context);
  const end = Math.min(content.length, index + needle.length + context);
  const excerpt = content.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + excerpt + (end < content.length ? '…' : '');
}

/** Status order used for sorting, matching the notes page. */
export function noteQueryStatuses(notebooks: NotebookConfig[], notebookId: string, observed: Iterable<string | undefined>): string[] {
  return resolveNoteStatuses(notebooks.find(notebook => notebook.id === notebookId), observed);
}

/** Serializes a query for `GET /api/notes/query`; defaults are omitted. */
export function noteQuerySearch(query: Partial<NoteQuery>, extra: { revision?: string; cursor?: string; limit?: number; content?: boolean; select?: 'paths'; } = {}): URLSearchParams {
  const value = { ...DEFAULT_NOTE_QUERY, ...query };
  const params = new URLSearchParams({ notebookId: value.notebookId });
  for (const folder of value.folders) params.append('folder', folder);
  if (!value.descendants) params.set('descendants', '0');
  for (const tag of value.tags) params.append('tag', tag);
  if (value.tagMode !== 'any') params.set('tagMode', value.tagMode);
  if (value.status) params.set('status', value.status);
  if (value.withoutStatus) params.set('noStatus', '1');
  if (value.showHidden) params.set('showHidden', '1');
  if (value.q) params.set('q', value.q);
  if (value.match !== 'all') params.set('match', value.match);
  for (const path of value.exclude) params.append('exclude', path);
  if (value.sort !== DEFAULT_NOTE_QUERY.sort) params.set('sort', value.sort);
  if (value.order !== DEFAULT_NOTE_QUERY.order) params.set('order', value.order);
  if (extra.revision) params.set('revision', extra.revision);
  if (extra.cursor) params.set('cursor', extra.cursor);
  if (extra.limit !== undefined) params.set('limit', String(extra.limit));
  if (extra.content) params.set('content', '1');
  if (extra.select) params.set('select', extra.select);
  return params;
}
