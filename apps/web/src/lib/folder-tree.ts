import { FolderItem, NoteItem } from './types.js';
import { noteFolder } from './note-paths.js';

export interface SubfolderInfo {
  path: string;
  name: string;
  title: string;
  noteCount: number;
  description?: string;
}

export interface BreadcrumbSegment {
  name: string;
  path: string | null;
}

/**
 * Chooses the folder-click callback: a plain click switches to a single folder,
 * shift+click (or ctrl/cmd+click) toggles a folder into or out of a multi-selection.
 * A touch long-press enters the same multi-select toggling for every following tap
 * until `touchMultiSelect` is cleared (see Sidebar's exit-when-empty effect).
 */
export function resolveFolderClick(
  event: {
    shiftKey: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    pointerType?: string;
    nativeEvent?: { pointerType?: string };
  },
  onSelect: (folder: string | null) => void,
  onFilterFolder?: (folder: string | null) => void,
  touchMultiSelect = false
): (folder: string | null) => void {
  const isMouse = event.pointerType === 'mouse' || event.nativeEvent?.pointerType === 'mouse';
  const hasModifier = Boolean(event.shiftKey || event.ctrlKey || event.metaKey);
  const shouldToggle = hasModifier || (touchMultiSelect && !isMouse);
  return shouldToggle && onFilterFolder ? onFilterFolder : onSelect;
}

/**
 * Resolves the updated folder selection when entering touch multi-select mode.
 * Guarantees that the targeted folder becomes selected and is not removed even if
 * it was already part of the current selection.
 */
export function resolveEnterTouchMultiSelect(
  currentFolders: string[],
  notebookRoot: string | undefined,
  folder: string
): string[] {
  if (!notebookRoot || !folder) return currentFolders;
  const root = notebookRoot.replace(/\/$/, '');
  const path = `${root}/${folder}`;
  return currentFolders.includes(path) ? currentFolders : [...currentFolders, path];
}

/**
 * A plain click's single-select target has no meaning against the global
 * `selectedNotebookId` while the sidebar shows every notebook's tree at once —
 * it must resolve to that folder's own notebook-qualified path instead. Returns
 * null when only one notebook is shown, so the caller falls back to its normal
 * single-notebook selection path.
 */
export function resolveAllNotebooksFolderSelect(
  selectedNotebookId: string,
  notebookRoot: string | undefined,
  folder: string | null
): string[] | null {
  if (selectedNotebookId !== 'all') return null;
  if (!notebookRoot || !folder) return [];
  return [`${notebookRoot}/${folder}`];
}

/**
 * Extracts immediate subfolders under `currentFolder` for a specific notebook.
 * Discovers subfolders from both explicit FolderItem records and existing note paths.
 */
export function getImmediateSubfolders(
  notes: NoteItem[],
  folders: FolderItem[],
  notebookId: string,
  notebookRoot: string,
  currentFolder: string | null
): SubfolderInfo[] {
  const notebookNotes = notes.filter((n) => n.notebookId === notebookId);
  const notebookFolders = folders.filter((f) => f.notebookId === notebookId);

  // Normalize current folder prefix
  const prefix = currentFolder ? `${currentFolder}/` : '';
  const folderMap = new Map<string, SubfolderInfo>();

  // 1. Discover from explicit folder items
  for (const f of notebookFolders) {
    if (currentFolder === null) {
      if (!f.path.includes('/')) {
        folderMap.set(f.path, {
          path: f.path,
          name: f.path,
          title: f.title || f.path,
          noteCount: 0,
          description: f.description,
        });
      }
    } else if (f.path.startsWith(prefix)) {
      const rest = f.path.slice(prefix.length);
      if (rest && !rest.includes('/')) {
        folderMap.set(f.path, {
          path: f.path,
          name: rest,
          title: f.title || rest,
          noteCount: 0,
          description: f.description,
        });
      }
    }
  }

  // 2. Discover from note paths (in case folders are not in manifest)
  const rootPrefix = notebookRoot.replace(/\/$/, '') + '/';
  for (const n of notebookNotes) {
    if (!n.path.startsWith(rootPrefix)) continue;
    const rel = n.path.slice(rootPrefix.length);
    if (!rel.includes('/')) continue; // Note at root of notebook

    const noteDir = rel.slice(0, rel.lastIndexOf('/'));
    if (currentFolder === null) {
      const firstSegment = noteDir.split('/')[0];
      if (!folderMap.has(firstSegment)) {
        folderMap.set(firstSegment, {
          path: firstSegment,
          name: firstSegment,
          title: firstSegment,
          noteCount: 0,
        });
      }
    } else if (noteDir.startsWith(prefix)) {
      const rest = noteDir.slice(prefix.length);
      const firstSubSegment = rest.split('/')[0];
      if (firstSubSegment) {
        const fullSubPath = `${prefix}${firstSubSegment}`;
        if (!folderMap.has(fullSubPath)) {
          folderMap.set(fullSubPath, {
            path: fullSubPath,
            name: firstSubSegment,
            title: firstSubSegment,
            noteCount: 0,
          });
        }
      }
    }
  }

  // 3. Compute recursive note counts for each immediate subfolder
  for (const subfolder of folderMap.values()) {
    const subPrefix = `${subfolder.path}/`;
    const count = notebookNotes.filter((n) => {
      const f = noteFolder(n.path, notebookRoot);
      return f === subfolder.path || f.startsWith(subPrefix);
    }).length;
    subfolder.noteCount = count;
  }

  const orders = new Map(notebookFolders.map(folder => [folder.path, folder.order]));
  return Array.from(folderMap.values()).sort((a, b) =>
    (orders.get(a.path) || 0) - (orders.get(b.path) || 0) ||
    a.title.localeCompare(b.title) || a.path.localeCompare(b.path)
  );
}

