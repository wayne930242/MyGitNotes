import { readFilterQuery } from './filter-query.js';
import { noteWebPath } from '@mygitnotes/core/workspace-links';
import { isBareNotebookId } from '@mygitnotes/core/notebook-key';
import { matchPath } from 'react-router-dom';
import { isCompilationPath } from '@mygitnotes/core/compilation';
export type WorkspaceTab = 'notes' | 'assets' | 'agent' | 'graph' | 'settings';
export function parseWorkspaceRoute(pathname: string, search: string) {
  pathname = pathname.replace(/\/+$/, '') || '/';
  if (pathname === '/files') pathname = '/assets';
  if (pathname === '/index.html' || pathname === '/index' || pathname === '/notebooks') pathname = '/notes';
  const query = new URLSearchParams(search);
  /** The id of a Screen lane named by a former `/screen/lanes/:id` URL, which now resolves to a compilation. */
  let legacyLane: string | null = null;
  let legacyScreen = false;
  let study = false;
  let tab: WorkspaceTab = 'notes';
  let notebook: string | null = null;
  let folder: string | null = null;
  let note: string | null = null;
  let valid = true;
  try {
    const lanePath = matchPath('/screen/lanes/:lane', pathname);
    if (lanePath) {
      legacyScreen = true;
      legacyLane = lanePath.params.lane!;
      valid = /^[a-zA-Z0-9_-]{1,64}$/.test(legacyLane);
    } else if (pathname === '/screen') legacyScreen = true;
    else if (pathname === '/notes/study') study = true;
    else if (['/assets', '/agent', '/graph', '/settings'].includes(pathname)) tab = pathname.slice(1) as WorkspaceTab;
    else if (pathname !== '/' && pathname !== '/notes') {
      const entry = matchPath('/notebooks/:notebook/notes/*', pathname);
      const directory = matchPath('/notebooks/:notebook/folders/*', pathname);
      const root = matchPath('/notebooks/:notebook', pathname);
      const match = entry || directory || root;
      if (!match) valid = false;
      else {
        notebook = decodeURIComponent(match.params.notebook!);
        if (entry) note = decodeURIComponent(entry.params['*']!).replace(/^\/+|\/+$/g, '') || null;
        if (directory) folder = decodeURIComponent(directory.params['*']!).replace(/^\/+|\/+$/g, '') || null;
      }
    }
  } catch {
    valid = false;
  }
  const queryNotebook = query.get('notebook');
  if (queryNotebook) notebook = queryNotebook;
  // `all` named the former all-notebooks scope; it now opens the default notebook.
  const legacyAllNotebooks = notebook === 'all';
  if (legacyAllNotebooks) notebook = null;
  const queryFolder = query.get('folder');
  if (queryFolder) folder = queryFolder;
  if ((note !== null && !safeRelative(note)) || (folder !== null && !safeRelative(folder))) valid = false;
  const filters = readFilterQuery(query);
  const allNotebooks = filters.allNotebooks || (legacyAllNotebooks && (tab === 'notes' || tab === 'graph'));
  // `focus` selects a Focus (or `current`); it is not a filter, so it is read separately from readFilterQuery.
  const queryFocus = query.get('focus');
  const focus = queryFocus && /^[a-zA-Z0-9_-]{1,64}$/.test(queryFocus) ? queryFocus : null;
  // A study session names its compilation by path, in the query.
  const studyPath = study ? query.get('path') : null;
  if (study && (!studyPath || !safeRelative(studyPath))) valid = false;
  return { valid, tab, legacyScreen, legacyLane, study: study && studyPath ? studyPath : null, notebook, folder, note, ...filters, allNotebooks, legacyAllNotebooks, tag: filters.tag[0] || null, tags: filters.tag, focus };
}
/** The canonical URL for a former all-notebooks URL, or null for any other URL. */
export function legacyAllNotebooksRoute(pathname: string, search: string, defaultNotebook: string): string | null {
  const route = parseWorkspaceRoute(pathname, search);
  if (!route.legacyAllNotebooks) return null;
  const query = new URLSearchParams(search);
  query.set('notebook', defaultNotebook);
  if (route.allNotebooks) query.set('allNotebooks', 'true');
  return (route.tab === 'notes' && !route.note ? notebookRoute(defaultNotebook) : pathname) + '?' + query.toString();
}
/**
 * The URL a route naming a notebook by its bare local id redirects to, with the path's notebook segment and the
 * `?notebook=` value replaced by the key `resolve` answers, and the rest of the path and query kept; null when the
 * route names no bare id or `resolve` finds none, which leaves the route to show "notebook not found".
 */
