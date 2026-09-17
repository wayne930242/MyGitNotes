import type { FileEntry } from './files-api.js';

export interface FileTreeNode {
  path: string;
  name: string;
  depth: number;
  hasNonDocument: boolean;
  children: FileTreeNode[];
}

export interface FileTree {
  roots: FileTreeNode[];
  /** Whether the notebook root itself holds a non-document file, directly or in a descendant — the server excludes the root from `entries`, so no tree node represents it. */
  rootHasNonDocument: boolean;
}

export const isMarkdownFile = (name: string) => /\.(md|markdown)$/i.test(name);

/** `_dir.yml` carries folder metadata rather than user content, so it never counts as a document or an attachment. */
const isStructuralFile = (name: string) => name === '_dir.yml';

/**
 * Builds a nested folder tree from a flat directory listing, marking every folder
 * that contains (directly or in a descendant) a file that is neither Markdown nor
 * structural — the signal the Files page folder view needs to flag "has attachments"
 * without requiring the user to expand every branch.
 */
export function buildFileTree(entries: FileEntry[], root: string): FileTree {
  const dirs = entries.filter(entry => entry.directory);
  const files = entries.filter(entry => !entry.directory);
  const nodeByPath = new Map<string, FileTreeNode>();
  for (const dir of dirs) {
    nodeByPath.set(dir.path, { path: dir.path, name: dir.name, depth: dir.path.slice(root.length + 1).split('/').length - 1, hasNonDocument: false, children: [] });
  }
  const roots: FileTreeNode[] = [];
  for (const dir of dirs) {
    const node = nodeByPath.get(dir.path)!;
    const parent = nodeByPath.get(dir.path.slice(0, dir.path.lastIndexOf('/')));
    if (parent) parent.children.push(node); else roots.push(node);
  }
  let rootHasNonDocument = false;
  for (const file of files) {
    if (isMarkdownFile(file.name) || isStructuralFile(file.name)) continue;
    const parentPath = file.path.slice(0, file.path.lastIndexOf('/'));
    const parent = nodeByPath.get(parentPath);
    if (parent) parent.hasNonDocument = true;
    else if (parentPath === root) rootHasNonDocument = true;
  }
  const propagate = (nodes: FileTreeNode[]): boolean =>
    nodes.reduce((any, node) => { const fromChildren = propagate(node.children); node.hasNonDocument = node.hasNonDocument || fromChildren; return any || node.hasNonDocument; }, false);
  rootHasNonDocument = propagate(roots) || rootHasNonDocument;
  return { roots, rootHasNonDocument };
}

/** Ancestor paths plus `path` itself, nearest root first — used to auto-expand the tree down to the active directory. */
export function expandedPathsFor(path: string, root: string): string[] {
  const relative = path.slice(root.length + 1);
  if (!relative) return [];
  const result: string[] = [];
  let cursor = root;
  for (const part of relative.split('/')) { cursor = cursor + '/' + part; result.push(cursor); }
  return result;
}
