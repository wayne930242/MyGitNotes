import type { FolderCommand } from '@mygitnotes/core';
import type { FolderItem } from './types.js';
import { parentPath } from './paths.js';
export function folderDropCommand(notebookId: string, source: string, target: string, position: 'inside' | 'before' | 'after', folders: FolderItem[]): FolderCommand | null {
  if (!source || target === source || target.startsWith(source + '/')) return null;
  const parent = position === 'inside' ? target : parentPath(target);
  const siblings = folders.filter(folder => folder.notebookId === notebookId && parentPath(folder.path) === parent && folder.path !== source);
  const before = position === 'before' ? target : position === 'after' ? siblings[siblings.findIndex(folder => folder.path === target) + 1]?.path : undefined;
  return { kind: 'move', notebookId, path: source, parent, ...(before ? { before } : {}) };
}
