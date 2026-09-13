import type { FolderCommand } from '@github-notes/core';
import type { FolderItem } from './types.js';
export const folderParent = (file: string) => file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
export function folderDropCommand(notebookId: string, source: string, target: string, position: 'inside' | 'before' | 'after', folders: FolderItem[]): FolderCommand | null {
  if (!source || target === source || target.startsWith(source + '/')) return null;
  const parent = position === 'inside' ? target : folderParent(target);
  const siblings = folders.filter(folder => folder.notebookId === notebookId && folderParent(folder.path) === parent && folder.path !== source);
  const before = position === 'before' ? target : position === 'after' ? siblings[siblings.findIndex(folder => folder.path === target) + 1]?.path : undefined;
  return { kind: 'move', notebookId, path: source, parent, ...(before ? { before } : {}) };
}
