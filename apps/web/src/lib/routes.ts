import { readFilterQuery } from './filter-query.js';
import { noteWebPath } from '@mygitnotes/core/workspace-links';
import { matchPath } from 'react-router-dom';
export type WorkspaceTab = 'notes' | 'assets' | 'agent' | 'screen' | 'graph' | 'settings';
export function parseWorkspaceRoute(pathname: string, search: string) {
  pathname = pathname.replace(/\/+$/, '') || '/';
  if (pathname === '/files') pathname = '/assets';
  if (pathname === '/index.html' || pathname === '/index' || pathname === '/notebooks') pathname = '/notes';
  const query = new URLSearchParams(search);
  let lane: string | null = null;
  let tab: WorkspaceTab = 'notes'; let notebook: string | null = null; let folder: string | null = null; let note: string | null = null; let valid = true;
  try {
    const focus = matchPath('/screen/lanes/:lane', pathname);
    if (focus) { tab = 'screen'; lane = focus.params.lane!; valid = /^[a-zA-Z0-9_-]{1,64}$/.test(lane); }
    else if (['/assets','/agent','/screen','/graph','/settings'].includes(pathname)) tab=pathname.slice(1) as WorkspaceTab;
    else if (pathname !== '/' && pathname !== '/notes') {
      const entry=matchPath('/notebooks/:notebook/notes/*',pathname);
      const directory=matchPath('/notebooks/:notebook/folders/*',pathname);
      const root=matchPath('/notebooks/:notebook',pathname);
      const match=entry||directory||root;
      if(!match)valid=false;
      else {
        notebook=decodeURIComponent(match.params.notebook!);
        if(entry)note=decodeURIComponent(entry.params['*']!).replace(/^\/+|\/+$/g, '') || null;
        if(directory)folder=decodeURIComponent(directory.params['*']!).replace(/^\/+|\/+$/g, '') || null;
      }
    }
  }catch {valid=false;}
  const queryNotebook = query.get('notebook');
  if (queryNotebook) notebook = queryNotebook;
  // `all` named the former all-notebooks scope; it now opens the default notebook.
  const legacyAllNotebooks = notebook === 'all';
  if (legacyAllNotebooks) notebook = null;
  const queryFolder = query.get('folder');
  if (queryFolder) folder = queryFolder;
  if((note!==null&&!safeRelative(note))||(folder!==null&&!safeRelative(folder)))valid=false;
  const filters = readFilterQuery(query);
  const allNotebooks = filters.allNotebooks || (legacyAllNotebooks && (tab === 'notes' || tab === 'graph'));
  // `focus` selects a Focus (or `current`); it is not a filter, so it is read separately from readFilterQuery.
  const queryFocus = query.get('focus');
  const focus = queryFocus && /^[a-zA-Z0-9_-]{1,64}$/.test(queryFocus) ? queryFocus : null;
  return {valid,tab,lane,notebook,folder,note,...filters,allNotebooks,legacyAllNotebooks,tag:filters.tag[0] || null,tags:filters.tag,focus};
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
export function safeRelative(value: string) { return Boolean(value)&&!value.includes('\\')&&!value.includes('\0')&&value.split('/').every(part=>Boolean(part)&&part!=='.'&&part!=='..'); }
const encodePath = (value: string) => value.split('/').map(encodeURIComponent).join('/');
export function notebookRoute(notebook: string, folder: string | null = null) {
  return `/notebooks/${encodeURIComponent(notebook)}${folder ? '/folders/'+encodePath(folder) : ''}`;
}
export function noteRoute(notebook: string, relativePath: string) { return noteWebPath(notebook, relativePath); }

// Editor URLs carry their workspace origin so closing and reloading preserve context.
export function noteReturnRoute(search: string, notebook: string, folder: string | null = null): string {
  const query = new URLSearchParams(search);
  const origin = query.get('returnTo');
  if (origin === 'screen' || origin === 'graph') return `/${origin}?notebook=${encodeURIComponent(notebook)}`;
  if (origin?.startsWith('/') && !origin.startsWith('//') && !origin.includes('\\')) {
    const url = new URL(origin, 'https://workspace.invalid');
    const route = parseWorkspaceRoute(url.pathname, url.search);
    if (route.valid && !route.note && !url.searchParams.has('returnTo')) return url.pathname + url.search + url.hash;
  }
  query.delete('returnTo');
  query.delete('folder');
  return notebookRoute(notebook, folder) + (query.size ? '?' + query.toString() : '');
}

export function screenLaneRoute(laneId: string) { return `/screen/lanes/${encodeURIComponent(laneId)}`; }