/**
 * Returns notes located directly inside `currentFolder` (not in deeper subfolders).
 */
export function getImmediateNotes(
  notes: NoteItem[],
  notebookRoot: string,
  currentFolder: string | null
): NoteItem[] {
  const targetFolder = currentFolder || '';
  return notes.filter((n) => noteFolder(n.path, notebookRoot) === targetFolder);
}

/**
 * Generates breadcrumb segments from root ('All folders') to `currentFolder`.
 */
export function getBreadcrumbs(
  currentFolder: string | null,
  folders: FolderItem[],
  notebookId: string,
  allFoldersLabel = 'All folders'
): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = [
    { name: allFoldersLabel, path: null },
  ];

  if (!currentFolder) {
    return segments;
  }

  const parts = currentFolder.split('/').filter(Boolean);
  let accumulated = '';

  for (const part of parts) {
    accumulated = accumulated ? `${accumulated}/${part}` : part;
    const match = folders.find(
      (f) => f.notebookId === notebookId && f.path === accumulated
    );
    segments.push({
      name: match?.title || part,
      path: accumulated,
    });
  }

  return segments;
}

export interface FolderTreeNode {
  folder: FolderItem;
  path: string;
  name: string;
  title: string;
  depth: number;
  children: FolderTreeNode[];
}

export function buildFolderTree(folders: FolderItem[], notebookId: string): FolderTreeNode[] {
  const scopedFolders = folders.filter(f => f.notebookId === notebookId);
  const nodeMap = new Map<string, FolderTreeNode>();

  for (const f of scopedFolders) {
    const name = f.path.includes('/') ? f.path.slice(f.path.lastIndexOf('/') + 1) : f.path;
    nodeMap.set(f.path, {
      folder: f,
      path: f.path,
      name,
      title: f.title || name,
      depth: 0,
      children: [],
    });
  }

  for (const f of scopedFolders) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const ancestorPath = parts.slice(0, i).join('/');
      if (!nodeMap.has(ancestorPath)) {
        const ancestorName = parts[i - 1];
        nodeMap.set(ancestorPath, {
          folder: {
            notebookId,
            path: ancestorPath,
            title: ancestorName,
            order: 0,
          },
          path: ancestorPath,
          name: ancestorName,
          title: ancestorName,
          depth: 0,
          children: [],
        });
      }
    }
  }

  const roots: FolderTreeNode[] = [];
  for (const node of nodeMap.values()) {
    const lastSlash = node.path.lastIndexOf('/');
    if (lastSlash === -1) {
      roots.push(node);
    } else {
      const parentPath = node.path.slice(0, lastSlash);
      const parent = nodeMap.get(parentPath);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }

  function sortBranch(nodes: FolderTreeNode[], depth: number) {
    nodes.sort((a, b) => (a.folder.order - b.folder.order) || a.title.localeCompare(b.title));
    for (const node of nodes) {
      node.depth = depth;
      if (node.children.length > 0) {
        sortBranch(node.children, depth + 1);
      }
    }
  }

  sortBranch(roots, 0);
  return roots;
}

export function expandedPathsForFolder(path: string | null): string[] {
  if (!path) return [];
  const parts = path.split('/');
  const result: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    result.push(parts.slice(0, i).join('/'));
  }
  return result;
}

