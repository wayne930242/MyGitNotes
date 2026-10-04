import type { NotebookConfig, WorkspaceConfig } from './types.js';
import { SourceError } from './github-api.js';
import { isNoteHidden } from './note-status.js';
import { safeFilterPath } from './note-filters.js';
import { type SortField, sortNotes, type SortOrder } from './note-sort.js';
import { extractTodoTasks } from './note-agenda.js';
import { buildNoteGraph } from './note-graph.js';
import { hashJson } from './remote-cache.js';
import { type RepositoryId, type RevisionSet, StaleRevisionError } from './repository.js';
import { DEFAULT_NOTE_QUERY, isCompilationEntry, NOTE_KIND_FILTERS, type NoteAgenda, type NotebookFacets, noteContentSnippet, noteDirectory, type NoteFacets, type NoteGraph, type NoteKindFilter, type NoteListItem, type NoteLookup, noteMatchesQuery, type NotePaths, type NoteQuery, type NoteQueryPage, noteQueryStatuses, type NoteRef, noteRefKey } from './note-query.js';

/** Read model of the notebooks one repository serves, implemented by remote and local sources. */
export interface RepositoryCatalog {
  /** The repository's commit identity, or an empty string for a worktree, which has none; `fresh` reads the branch head past any cache. */
  revision(fresh?: boolean): Promise<string>;
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
  /** The repository serving a notebook. */
  repository(notebookId: string): RepositoryId;
  /** Revisions of the repositories serving `notebooks`; repositories without one are omitted. */
  revisions(notebooks: NotebookConfig[]): Promise<RevisionSet>;
  /** Notes of one notebook without content. */
  index(notebook: NotebookConfig): Promise<NoteListItem[]>;
  /** Note bodies (without frontmatter) by `noteRefKey`, so equal paths in two repositories stay apart. */
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
 * A cached branch head may lag a commit another server instance made, so a mismatch is
 * checked against the uncached head before the caller is told it is behind.
 */
export async function workspaceCatalog(config: WorkspaceConfig, repositories: CatalogRepository[], expected: RevisionSet = {}): Promise<NoteCatalog> {
  const stale: RepositoryId[] = [];
  for (const [id, revision] of Object.entries(expected)) {
    const repository = repositories.find(item => item.id === id);
    if (!repository || await repository.catalog.revision() !== revision && await repository.catalog.revision(true) !== revision) stale.push(id);
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
    repository: notebookId => repositoryOf(notebookId).id,
    revisions: async notebooks => {
      const involved = new Set(notebooks.map(notebook => repositoryOf(notebook.id)));
      const entries = await Promise.all([...involved].map(async repository => [repository.id, await repository.catalog.revision()] as const));
      return Object.fromEntries(entries.filter(([, revision]) => revision));
    },
    index: notebook => indexWithIdentity(repositoryOf(notebook.id), notebook),
    contents: async notes => {
      const groups = new Map<CatalogRepository, NoteListItem[]>();
      for (const note of notes) {
        const repository = repositoryOf(note.notebookId);
        groups.set(repository, [...(groups.get(repository) ?? []), note]);
      }
      const parts = await Promise.all([...groups].map(async ([repository, group]) => {
        const bodies = await repository.catalog.contents(group);
        return group.map(note => [noteRefKey(note), bodies.get(note.path) ?? ''] as const);
      }));
      return new Map(parts.flat());
    },
    // A result spanning several repositories has no single content key to cache it under.
    memo: (kind, notebooks, compute) => {
      const involved = new Set(notebooks.map(notebook => repositoryOf(notebook.id)));
      return involved.size === 1 ? [...involved][0].catalog.memo(kind, notebooks, compute) : compute();
    },
  };
}

/**
 * A compilation's `id` is unique within its repository, and study history hangs on it. Two files that share one
 * are both reported invalid, so neither silently wins; siblings are indexed only when this notebook has compilations.
 */
async function indexWithIdentity(repository: CatalogRepository, notebook: NotebookConfig): Promise<NoteListItem[]> {
  const items = await repository.catalog.index(notebook);
  if (!items.some(isCompilationEntry)) return items;
  const owners = new Map<string, string[]>();
  for (const sibling of repository.notebooks) {
    for (const item of sibling.id === notebook.id ? items : await repository.catalog.index(sibling)) {
      if (!isCompilationEntry(item) || item.invalid || typeof item.metadata.id !== 'string') continue;
      owners.set(item.metadata.id, [...owners.get(item.metadata.id) ?? [], item.path]);
    }
  }
  return items.map(item => {
    const same = !item.invalid && typeof item.metadata.id === 'string' ? owners.get(item.metadata.id) ?? [] : [];
    return same.length > 1 ? { ...item, invalid: `Duplicate compilation id "${item.metadata.id}" also used by ${same.filter(path => path !== item.path).join(', ')}` } : item;
  });
}

export function parseNoteQuery(input: Record<string, unknown>): { query: NoteQuery; options: NoteQueryOptions; } {
  const notebookId = single(input.notebookId);
  if (!notebookId) throw new SourceError('notebookId is required.');
  const folders = values(input.folder), exclude = values(input.exclude), tags = values(input.tag).filter(tag => tag.trim());
  if (folders.some(folder => !safeFilterPath(folder)) || exclude.some(path => !safeFilterPath(path))) throw new SourceError('Invalid folder or path.');
  const tagMode = single(input.tagMode) ?? 'any', match = single(input.match) ?? 'all';
  const sort = (single(input.sort) ?? DEFAULT_NOTE_QUERY.sort) as SortField, order = (single(input.order) ?? DEFAULT_NOTE_QUERY.order) as SortOrder;
  const q = single(input.q) ?? '', select = single(input.select), limitText = single(input.limit), kind = single(input.kind) ?? DEFAULT_NOTE_QUERY.kind;
  if (!['any', 'all'].includes(tagMode) || !['all', 'title'].includes(match) || !SORT_FIELDS.includes(sort) || !SORT_ORDERS.includes(order) || !NOTE_KIND_FILTERS.includes(kind as NoteKindFilter)) throw new SourceError('Invalid query option.');
  if (q.length > 500) throw new SourceError('Search text exceeds 500 characters.');
  if (select !== undefined && select !== 'paths') throw new SourceError('Invalid select option.');
  const limit = limitText === undefined ? 50 : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new SourceError('limit must be between 1 and 200.');
  return { query: { notebookId, folders, descendants: single(input.descendants) !== '0', tags, tagMode: tagMode as NoteQuery['tagMode'], status: single(input.status) || null, withoutStatus: flag(input.noStatus), showHidden: flag(input.showHidden), q, match: match as NoteQuery['match'], exclude, sort, order, kind: kind as NoteKindFilter }, options: { limit, cursor: single(input.cursor), content: flag(input.content), select: select as 'paths' | undefined } };
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
    matches = matches.filter(note => noteMatchesQuery({ ...note, content: contents.get(noteRefKey(note)) ?? '' }, query)).map(note => {
      const matchSnippet = noteContentSnippet(contents.get(noteRefKey(note)) ?? '', query.q);
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
  return { revisions, total: sorted.length, notes: contents ? page.map(note => ({ ...note, content: contents.get(noteRefKey(note)) ?? '' })) : page, nextCursor: next < sorted.length ? Buffer.from(JSON.stringify({ k: key, o: next })).toString('base64url') : null };
}

export async function queryNotePaths(catalog: NoteCatalog, query: NoteQuery): Promise<NotePaths> {
  const [revisions, sorted] = await Promise.all([scopeNotebooks(catalog, query.notebookId).then(notebooks => catalog.revisions(notebooks)), matching(catalog, query)]);
  return { revisions, notes: sorted.map(note => ({ notebookId: note.notebookId, path: note.path })), total: sorted.length };
}

export async function noteFacets(catalog: NoteCatalog, showHidden: boolean): Promise<NoteFacets> {
  const { notebooks } = await scope(catalog, 'all');
  const result: Record<string, NotebookFacets> = {};
  for (const notebook of notebooks) {
    const facets: NotebookFacets = { total: 0, hidden: 0, statuses: {}, tags: {}, directories: {}, compilations: { total: 0, statuses: {}, tags: {} } };
    for (const note of await catalog.index(notebook)) {
      const hidden = isNoteHidden({ ...note.metadata, status: note.status });
      const compilation = isCompilationEntry(note);
      if (hidden && !compilation) facets.hidden++;
      if (hidden && !showHidden) continue;
      const target = compilation ? facets.compilations : facets;
      target.total++;
      target.statuses[note.status || ''] = (target.statuses[note.status || ''] || 0) + 1;
      for (const tag of note.tags) target.tags[tag] = (target.tags[tag] || 0) + 1;
      if (compilation) continue;
      const directory = noteDirectory(note.path);
      facets.directories[directory] = (facets.directories[directory] || 0) + 1;
    }
    result[notebook.id] = facets;
  }
  return { revisions: await catalog.revisions(notebooks), notebooks: result };
}

/** Notes by notebook and path, in the requested order; notes that do not exist are omitted. */
export async function lookupNotes(catalog: NoteCatalog, notes: unknown, content: boolean): Promise<NoteLookup> {
  if (!Array.isArray(notes) || !notes.length || notes.length > 200 || notes.some(note => typeof note?.notebookId !== 'string' || typeof note?.path !== 'string' || note.path.length > 2048)) {
    throw new SourceError('Select between 1 and 200 notes by notebook and path.');
  }
  const refs = notes as NoteRef[];
  const config = await catalog.config();
  const involved = config.notebooks.filter(notebook => refs.some(ref => ref.notebookId === notebook.id));
  const byKey = new Map<string, NoteListItem>();
  for (const notebook of involved) {
    for (const note of await catalog.index(notebook)) byKey.set(noteRefKey(note), note);
  }
  const found = refs.map(ref => byKey.get(noteRefKey(ref))).filter(Boolean) as NoteListItem[];
  const contents = content ? await catalog.contents(found) : undefined;
  return { revisions: await catalog.revisions(involved), notes: contents ? found.map(note => ({ ...note, content: contents.get(noteRefKey(note)) ?? '' })) : found };
}

export async function noteAgenda(catalog: NoteCatalog, notebookId: string, showHidden: boolean): Promise<NoteAgenda> {
  const { notebooks } = await scope(catalog, notebookId);
  const parts = await Promise.all(notebooks.map(async notebook => {
    const part = await catalog.memo(`agenda:${showHidden ? 1 : 0}`, [notebook], async () => {
      const visible = (await catalog.index(notebook)).filter(note => !isCompilationEntry(note) && (showHidden || !isNoteHidden({ ...note.metadata, status: note.status })));
      const contents = await catalog.contents(visible);
      return { tasks: extractTodoTasks(visible.map(note => ({ ...note, content: contents.get(noteRefKey(note)) ?? '' }))), dated: visible.filter(note => note.metadata.created !== undefined || note.metadata.updated !== undefined) };
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
    const notes = (await Promise.all(notebooks.map(notebook => catalog.index(notebook)))).flat().filter(note => !isCompilationEntry(note));
    const contents = await catalog.contents(notes);
    return buildNoteGraph(notes.map(note => ({ ...note, content: contents.get(noteRefKey(note)) ?? '' })), { includeHidden: true, notebooks: config.notebooks, repositoryOf: catalog.repository });
  });
  return { revisions: await catalog.revisions(notebooks), ...graph };
}
