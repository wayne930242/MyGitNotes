import type { NotebookConfig, WorkspaceConfig } from './types.js';
import { SourceError } from './github-api.js';
import { isNoteHidden } from './note-status.js';
import { safeFilterPath } from './note-filters.js';
import { sortNotes, type SortField, type SortOrder } from './note-sort.js';
import { extractTodoTasks } from './note-agenda.js';
import { buildNoteGraph } from './note-graph.js';
import { hashJson } from './remote-cache.js';
import {
  DEFAULT_NOTE_QUERY, noteDirectory, noteMatchesQuery, noteQueryStatuses,
  type NoteAgenda, type NoteFacets, type NoteGraph, type NoteListItem, type NoteLookup, type NotePaths, type NoteQuery, type NoteQueryPage, type NotebookFacets,
} from './note-query.js';

/** Read model behind the note query routes, implemented by remote and local sources. */
export interface NoteCatalog {
  revision(): Promise<string>;
  config(): Promise<WorkspaceConfig>;
  /** Notes of one notebook without content. */
  index(notebook: NotebookConfig): Promise<NoteListItem[]>;
  /** Note bodies (without frontmatter) by path. */
  contents(notes: NoteListItem[]): Promise<Map<string, string>>;
  /** Result derived from the content of the given notebooks, reused while that content is unchanged. */
  memo<T>(kind: string, notebooks: NotebookConfig[], compute: () => Promise<T>): Promise<T>;
}

export interface NoteQueryOptions { limit: number; cursor?: string; content: boolean; select?: 'paths' }

const SORT_FIELDS: SortField[] = ['updated', 'created', 'title', 'status'];
const SORT_ORDERS: SortOrder[] = ['asc', 'desc'];
const REVISION = /^[a-f0-9]{40}([a-f0-9]{24})?$/;

