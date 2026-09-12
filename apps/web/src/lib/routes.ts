import { matchPath } from 'react-router-dom';
import type { ViewMode } from './types.js';
export type WorkspaceTab = 'notes' | 'assets' | 'agent' | 'settings';
export function parseWorkspaceRoute(pathname: string, search: string) {
  pathname = pathname.replace(/\/+$/, '') || '/';
  if (pathname === '/index.html' || pathname === '/index' || pathname === '/notebooks') pathname = '/notes';
  const query = new URLSearchParams(search);
  let tab: WorkspaceTab = 'notes'; let notebook: string | null = null; let folder: string | null = null; let note: string | null = null; let valid = true;
  try {
    if (['/assets','/agent','/settings'].includes(pathname)) tab=pathname.slice(1) as WorkspaceTab;
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
  const queryFolder = query.get('folder');
  if (queryFolder) folder = queryFolder;
  if((note!==null&&!safeRelative(note))||(folder!==null&&!safeRelative(folder)))valid=false;
  return {valid,tab,notebook,folder,note,showHidden:query.get('showHidden') === 'true',view:(['list','card','kanban'].includes(query.get('view')||'')?query.get('view'):'list') as ViewMode,status:query.get('status'),tag:query.get('tag'),q:query.get('q')||''};
}
export function safeRelative(value: string) { return Boolean(value)&&!value.includes('\\')&&!value.includes('\0')&&value.split('/').every(part=>Boolean(part)&&part!=='.'&&part!=='..'); }
const encodePath = (value: string) => value.split('/').map(encodeURIComponent).join('/');
export function notebookRoute(notebook: string, folder: string | null = null) {
  return `/notebooks/${encodeURIComponent(notebook)}${folder ? '/folders/'+encodePath(folder) : ''}`;
}
export function noteRoute(notebook: string, relativePath: string) { return `/notebooks/${encodeURIComponent(notebook)}/notes/${encodePath(relativePath)}`; }
