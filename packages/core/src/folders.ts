import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { FolderItem, FolderMetadata, NotebookConfig } from './types.js';
import { resolveSafePath } from './path-guard.js';
import { loadWorkspaceConfig } from './config.js';

export function parseFolderConfig(raw: string, fallback: string, filename: string): { title: string; order: number; description?: string; } {
  try {
    const data = YAML.parse(raw) ?? {};
    if (typeof data !== 'object' || Array.isArray(data) || (data.title !== undefined && (typeof data.title !== 'string' || !data.title.trim())) || (data.order !== undefined && (typeof data.order !== 'number' || !Number.isFinite(data.order))) || (data.description !== undefined && typeof data.description !== 'string')) throw new Error('Expected title (string), order (number), description (string).');
    return { title: data.title || fallback, order: data.order ?? 0, description: data.description };
  } catch (error) {
    throw new Error(`Invalid folder configuration ${filename}: ${(error as Error).message}`);
  }
}

export function isNotebookContent(relative: string, notebook: NotebookConfig): boolean {
  const assetDir = (notebook.assets || 'assets').replace(/\\/g, '/').replace(/\/$/, '');
  return !relative.split('/').some(p => p.startsWith('.') || p.toLowerCase() === 'agents.md' || ['node_modules', 'dist', 'build'].includes(p)) && relative !== assetDir && !relative.startsWith(`${assetDir}/`) && !/(^|\/)docs\/agent(\/|$)/.test(relative);
}

export function sortFolders(folders: FolderItem[]): FolderItem[] {
  const sorted: FolderItem[] = [];
  function visit(parent: string) {
    const children = folders.filter(f => path.posix.dirname(f.path) === (parent || '.'));
    children.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title) || a.path.localeCompare(b.path));
    for (const child of children) {
      sorted.push(child);
      visit(child.path);
    }
  }
  visit('');
  return sorted;
}

export function scanNotebookFolders(repoRoot: string, notebook: NotebookConfig): FolderItem[] {
  const root = resolveSafePath(repoRoot, notebook.root);
  if (!fs.existsSync(root)) return [];
  const folders: FolderItem[] = [];
  function visit(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).replace(/\\/g, '/');
      if (!isNotebookContent(relative, notebook)) continue;
      const file = resolveSafePath(repoRoot, path.relative(repoRoot, path.join(full, '_dir.yml')));
      const metadata = parseFolderConfig(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '', entry.name, file);
      folders.push({ notebookId: notebook.id, path: relative, ...metadata });
      visit(full);
    }
  }
  visit(root);
  return sortFolders(folders);
}

export function serializeFolderConfig(metadata: FolderMetadata): string {
  const data: Record<string, unknown> = {};
  if (metadata.title !== undefined) data.title = metadata.title;
  if (metadata.order !== undefined) data.order = metadata.order;
  if (metadata.description !== undefined) data.description = metadata.description;
  for (const [k, v] of Object.entries(metadata)) {
    if (k !== 'title' && k !== 'order' && k !== 'description' && v !== undefined) {
      data[k] = v;
    }
  }
  return YAML.stringify(data);
}

export function getFolderItem(repoRoot: string, folderRelPath: string): FolderItem | null {
  const normalizedRel = folderRelPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const fullFolder = resolveSafePath(repoRoot, normalizedRel);
  if (!fs.existsSync(fullFolder) || !fs.statSync(fullFolder).isDirectory()) return null;
  const config = loadWorkspaceConfig(repoRoot);
  if (!config) return null;
  const nb = config.notebooks.find((n) => normalizedRel === n.root || normalizedRel.startsWith(`${n.root}/`));
  if (!nb) return null;
  const relInNb = normalizedRel === nb.root ? '' : normalizedRel.slice(nb.root.length + 1);
  if (relInNb && !isNotebookContent(relInNb, nb)) return null;

  const file = resolveSafePath(repoRoot, path.posix.join(normalizedRel, '_dir.yml'));
  const fallback = path.posix.basename(normalizedRel) || nb.title;
  const metadata = parseFolderConfig(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '', fallback, file);
  return { notebookId: nb.id, path: relInNb, ...metadata };
}

export function writeFolderConfig(repoRoot: string, folderRelPath: string, metadata: FolderMetadata): { folder: FolderItem; dirFileRel: string; } {
  const normalizedRel = folderRelPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const fullFolder = resolveSafePath(repoRoot, normalizedRel);
  if (!fs.existsSync(fullFolder)) {
    fs.mkdirSync(fullFolder, { recursive: true });
  }
  const config = loadWorkspaceConfig(repoRoot);
  const nb = config?.notebooks.find((n) => normalizedRel === n.root || normalizedRel.startsWith(`${n.root}/`));
  const notebookId = nb ? nb.id : 'default';
  const relInNb = nb ? (normalizedRel === nb.root ? '' : normalizedRel.slice(nb.root.length + 1)) : normalizedRel;

  const dirFileRel = path.posix.join(normalizedRel, '_dir.yml');
  const dirFileFull = resolveSafePath(repoRoot, dirFileRel);

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(dirFileFull)) {
    try {
      existing = YAML.parse(fs.readFileSync(dirFileFull, 'utf8')) || {};
    } catch {
      // ignore
    }
  }

  const merged = { ...existing, ...metadata };
  const fallback = path.posix.basename(normalizedRel);
  const validated = parseFolderConfig(YAML.stringify(merged), fallback, dirFileFull);
  const content = serializeFolderConfig(merged);
  fs.writeFileSync(dirFileFull, content, 'utf8');

  return { folder: { notebookId, path: relInNb, ...validated }, dirFileRel };
}
