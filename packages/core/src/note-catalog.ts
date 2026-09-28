import type { NotebookConfig, WorkspaceConfig } from './types.js';
import { SourceError } from './github-api.js';
import { isNoteHidden } from './note-status.js';
import { safeFilterPath } from './note-filters.js';
import { type SortField, sortNotes, type SortOrder } from './note-sort.js';
import { extractTodoTasks } from './note-agenda.js';
import { buildNoteGraph } from './note-graph.js';
import { hashJson } from './remote-cache.js';
import { type RepositoryId, type RevisionSet, StaleRevisionError } from './repository.js';
import { DEFAULT_NOTE_QUERY, type NoteAgenda, type NotebookFacets, noteContentSnippet, noteDirectory, type NoteFacets, type NoteGraph, type NoteListItem, type NoteLookup, noteMatchesQuery, type NotePaths, type NoteQuery, type NoteQueryPage, noteQueryStatuses } from './note-query.js';

/** Read model of the notebooks one repository serves, implemented by remote and local sources. */
export interface RepositoryCatalog {
  /** The repository's commit identity, or an empty string for a worktree, which has none. */
  revision(): Promise<string>;
  /** Notes of one notebook without content. */
  index(notebook: NotebookConfig): Promise<NoteListItem[]>;
  /** Note bodies (without frontmatter) by path. */
  contents(notes: NoteListItem[]): Promise<Map<string, string>>;
  /** Result derived from the content of the given notebooks, reused while that content is unchanged. */
  memo<T>(kind: string, notebooks: NotebookConfig[], compute: () => Promise<T>): Promise<T>;
}

/** Read model behind the note query routes, over every repository of a workspace. */
export interface NoteCatalog {
  /** The manifest restricted to the notebooks whose repositories this catalog reads. */
  config(): Promise<WorkspaceConfig>;
  /** Revisions of the repositories serving `notebooks`; repositories without one are omitted. */
  revisions(notebooks: NotebookConfig[]): Promise<RevisionSet>;
  /** Notes of one notebook without content. */
  index(notebook: NotebookConfig): Promise<NoteListItem[]>;
  /** Note bodies (without frontmatter) by path. */
  contents(notes: NoteListItem[]): Promise<Map<string, string>>;
  /** Result derived from the content of the given notebooks, reused while that content is unchanged. */
  memo<T>(kind: string, notebooks: NotebookConfig[], compute: () => Promise<T>): Promise<T>;
}

export interface NoteQueryOptions {
  limit: number;
  cursor?: string;
  content: boolean;
  select?: 'paths';
}

const SORT_FIELDS: SortField[] = ['updated', 'created', 'title', 'status'];
const SORT_ORDERS: SortOrder[] = ['asc', 'desc'];
const REVISION = /^[a-f0-9]{40}([a-f0-9]{24})?$/;

const values = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(item => {
    if (typeof item !== 'string') throw new SourceError('Query parameters must be strings.');
    return item;
  });
const single = (value: unknown): string | undefined => {
  const list = values(value);
  if (list.length > 1) throw new SourceError('Repeated query parameter.');
  return list[0];
};
const flag = (value: unknown) => single(value) === '1';

/** Reads the `revisions` a caller works from: a `RevisionSet`, or its JSON text in a query string. */
export function parseRevisions(value: unknown): RevisionSet {
  if (value === undefined || value === '') return {};
  let set: unknown = value;
  if (typeof value === 'string') {
    try {
      set = JSON.parse(value);
    } catch {
      throw new SourceError('Invalid revisions.');
    }
  }
  if (!set || typeof set !== 'object' || Array.isArray(set)) throw new SourceError('Invalid revisions.');
  const entries = Object.entries(set);
  if (entries.length > 64 || entries.some(([id, revision]) => !id || id.length > 512 || typeof revision !== 'string' || !REVISION.test(revision))) throw new SourceError('Invalid revisions.');
  return Object.fromEntries(entries) as RevisionSet;
}

export interface CatalogRepository {
  id: RepositoryId;
  notebooks: NotebookConfig[];
  catalog: RepositoryCatalog;
}

/**
 * Joins the catalogs of a workspace's repositories. `expected` holds the revisions the caller
 * works from; a repository that moved on, or is no longer part of the workspace, is stale.
 */
