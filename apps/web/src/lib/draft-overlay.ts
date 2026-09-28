import { isNoteHidden } from '@mygitnotes/core/note-status';
import { noteDirectory, noteMatchesQuery, type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import type { NoteAgenda, NotebookFacets, NoteListItem, NoteQuery } from '@mygitnotes/core/note-query';
import { extractTodoTasks } from '@mygitnotes/core/note-agenda';
import { extractNoteLinks } from '@mygitnotes/core/note-graph';
import type { NoteGraphData } from '@mygitnotes/core/note-graph';
import type { RepositoryId } from '@mygitnotes/core/repository';
import { getWorkspaceNotebooks } from '@mygitnotes/core/workspace-links';
import type { WorkingNotes } from './working-notes.js';

/**
 * Remote drafts live only in this browser, so server pages never contain them. Every server
 * answer is re-judged here against the same core filter the server used, which keeps a staged
 * edit visible in the view it now belongs to without refetching or losing the scroll position.
 * Drafts are keyed by `noteRefKey`.
 */

export interface DraftRows {
  /** Loaded rows with drafts applied; rows a draft moved out of the query are gone. */
  notes: NoteListItem[];
  /** Drafts the server cannot return yet: created, or moved into this query. */
  uncommitted: NoteListItem[];
  /** Loaded rows a draft removed, so the caller can correct the reported total. */
  removed: number;
}

const matches = (note: NoteListItem | null | undefined, query: NoteQuery) => Boolean(note && noteMatchesQuery(note, query));

export function overlayDraftRows(rows: NoteListItem[], query: NoteQuery, drafts: WorkingNotes, options: { hide?: string; } = {}): DraftRows {
  const entries = Object.values(drafts);
  if (!entries.length && !options.hide) return { notes: rows, uncommitted: [], removed: 0 };
  const notes: NoteListItem[] = [];
  let removed = 0;
  for (const row of rows) {
    if (row.path === options.hide) continue;
    const draft = drafts[noteRefKey(row)];
    if (!draft) {
      notes.push(row);
      continue;
    }
    if (matches(draft.note, query)) notes.push(draft.note);
    else removed++;
  }
  const loaded = new Set(rows.map(noteRefKey));
  const uncommitted = entries.filter(entry => entry.note.path !== options.hide && !loaded.has(noteRefKey(entry.note)) && matches(entry.note, query) && !matches(entry.base, query)).map(entry => entry.note);
  return { notes, uncommitted, removed };
}

export function overlayDraftPaths(notes: NoteRef[], query: NoteQuery, drafts: WorkingNotes): NoteRef[] {
  const entries = Object.values(drafts);
  if (!entries.length) return notes;
  const kept = notes.filter(note => !drafts[noteRefKey(note)] || matches(drafts[noteRefKey(note)].note, query));
  const known = new Set(kept.map(noteRefKey));
  return [...kept, ...entries.filter(entry => !known.has(noteRefKey(entry.note)) && matches(entry.note, query)).map(entry => ({ notebookId: entry.note.notebookId, path: entry.note.path }))];
}

/** Lookup answers in the requested order, with a staged draft replacing the committed note. */
export function overlayDraftLookup(refs: NoteRef[], notes: NoteListItem[], drafts: WorkingNotes): NoteListItem[] {
  const byKey = new Map(notes.map(note => [noteRefKey(note), note]));
  return refs.map(ref => drafts[noteRefKey(ref)]?.note || byKey.get(noteRefKey(ref))).filter(Boolean) as NoteListItem[];
}

type FacetSource = Pick<NoteListItem, 'notebookId' | 'path' | 'status' | 'tags' | 'metadata'>;

export function overlayDraftFacets(notebooks: Record<string, NotebookFacets>, drafts: WorkingNotes, showHidden: boolean): Record<string, NotebookFacets> {
  const entries = Object.values(drafts);
  if (!entries.length) return notebooks;
  const result: Record<string, NotebookFacets> = {};
  for (const [id, facets] of Object.entries(notebooks)) {
    result[id] = { total: facets.total, hidden: facets.hidden, statuses: { ...facets.statuses }, tags: { ...facets.tags }, directories: { ...facets.directories } };
  }
  const bump = (counts: Record<string, number>, name: string, sign: number) => {
    const next = (counts[name] || 0) + sign;
    if (next > 0) counts[name] = next;
    else delete counts[name];
  };
  const apply = (note: FacetSource, sign: number) => {
    const facets = result[note.notebookId];
    if (!facets) return;
    const hidden = isNoteHidden({ ...note.metadata, status: note.status });
    if (hidden) facets.hidden = Math.max(0, facets.hidden + sign);
    if (hidden && !showHidden) return;
    facets.total = Math.max(0, facets.total + sign);
    bump(facets.statuses, note.status || '', sign);
    for (const tag of note.tags) bump(facets.tags, tag, sign);
    bump(facets.directories, noteDirectory(note.path), sign);
  };
  for (const entry of entries) {
    if (entry.base) apply(entry.base, -1);
    apply(entry.note, 1);
  }
  return result;
}

export function overlayDraftAgenda(agenda: NoteAgenda, drafts: WorkingNotes, options: { notebookId: string; showHidden: boolean; }): NoteAgenda {
  const entries = Object.values(drafts).filter(entry => (options.notebookId === 'all' || entry.note.notebookId === options.notebookId) && (options.showHidden || !isNoteHidden({ ...entry.note.metadata, status: entry.note.status })));
  if (!Object.keys(drafts).length) return agenda;
  const drafted = new Set(Object.keys(drafts));
  const tasks = [...agenda.tasks.filter(task => !drafted.has(noteRefKey({ notebookId: task.notebookId, path: task.notePath }))), ...extractTodoTasks(entries.map(entry => entry.note))];
  const dated = [...agenda.dated.filter(note => !drafted.has(noteRefKey(note))), ...entries.filter(entry => entry.note.metadata.created !== undefined || entry.note.metadata.updated !== undefined).map(entry => entry.note)];
  return { revisions: agenda.revisions, tasks, dated };
}

export interface GraphDraftNote {
  path: string;
  notebookId: string;
  title: string;
  status?: string;
  tags: string[];
  content: string;
}

/**
 * Replaces a drafted note's outgoing links with the ones its unsaved content carries, and adds nodes for drafts the server has never seen.
 * `repositories` maps each notebook to its repository: a link resolves only among the notes of its note's repository.
 */
export function overlayGraphDrafts(graph: NoteGraphData, drafts: GraphDraftNote[], repositories: Record<string, RepositoryId> = {}): NoteGraphData {
  if (!drafts.length) return graph;
  const nodes = [...graph.nodes];
  const ids = new Set(nodes.map(node => node.id));
  for (const draft of drafts) {
    const id = noteRefKey(draft);
    if (ids.has(id)) continue;
    ids.add(id);
    nodes.push({ id, path: draft.path, title: draft.title || draft.path.split('/').pop() || draft.path, notebookId: draft.notebookId, status: draft.status, tags: draft.tags, inDegree: 0, outDegree: 0, val: 3 });
  }
  const repositoryOf = (notebookId: string) => repositories[notebookId] ?? '';
  const scopes = new Map<string, Map<string, string>>();
  for (const node of nodes) {
    const repository = repositoryOf(node.notebookId);
    if (!scopes.has(repository)) scopes.set(repository, new Map());
    scopes.get(repository)!.set(node.path, node.id);
  }
  const drafted = new Set(drafts.map(noteRefKey));
  const links = graph.links.filter(link => !drafted.has(link.source));
  for (const draft of drafts) {
    const scope = scopes.get(repositoryOf(draft.notebookId))!;
    // The source notebook is known, so its own aliases apply; roots may repeat across repositories.
    const aliases = getWorkspaceNotebooks().find(notebook => notebook.id === draft.notebookId)?.pathAliases ?? {};
    for (const target of extractNoteLinks(draft.content, draft.path, new Set(scope.keys()), aliases)) links.push({ source: noteRefKey(draft), target: scope.get(target)! });
  }
  return { nodes, links };
}

export const draftGraphNotes = (drafts: WorkingNotes): GraphDraftNote[] => Object.values(drafts).map(entry => ({ path: entry.note.path, notebookId: entry.note.notebookId, title: entry.note.title, status: entry.note.status, tags: entry.note.tags, content: entry.note.content }));