const values = (value: unknown): string[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(item => {
  if (typeof item !== 'string') throw new SourceError('Query parameters must be strings.');
  return item;
});
const single = (value: unknown): string | undefined => {
  const list = values(value);
  if (list.length > 1) throw new SourceError('Repeated query parameter.');
  return list[0];
};
const flag = (value: unknown) => single(value) === '1';

export function parseRevision(value: unknown): string | undefined {
  const revision = single(value);
  if (revision !== undefined && !REVISION.test(revision)) throw new SourceError('Invalid revision.');
  return revision || undefined;
}

export function parseNoteQuery(input: Record<string, unknown>): { query: NoteQuery; options: NoteQueryOptions } {
  const notebookId = single(input.notebookId);
  if (!notebookId) throw new SourceError('notebookId is required.');
  const folders = values(input.folder), exclude = values(input.exclude), tags = values(input.tag).filter(tag => tag.trim());
  if (folders.some(folder => !safeFilterPath(folder)) || exclude.some(path => !safeFilterPath(path))) throw new SourceError('Invalid folder or path.');
  const tagMode = single(input.tagMode) ?? 'any', match = single(input.match) ?? 'all';
  const sort = (single(input.sort) ?? DEFAULT_NOTE_QUERY.sort) as SortField, order = (single(input.order) ?? DEFAULT_NOTE_QUERY.order) as SortOrder;
  const q = single(input.q) ?? '', select = single(input.select), limitText = single(input.limit);
  if (!['any', 'all'].includes(tagMode) || !['all', 'title'].includes(match) || !SORT_FIELDS.includes(sort) || !SORT_ORDERS.includes(order)) throw new SourceError('Invalid query option.');
  if (q.length > 500) throw new SourceError('Search text exceeds 500 characters.');
  if (select !== undefined && select !== 'paths') throw new SourceError('Invalid select option.');
  const limit = limitText === undefined ? 50 : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new SourceError('limit must be between 1 and 200.');
  return {
    query: { notebookId, folders, descendants: single(input.descendants) !== '0', tags, tagMode: tagMode as NoteQuery['tagMode'], status: single(input.status) || null, withoutStatus: flag(input.noStatus),
      showHidden: flag(input.showHidden), q, match: match as NoteQuery['match'], exclude, sort, order },
    options: { limit, cursor: single(input.cursor), content: flag(input.content), select: select as 'paths' | undefined },
  };
}

async function scope(catalog: NoteCatalog, notebookId: string) {
  const config = await catalog.config();
  const notebooks = notebookId === 'all' ? config.notebooks : config.notebooks.filter(notebook => notebook.id === notebookId);
  return { config, notebooks, notes: (await Promise.all(notebooks.map(notebook => catalog.index(notebook)))).flat() };
}

async function matching(catalog: NoteCatalog, query: NoteQuery) {
  const { config, notes } = await scope(catalog, query.notebookId);
  let matches = notes.filter(note => noteMatchesQuery(note, { ...query, q: '' }));
  if (query.q.trim() && query.match === 'all') {
    const contents = await catalog.contents(matches);
    matches = matches.filter(note => noteMatchesQuery({ ...note, content: contents.get(note.path) ?? '' }, query));
  } else if (query.q.trim()) {
    matches = matches.filter(note => noteMatchesQuery(note, query));
  }
  return sortNotes(matches, query.sort, query.order, noteQueryStatuses(config.notebooks, query.notebookId, notes.map(note => note.status)));
}

const cursorKey = (revision: string, query: NoteQuery) => hashJson([revision, query]);

export async function queryNotes(catalog: NoteCatalog, query: NoteQuery, options: NoteQueryOptions): Promise<NoteQueryPage> {
  const revision = await catalog.revision();
  const key = cursorKey(revision, query);
  let offset = 0;
  if (options.cursor) {
    let cursor: { k?: unknown; o?: unknown };
    try { cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')); } catch { throw new SourceError('Invalid cursor.'); }
    if (cursor.k !== key || !Number.isInteger(cursor.o) || (cursor.o as number) < 0) throw new SourceError('Cursor does not match this query.');
    offset = cursor.o as number;
  }
  const sorted = await matching(catalog, query);
  const page = sorted.slice(offset, offset + options.limit);
  const contents = options.content ? await catalog.contents(page) : undefined;
  const next = offset + options.limit;
  return {
    revision, total: sorted.length,
    notes: contents ? page.map(note => ({ ...note, content: contents.get(note.path) ?? '' })) : page,
    nextCursor: next < sorted.length ? Buffer.from(JSON.stringify({ k: key, o: next })).toString('base64url') : null,
  };
}

export async function queryNotePaths(catalog: NoteCatalog, query: NoteQuery): Promise<NotePaths> {
  const [revision, sorted] = await Promise.all([catalog.revision(), matching(catalog, query)]);
  return { revision, paths: sorted.map(note => note.path), total: sorted.length };
}

export async function noteFacets(catalog: NoteCatalog, showHidden: boolean): Promise<NoteFacets> {
  const { notebooks } = await scope(catalog, 'all');
  const result: Record<string, NotebookFacets> = {};
  for (const notebook of notebooks) {
    const facets: NotebookFacets = { total: 0, hidden: 0, statuses: {}, tags: {}, directories: {} };
    for (const note of await catalog.index(notebook)) {
      const hidden = isNoteHidden({ ...note.metadata, status: note.status });
      if (hidden) facets.hidden++;
      if (hidden && !showHidden) continue;
      facets.total++;
      facets.statuses[note.status || ''] = (facets.statuses[note.status || ''] || 0) + 1;
      for (const tag of note.tags) facets.tags[tag] = (facets.tags[tag] || 0) + 1;
      const directory = noteDirectory(note.path);
      facets.directories[directory] = (facets.directories[directory] || 0) + 1;
    }
    result[notebook.id] = facets;
  }
  return { revision: await catalog.revision(), notebooks: result };
}

export async function lookupNotes(catalog: NoteCatalog, paths: unknown, content: boolean): Promise<NoteLookup> {
  if (!Array.isArray(paths) || !paths.length || paths.length > 200 || paths.some(path => typeof path !== 'string' || path.length > 2048)) {
    throw new SourceError('Select between 1 and 200 note paths.');
  }
  const config = await catalog.config();
  const byPath = new Map<string, NoteListItem>();
  const notebooks = [...config.notebooks].sort((a, b) => b.root.length - a.root.length);
  for (const notebook of new Set(paths.map(path => notebooks.find(item => (path as string).startsWith(`${item.root}/`))).filter(Boolean) as NotebookConfig[])) {
    for (const note of await catalog.index(notebook)) byPath.set(note.path, note);
  }
  const found = (paths as string[]).map(path => byPath.get(path)).filter(Boolean) as NoteListItem[];
  const contents = content ? await catalog.contents(found) : undefined;
  return { revision: await catalog.revision(), notes: contents ? found.map(note => ({ ...note, content: contents.get(note.path) ?? '' })) : found };
}

export async function noteAgenda(catalog: NoteCatalog, notebookId: string, showHidden: boolean): Promise<NoteAgenda> {
  const { notebooks } = await scope(catalog, notebookId);
  const parts = await Promise.all(notebooks.map(notebook => catalog.memo(`agenda:${showHidden ? 1 : 0}`, [notebook], async () => {
    const visible = (await catalog.index(notebook)).filter(note => showHidden || !isNoteHidden({ ...note.metadata, status: note.status }));
    const contents = await catalog.contents(visible);
    return {
      tasks: extractTodoTasks(visible.map(note => ({ ...note, content: contents.get(note.path) ?? '' }))),
      dated: visible.filter(note => note.metadata.created !== undefined || note.metadata.updated !== undefined),
    };
  })));
  const revision = await catalog.revision();
  return { revision, tasks: parts.flatMap(part => part.tasks), dated: parts.flatMap(part => part.dated.map(note => ({ ...note, revision }))) };
}

export async function noteGraph(catalog: NoteCatalog): Promise<NoteGraph> {
  const { config, notebooks } = await scope(catalog, 'all');
  const graph = await catalog.memo(`graph:${hashJson(config.notebooks.map(notebook => notebook.pathAliases || null))}`, notebooks, async () => {
    const notes = (await Promise.all(notebooks.map(notebook => catalog.index(notebook)))).flat();
    const contents = await catalog.contents(notes);
    return buildNoteGraph(notes.map(note => ({ ...note, content: contents.get(note.path) ?? '' })), { includeHidden: true, notebooks: config.notebooks });
  });
  return { revision: await catalog.revision(), ...graph };
}