export async function workspaceCatalog(config: WorkspaceConfig, repositories: CatalogRepository[], expected: RevisionSet = {}): Promise<NoteCatalog> {
  const stale: RepositoryId[] = [];
  for (const [id, revision] of Object.entries(expected)) {
    const repository = repositories.find(item => item.id === id);
    if (!repository || await repository.catalog.revision() !== revision) stale.push(id);
  }
  if (stale.length) throw new StaleRevisionError(stale);
  const owner = new Map(repositories.flatMap(repository => repository.notebooks.map(notebook => [notebook.id, repository] as const)));
  const served = { ...config, notebooks: config.notebooks.filter(notebook => owner.has(notebook.id)) };
  const repositoryOf = (notebookId: string) => {
    const repository = owner.get(notebookId);
    if (!repository) throw new SourceError('Notebook is not configured.', 404);
    return repository;
  };
  return {
    config: async () => served,
    revisions: async notebooks => {
      const involved = new Set(notebooks.map(notebook => repositoryOf(notebook.id)));
      const entries = await Promise.all([...involved].map(async repository => [repository.id, await repository.catalog.revision()] as const));
      return Object.fromEntries(entries.filter(([, revision]) => revision));
    },
    index: notebook => repositoryOf(notebook.id).catalog.index(notebook),
    contents: async notes => {
      const groups = new Map<CatalogRepository, NoteListItem[]>();
      for (const note of notes) {
        const repository = repositoryOf(note.notebookId);
        groups.set(repository, [...(groups.get(repository) ?? []), note]);
      }
      const parts = await Promise.all([...groups].map(([repository, group]) => repository.catalog.contents(group)));
      return new Map(parts.flatMap(part => [...part]));
    },
    // A result spanning several repositories has no single content key to cache it under.
    memo: (kind, notebooks, compute) => {
      const involved = new Set(notebooks.map(notebook => repositoryOf(notebook.id)));
      return involved.size === 1 ? [...involved][0].catalog.memo(kind, notebooks, compute) : compute();
    },
  };
}

export function parseNoteQuery(input: Record<string, unknown>): { query: NoteQuery; options: NoteQueryOptions; } {
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
  return { query: { notebookId, folders, descendants: single(input.descendants) !== '0', tags, tagMode: tagMode as NoteQuery['tagMode'], status: single(input.status) || null, withoutStatus: flag(input.noStatus), showHidden: flag(input.showHidden), q, match: match as NoteQuery['match'], exclude, sort, order }, options: { limit, cursor: single(input.cursor), content: flag(input.content), select: select as 'paths' | undefined } };
}

async function scopeNotebooks(catalog: NoteCatalog, notebookId: string) {
  const config = await catalog.config();
  return notebookId === 'all' ? config.notebooks : config.notebooks.filter(notebook => notebook.id === notebookId);
}

async function scope(catalog: NoteCatalog, notebookId: string) {
  const config = await catalog.config();
  const notebooks = await scopeNotebooks(catalog, notebookId);
  return { config, notebooks, notes: (await Promise.all(notebooks.map(notebook => catalog.index(notebook)))).flat() };
}

async function matching(catalog: NoteCatalog, query: NoteQuery) {
  const { config, notes } = await scope(catalog, query.notebookId);
  let matches = notes.filter(note => noteMatchesQuery(note, { ...query, q: '' }));
  if (query.q.trim() && query.match === 'all') {
    const contents = await catalog.contents(matches);
    matches = matches.filter(note => noteMatchesQuery({ ...note, content: contents.get(note.path) ?? '' }, query)).map(note => {
      const matchSnippet = noteContentSnippet(contents.get(note.path) ?? '', query.q);
      return matchSnippet ? { ...note, matchSnippet } : note;
    });
  } else if (query.q.trim()) {
    matches = matches.filter(note => noteMatchesQuery(note, query));
  }
  return sortNotes(matches, query.sort, query.order, noteQueryStatuses(config.notebooks, query.notebookId, notes.map(note => note.status)));
}

const cursorKey = (revisions: RevisionSet, query: NoteQuery) => hashJson([Object.entries(revisions).sort(([a], [b]) => a.localeCompare(b)), query]);

