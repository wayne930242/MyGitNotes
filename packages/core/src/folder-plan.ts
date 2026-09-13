import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { isNotebookContent, parseFolderConfig, sortFolders } from './folders.js';
import { SCREEN_PAGE_FILE, ScreenPageSchema } from './screen-page.js';
import type { NotebookConfig, FolderItem } from './types.js';

const relative = z.string().max(512).refine(value => !value || !/[\\\0]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..'));
export const FolderCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), notebookId: z.string(), parent: relative, name: relative.refine(value => Boolean(value) && !value.includes('/')), title: z.string().trim().min(1).max(120).optional() }).strict(),
  z.object({ kind: z.literal('move'), notebookId: z.string(), path: relative.refine(Boolean), parent: relative, before: relative.optional() }).strict(),
  z.object({ kind: z.literal('delete'), notebookId: z.string(), path: relative.refine(Boolean), destination: relative }).strict(),
]);
export type FolderCommand = z.infer<typeof FolderCommandSchema>;
export interface FolderSnapshot { notebooks: NotebookConfig[]; directories: string[]; protectedPaths: string[]; files: Map<string, string> }
const inside = (file: string, dir: string) => file === dir || file.startsWith(dir + '/');
const parentOf = (file: string) => path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file);

/** Resolve links against the original document, then express them from its new location. */
function relocateLinks(raw: string, oldFile: string, newFile: string, relocate: (file: string) => string): string {
  const rewrite = (href: string) => {
    if (!href || /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(href)) return href;
    const match = /^([^?#]*)(.*)$/.exec(href)!;
    let decoded: string;
    try { decoded = decodeURIComponent(match[1]); } catch { return href; }
    const root = decoded.startsWith('/') || decoded.startsWith('notes/');
    const target = root ? decoded.replace(/^\//, '') : path.posix.normalize(path.posix.join(path.posix.dirname(oldFile), decoded));
    const moved = relocate(target);
    if (moved === target && oldFile === newFile) return href;
    let next = root ? (decoded.startsWith('/') ? '/' : '') + moved : path.posix.relative(path.posix.dirname(newFile), moved) || '.';
    next = next.split('/').map(segment => encodeURIComponent(segment)).join('/');
    return next + match[2];
  };
  // Preserve frontmatter, fenced/inline code. Handle inline destinations and reference definitions.
  return raw.replace(/(^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$))|(^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\3[^\n]*(?:\n|$))|(`+)[\s\S]*?\4|(!?\[[^\]\n]*\]\()(<[^>\n]*>|(?:\\.|[^\s()])+)([^\n)]*\))|(^ {0,3}\[[^\]\n]+\]:\s*)(<[^>\n]*>|\S+)/gm,
    (all, front, fence, _marker, code, start, destination, end, ref, refDest) => {
      if (front || fence || code) return all;
      const value = destination || refDest;
      const angle = value.startsWith('<');
      const next = rewrite(angle ? value.slice(1, -1) : value);
      return (start || ref) + (angle ? `<${next}>` : next) + (end || '');
    });
}

export function planFolderChange(snapshot: FolderSnapshot, input: unknown) {
  const command = FolderCommandSchema.parse(input);
  const notebook = snapshot.notebooks.find(nb => nb.id === command.notebookId);
  if (!notebook) throw new Error('Notebook does not exist.');
  const root = notebook.root.replace(/\/$/, '');
  const full = (relative: string) => relative ? `${root}/${relative}` : root;
  const source = command.kind === 'create' ? '' : full(command.path);
  const parent = command.kind === 'delete' ? command.destination : command.parent;
  const destination = command.kind === 'create' ? full(path.posix.join(parent, command.name)) : command.kind === 'move' ? full(path.posix.join(parent, path.posix.basename(command.path))) : full(parent);
  if (parent && !isNotebookContent(parent, notebook) || !isNotebookContent(destination.slice(root.length + 1), notebook)) throw new Error('Protected folder.');
  if (!snapshot.directories.includes(full(parent))) throw new Error('Destination folder does not exist.');
  if (source && (!snapshot.directories.includes(source) || !isNotebookContent(command.kind === 'create' ? '' : command.path, notebook))) throw new Error('Folder does not exist or is protected.');
  if (source && inside(full(parent), source)) throw new Error('A folder cannot contain itself.');
  if (source && source !== destination && snapshot.protectedPaths.some(file => inside(file, source))) throw new Error('Folder contains protected files. Move these separately first.');
  if (command.kind === 'create' && (snapshot.directories.includes(destination) || snapshot.files.has(destination) || snapshot.protectedPaths.some(file => inside(file, destination)))) throw new Error('Destination already exists.');
  const relocate = (file: string) => source && inside(file, source) ? destination + file.slice(source.length) : file;
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const removedMetadata = command.kind === 'delete' ? `${source}/_dir.yml` : '';
  for (const dir of snapshot.directories) {
    if (command.kind === 'delete' && dir === source) continue;
    const next = relocate(dir);
    if (dir !== next && (snapshot.directories.includes(next) && !inside(next, source) || snapshot.files.has(next) || snapshot.protectedPaths.includes(next))) throw new Error('Destination already exists.');
    directories.add(next);
  }
  for (const [file, raw] of snapshot.files) {
    if (file === removedMetadata) continue;
    const next = relocate(file);
    if (file !== next && (snapshot.files.has(next) && !inside(next, source) || snapshot.directories.includes(next) || snapshot.protectedPaths.includes(next))) throw new Error('Destination already exists.');
    files.set(next, /\.(md|markdown)$/i.test(file) ? relocateLinks(raw, file, next, relocate) : raw);
  }
  if (command.kind === 'create') {
    directories.add(destination);
    files.set(`${destination}/_dir.yml`, YAML.stringify({ title: command.title || command.name }));
  }
  if (source && source !== destination && files.has(SCREEN_PAGE_FILE)) {
    const raw = files.get(SCREEN_PAGE_FILE)!;
    const page = ScreenPageSchema.parse(YAML.parse(raw, { maxAliasCount: 20 }));
    let changed = false;
    const update = (item: { notebookId: string; path: string }) => {
      if (item.notebookId !== notebook.id) return;
      const next = relocate(item.path); if (next !== item.path) { item.path = next; changed = true; }
    };
    for (const row of page.rows) {
      if (row.kind === 'custom') for (const item of row.items) { if (item.kind !== 'youtube') update(item); }
      else if (row.source.kind === 'folder') update(row.source);
    }
    if (changed) files.set(SCREEN_PAGE_FILE, YAML.stringify(page, { lineWidth: 0 }));
  }
  const folders = (): FolderItem[] => sortFolders([...directories].filter(dir => dir.startsWith(root + '/') && isNotebookContent(dir.slice(root.length + 1), notebook)).map(dir => ({
    notebookId: notebook.id, path: dir.slice(root.length + 1), ...parseFolderConfig(files.get(`${dir}/_dir.yml`) || '', path.posix.basename(dir), dir),
  })));
  const siblings = folders().filter(folder => parentOf(folder.path) === parent);
  if (command.kind !== 'delete') {
    const current = destination.slice(root.length + 1);
    const list = siblings.filter(folder => folder.path !== current);
    const before = command.kind === 'move' ? command.before : undefined;
    if (before && !list.some(folder => folder.path === before)) throw new Error('Reorder target must be a different sibling.');
    list.splice(before ? list.findIndex(folder => folder.path === before) : list.length, 0, siblings.find(folder => folder.path === current)!);
    list.forEach((folder, order) => {
      const file = `${full(folder.path)}/_dir.yml`;
      files.set(file, YAML.stringify({ ...(YAML.parse(files.get(file) || '') || {}), order }));
    });
  }
  return { files, directories: [...directories], folders: folders(), selectedPath: command.kind === 'delete' ? parent : destination.slice(root.length + 1) };
}