export function bareNotebookRoute(pathname: string, search: string, resolve: (localId: string) => string | null): string | null {
  const route = parseWorkspaceRoute(pathname, search);
  if (!route.valid || route.legacyAllNotebooks) return null;
  const keyOf = (value: string | null) => value !== null && value !== 'all' && isBareNotebookId(value) ? resolve(value) : null;
  const query = new URLSearchParams(search);
  const queryKey = keyOf(query.get('notebook'));
  if (queryKey) query.set('notebook', queryKey);
  const segment = matchPath('/notebooks/:notebook/*', pathname) ?? matchPath('/notebooks/:notebook', pathname);
  const pathKey = segment ? keyOf(decodeURIComponent(segment.params.notebook!)) : null;
  if (!queryKey && !pathKey) return null;
  const path = pathKey ? pathname.replace(/^\/notebooks\/[^/]+/, `/notebooks/${encodeURIComponent(pathKey)}`) : pathname;
  return path + (query.size ? '?' + query.toString() : '');
}
/** An app URL, as a link inside a note names it, with a bare notebook id replaced by its key; unchanged otherwise. */
export function keyedAppUrl(url: string, resolve: (localId: string) => string | null): string {
  const parsed = new URL(url, 'https://workspace.invalid');
  const keyed = bareNotebookRoute(parsed.pathname, parsed.search, resolve);
  return keyed ? keyed + parsed.hash : url;
}
export function safeRelative(value: string) {
  return Boolean(value) && !value.includes('\\') && !value.includes('\0') && value.split('/').every(part => Boolean(part) && part !== '.' && part !== '..');
}
const encodePath = (value: string) => value.split('/').map(encodeURIComponent).join('/');
export function notebookRoute(notebook: string, folder: string | null = null) {
  return `/notebooks/${encodeURIComponent(notebook)}${folder ? '/folders/' + encodePath(folder) : ''}`;
}
export function noteRoute(notebook: string, relativePath: string) {
  return noteWebPath(notebook, relativePath);
}

// Editor URLs carry their workspace origin so closing and reloading preserve context.
export function noteReturnRoute(search: string, notebook: string, folder: string | null = null): string {
  const query = new URLSearchParams(search);
  const origin = query.get('returnTo');
  if (origin === 'graph') return `/${origin}?notebook=${encodeURIComponent(notebook)}`;
  if (origin?.startsWith('/') && !origin.startsWith('//') && !origin.includes('\\')) {
    const url = new URL(origin, 'https://workspace.invalid');
    const route = parseWorkspaceRoute(url.pathname, url.search);
    if (route.valid && !route.note && !url.searchParams.has('returnTo')) return url.pathname + url.search + url.hash;
  }
  query.delete('returnTo');
  query.delete('folder');
  return notebookRoute(notebook, folder) + (query.size ? '?' + query.toString() : '');
}

// The notes a reader opened on the way to the current one, kept in history state so `returnTo` stays
// the browse view behind the editor; a history entry with no trail closes to `returnTo` as before.
export function noteTrail(state: unknown): string[] {
  const trail = (state as { noteTrail?: unknown; } | null)?.noteTrail;
  return Array.isArray(trail) ? trail.filter((entry): entry is string => typeof entry === 'string' && entry.startsWith('/') && !entry.startsWith('//') && !entry.includes('\\')) : [];
}

/**
 * The compilation a zoomed note was opened from: the last route of the trail when it names a compilation file of the
 * same notebook, as a path within the repository. It stays open behind the note, so a section still editing in place
 * returns to it, with its editing state, when the note closes.
 */
export function trailCompilation(state: unknown, notebook: string | null, notebookRoot: string): string | null {
  const previous = noteTrail(state).at(-1);
  if (!previous) return null;
  const url = new URL(previous, 'http://workspace.invalid');
  const route = parseWorkspaceRoute(url.pathname, url.search);
  if (!route.valid || route.tab !== 'notes' || !route.note || route.notebook !== notebook) return null;
  const path = `${notebookRoot}/${route.note}`;
  return isCompilationPath(path) ? path : null;
}

/** The study session of one compilation. */
export function compilationStudyRoute(notebook: string, path: string) {
  return `/notes/study?${new URLSearchParams({ notebook, path })}`;
}
