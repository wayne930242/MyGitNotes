import type { NoteItem, NotebookConfig } from './types.js';
import { isNoteHidden } from './note-status.js';
import type { NoteGraphData } from './note-graph.js';

export interface NoteFilters {
  notebookId: string;
  folders: string[];
  descendants: boolean;
  tags: string[];
  tagMode: 'any' | 'all';
  q: string;
  status: string | null;
  showHidden: boolean;
}

export function safeFilterPath(value: string): boolean {
  return Boolean(value) && !value.includes('\\') && !value.includes('\0')
    && value.split('/').every(part => Boolean(part) && part !== '.' && part !== '..');
}

export function filterNotes(notes: NoteItem[], filters: NoteFilters): NoteItem[] {
  const q = filters.q.toLowerCase();
  return notes.filter(note => {
    if (!filters.showHidden && isNoteHidden({ ...note.metadata, status: note.status })) return false;
    if (filters.notebookId !== 'all' && note.notebookId !== filters.notebookId) return false;
    if (filters.folders.length && !filters.folders.some(folder => {
      const directory = note.path.slice(0, note.path.lastIndexOf('/'));
      return directory === folder || (filters.descendants && directory.startsWith(folder + '/'));
    })) return false;
    if (filters.status && note.status !== filters.status) return false;
    if (filters.tags.length && !(filters.tagMode === 'all'
      ? filters.tags.every(tag => note.tags.includes(tag))
      : filters.tags.some(tag => note.tags.includes(tag)))) return false;
    return !q.trim() || [note.title, note.content, note.status || '', ...note.tags]
      .some(text => text.toLowerCase().includes(q));
  });
}

export function legacyFolderPaths(notebooks: NotebookConfig[], notebookId: string, folder: string | null): string[] {
  const notebook = notebooks.find(item => item.id === notebookId);
  return notebook && folder ? [notebook.root.replace(/\/$/, '') + '/' + folder] : [];
}

/** Expand from the original matches once; external nodes never become new seeds. */
export function selectFilteredGraph(graph: NoteGraphData, matchingIds: Set<string>, includeNeighbors: boolean): NoteGraphData {
  const included = new Set(matchingIds);
  if (includeNeighbors) {
    for (const link of graph.links) {
      if (matchingIds.has(link.source)) included.add(link.target);
      if (matchingIds.has(link.target)) included.add(link.source);
    }
  }
  const links = graph.links.filter(link => included.has(link.source) && included.has(link.target));
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const link of links) {
    inbound.set(link.target, (inbound.get(link.target) || 0) + 1);
    outbound.set(link.source, (outbound.get(link.source) || 0) + 1);
  }
  return { links, nodes: graph.nodes.filter(node => included.has(node.id)).map(node => ({
    ...node, external: !matchingIds.has(node.id), inDegree: inbound.get(node.id) || 0,
    outDegree: outbound.get(node.id) || 0,
  })) };
}
