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
