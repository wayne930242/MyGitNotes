import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { NotebookConfig, FolderItem } from './types.js';
import { resolveSafePath } from './path-guard.js';

export function parseFolderConfig(raw: string, fallback: string, filename: string): { title: string; order: number; description?: string } {
  try {
    const data = YAML.parse(raw) ?? {};
    if (typeof data !== 'object' || Array.isArray(data) ||
      (data.title !== undefined && (typeof data.title !== 'string' || !data.title.trim())) ||
      (data.order !== undefined && (typeof data.order !== 'number' || !Number.isFinite(data.order))) ||
      (data.description !== undefined && typeof data.description !== 'string')) throw new Error('Expected title (string), order (number), description (string).');
    return { title: data.title || fallback, order: data.order ?? 0, description: data.description };
  } catch (error) { throw new Error(`Invalid folder configuration ${filename}: ${(error as Error).message}`); }
}

export function isNotebookContent(relative: string, notebook: NotebookConfig): boolean {
  const assetDir = (notebook.assets || 'assets').replace(/\\/g, '/').replace(/\/$/, '');
  return !relative.split('/').some(p => p.startsWith('.') || p.toLowerCase() === 'agents.md' || ['node_modules', 'dist', 'build'].includes(p)) &&
    relative !== assetDir && !relative.startsWith(`${assetDir}/`) && !/(^|\/)docs\/agent(\/|$)/.test(relative);
}

export function sortFolders(folders: FolderItem[]): FolderItem[] {
  const sorted: FolderItem[] = [];
  function visit(parent: string) {
    const children = folders.filter(f => path.posix.dirname(f.path) === (parent || '.'));
    children.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title) || a.path.localeCompare(b.path));
    for (const child of children) { sorted.push(child); visit(child.path); }
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