export async function queryNotes(catalog: NoteCatalog, query: NoteQuery, options: NoteQueryOptions): Promise<NoteQueryPage> {
  const revisions = await catalog.revisions(await scopeNotebooks(catalog, query.notebookId));
  const key = cursorKey(revisions, query);
  let offset = 0;
  if (options.cursor) {
    let cursor: { k?: unknown; o?: unknown; };
    try {
      cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
    } catch {
      throw new SourceError('Invalid cursor.');
    }
    if (cursor.k !== key || !Number.isInteger(cursor.o) || (cursor.o as number) < 0) throw new SourceError('Cursor does not match this query.');
    offset = cursor.o as number;
  }
  const sorted = await matching(catalog, query);
  const page = sorted.slice(offset, offset + options.limit);
  const contents = options.content ? await catalog.contents(page) : undefined;
  const next = offset + options.limit;
  return { revisions, total: sorted.length, notes: contents ? page.map(note => ({ ...note, content: contents.get(note.path) ?? '' })) : page, nextCursor: next < sorted.length ? Buffer.from(JSON.stringify({ k: key, o: next })).toString('base64url') : null };
}

export async function queryNotePaths(catalog: NoteCatalog, query: NoteQuery): Promise<NotePaths> {
  const [revisions, sorted] = await Promise.all([scopeNotebooks(catalog, query.notebookId).then(notebooks => catalog.revisions(notebooks)), matching(catalog, query)]);
  return { revisions, paths: sorted.map(note => note.path), total: sorted.length };
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
  return { revisions: await catalog.revisions(notebooks), notebooks: result };
}

export async function lookupNotes(catalog: NoteCatalog, paths: unknown, content: boolean): Promise<NoteLookup> {
  if (!Array.isArray(paths) || !paths.length || paths.length > 200 || paths.some(path => typeof path !== 'string' || path.length > 2048)) {
    throw new SourceError('Select between 1 and 200 note paths.');
  }
  const config = await catalog.config();
  const byPath = new Map<string, NoteListItem>();
  const notebooks = [...config.notebooks].sort((a, b) => b.root.length - a.root.length);
  const involved = [...new Set(paths.map(path => notebooks.find(item => (path as string).startsWith(`${item.root}/`))).filter(Boolean) as NotebookConfig[])];
  for (const notebook of involved) {
    for (const note of await catalog.index(notebook)) byPath.set(note.path, note);
  }
  const found = (paths as string[]).map(path => byPath.get(path)).filter(Boolean) as NoteListItem[];
  const contents = content ? await catalog.contents(found) : undefined;
  return { revisions: await catalog.revisions(involved), notes: contents ? found.map(note => ({ ...note, content: contents.get(note.path) ?? '' })) : found };
}

export async function noteAgenda(catalog: NoteCatalog, notebookId: string, showHidden: boolean): Promise<NoteAgenda> {
  const { notebooks } = await scope(catalog, notebookId);
  const parts = await Promise.all(notebooks.map(async notebook => {
    const part = await catalog.memo(`agenda:${showHidden ? 1 : 0}`, [notebook], async () => {
      const visible = (await catalog.index(notebook)).filter(note => showHidden || !isNoteHidden({ ...note.metadata, status: note.status }));
      const contents = await catalog.contents(visible);
      return { tasks: extractTodoTasks(visible.map(note => ({ ...note, content: contents.get(note.path) ?? '' }))), dated: visible.filter(note => note.metadata.created !== undefined || note.metadata.updated !== undefined) };
    });
    // A remembered part keeps the revision it was computed at; each note carries its repository's current one.
    const revision = Object.values(await catalog.revisions([notebook]))[0];
    return { ...part, dated: part.dated.map(note => ({ ...note, revision })) };
  }));
  return { revisions: await catalog.revisions(notebooks), tasks: parts.flatMap(part => part.tasks), dated: parts.flatMap(part => part.dated) };
}

export async function noteGraph(catalog: NoteCatalog): Promise<NoteGraph> {
  const { config, notebooks } = await scope(catalog, 'all');
  const graph = await catalog.memo(`graph:${hashJson(config.notebooks.map(notebook => notebook.pathAliases || null))}`, notebooks, async () => {
    const notes = (await Promise.all(notebooks.map(notebook => catalog.index(notebook)))).flat();
    const contents = await catalog.contents(notes);
    return buildNoteGraph(notes.map(note => ({ ...note, content: contents.get(note.path) ?? '' })), { includeHidden: true, notebooks: config.notebooks });
  });
  return { revisions: await catalog.revisions(notebooks), ...graph };
}
