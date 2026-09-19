import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import type { NotebookConfig } from './types.js';
import { parseFolderConfig } from './folders.js';
import { relocateLinks } from './folder-plan.js';
import { relocateWorkspaceDocuments } from './workspace-documents.js';
import { decodeAsset } from './assets.js';
import { LEGACY_WORKSPACE_CONFIG_FILENAME, WORKSPACE_CONFIG_FILENAME } from './config.js';

/* eslint-disable no-control-regex -- Control-character ranges validate paths and distinguish binary data from editable text. */
const filePath = z.string().min(1).max(2048).refine(value => !/[\\\x00-\x1f\x7f]/.test(value) && value.split('/').every(p => p && p !== '.' && p !== '..'), 'Use a relative workspace path.');
/* eslint-enable no-control-regex */
const target = { notebookId: z.string().min(1), path: filePath };
export const FileCommandSchema = z.discriminatedUnion('kind', [z.object({ ...target, kind: z.literal('create') }).strict(), z.object({ ...target, kind: z.literal('write'), content: z.string() }).strict(), z.object({ ...target, kind: z.literal('upload'), base64: z.string() }).strict(), z.object({ ...target, kind: z.literal('mkdir') }).strict(), z.object({ ...target, kind: z.literal('move'), destination: filePath }).strict(), z.object({ ...target, kind: z.literal('delete') }).strict(), z.object({ ...target, kind: z.literal('remove-directory'), destination: filePath }).strict(), z.object({ ...target, kind: z.literal('metadata'), title: z.string().trim().min(1).max(120), description: z.string().max(10000), order: z.number().finite() }).strict()]);
export type FileCommand = z.infer<typeof FileCommandSchema>;
export interface FileSnapshot {
  notebooks: NotebookConfig[];
  directories: string[];
  protectedPaths: string[];
  files: Map<string, Buffer>;
}
export const withinPath = (file: string, dir: string) => file === dir || file.startsWith(dir + '/');

/** File browsing includes assets and dotfiles; note discovery keeps its own narrower rule. */
export function managedNotebook(file: string, notebooks: NotebookConfig[]): NotebookConfig | undefined {
  if (!filePath.safeParse(file).success) return;
  let nb = [...notebooks].sort((a, b) => b.root.length - a.root.length).find(nb => withinPath(file, nb.root));
  if (nb) {
    const relative = file.slice(nb.root.length + 1);
    if (relative.split('/').some(part => ['.git', '.claude', '.codex', '.agents', '.agent', 'node_modules', 'dist', 'build', 'agents.md', 'claude.md', 'gemini.md', WORKSPACE_CONFIG_FILENAME, LEGACY_WORKSPACE_CONFIG_FILENAME].includes(part.toLowerCase())) || /(^|\/)docs\/agent(\/|$)/.test(relative)) return;
    return nb;
  }

  // Also check if file is within a pathAliases target (e.g. blog/src/assets/**)
  nb = notebooks.find(n => {
    if (!n.pathAliases) return false;
    return Object.values(n.pathAliases).some(target => {
      const targetDir = target.replace(/\*$/, '').replace(/\/$/, '');
      return targetDir && withinPath(file, targetDir);
    });
  });
  if (nb) {
    if (file.split('/').some(part => ['.git', '.claude', '.codex', '.agents', '.agent', 'node_modules', 'dist', 'build', 'agents.md', 'claude.md', 'gemini.md', WORKSPACE_CONFIG_FILENAME, LEGACY_WORKSPACE_CONFIG_FILENAME].includes(part.toLowerCase())) || /(^|\/)docs\/agent(\/|$)/.test(file)) return;
    return nb;
  }

  return undefined;
}

export function decodeTextFile(bytes: Uint8Array): string | undefined {
  try {
    const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    /* eslint-disable no-control-regex -- Control-character ranges validate paths and distinguish binary data from editable text. */
    return /[\x00-\x08\x0b\x0e-\x1f]/.test(value) ? undefined : value;
    /* eslint-enable no-control-regex */
  } catch {
    return;
  }
}
export function filePresentation(file: string): 'image' | 'pdf' | 'audio' | 'video' | 'file' {
  if (/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(file)) return 'image';
  if (/\.pdf$/i.test(file)) return 'pdf';
  if (/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file)) return 'audio';
  if (/\.(mp4|webm|mov|m4v)$/i.test(file)) return 'video';
  return 'file';
}
export function editableFile(file: string, bytes: Uint8Array): string | undefined {
  if (filePresentation(file) !== 'file' && !/\.svg$/i.test(file) || /\.(zip|gz|7z|rar|exe|dll|bin|woff2?|ttf|otf)$/i.test(file)) return;
  return decodeTextFile(bytes);
}

export function planFileChange(snapshot: FileSnapshot, input: unknown) {
  const command = FileCommandSchema.parse(input);
  const nb = snapshot.notebooks.find(n => n.id === command.notebookId);
  const assertPath = (file: string, allowRoot = false) => {
    if (!nb || managedNotebook(file, snapshot.notebooks)?.id !== nb.id || !allowRoot && file === nb.root || snapshot.protectedPaths.some(p => withinPath(file, p))) throw new Error('Path is not an editable file in this notebook.');
  };
  assertPath(command.path, command.kind === 'metadata');
  const files = new Map(snapshot.files), directories = new Set(snapshot.directories);
  const exists = (file: string) => files.has(file) || directories.has(file) || snapshot.protectedPaths.includes(file);
  const assertParent = (file: string) => {
    if (!directories.has(path.posix.dirname(file))) throw new Error('Destination directory does not exist.');
  };
  let selectedPath = command.path;
  const pathMap: Record<string, string> = {};
  if (['create', 'upload', 'mkdir'].includes(command.kind)) {
    if (exists(command.path)) throw new Error('Destination already exists.');
    assertParent(command.path);
    if (command.kind === 'mkdir') {
      directories.add(command.path);
      files.set(`${command.path}/_dir.yml`, Buffer.from(YAML.stringify({ title: path.posix.basename(command.path) })));
    } else files.set(command.path, command.kind === 'upload' ? decodeAsset(command.base64) : Buffer.alloc(0));
  } else if (command.kind === 'write') {
    const before = files.get(command.path);
    if (!before || editableFile(command.path, before) === undefined) throw new Error('This file is not editable UTF-8 text.');
    if (Buffer.byteLength(command.content) > 5 * 1024 * 1024) throw new Error('Text files support up to 5 MiB.');
    if (path.posix.basename(command.path) === '_dir.yml') parseFolderConfig(command.content, path.posix.basename(path.posix.dirname(command.path)), command.path);
    files.set(command.path, Buffer.from(command.content));
  } else if (command.kind === 'metadata') {
    if (!directories.has(command.path)) throw new Error('Directory does not exist.');
    const file = command.path + '/_dir.yml';
    const existing = YAML.parse(files.get(file)?.toString('utf8') || '') || {};
    const raw = YAML.stringify({ ...existing, title: command.title, description: command.description, order: command.order });
    parseFolderConfig(raw, command.title, file);
    files.set(file, Buffer.from(raw));
  } else if (command.kind === 'delete') {
    if (!files.has(command.path)) throw new Error('File does not exist.');
    files.delete(command.path);
    selectedPath = path.posix.dirname(command.path);
  } else if (command.kind === 'move' || command.kind === 'remove-directory') {
    const destination = command.destination;
    assertPath(destination, command.kind === 'remove-directory');
    const isDirectory = directories.has(command.path);
    if (!isDirectory && !files.has(command.path)) throw new Error('Source does not exist.');
    if (command.path === destination || isDirectory && withinPath(destination, command.path)) throw new Error('Choose a destination outside the source.');
    if (snapshot.protectedPaths.some(p => withinPath(p, command.path))) throw new Error('This directory contains protected entries.');
    if (snapshot.notebooks.some(other => other.id !== nb!.id && withinPath(other.root, command.path))) throw new Error('This directory contains another notebook.');
    if (command.kind === 'remove-directory') {
      if (!isDirectory || !directories.has(destination)) throw new Error('Choose an existing destination directory.');
    } else {
      assertParent(destination);
      if (exists(destination)) throw new Error('Destination already exists.');
    }
    const relocate = (file: string) => withinPath(file, command.path) ? destination + file.slice(command.path.length) : file;
    const removedMetadata = command.kind === 'remove-directory' ? command.path + '/_dir.yml' : '';
    for (const source of [...directories, ...files.keys()]) {
      if (!withinPath(source, command.path) || source === removedMetadata || command.kind === 'remove-directory' && source === command.path) continue;
      const next = relocate(source);
      assertPath(next);
      if (exists(next)) throw new Error('Destination already exists.');
      pathMap[source] = next;
    }
    files.clear();
    directories.clear();
    for (const dir of snapshot.directories) if (!(command.kind === 'remove-directory' && dir === command.path)) directories.add(relocate(dir));
    for (const [file, bytes] of snapshot.files) {
      if (file === removedMetadata) continue;
      const next = relocate(file);
      const raw = /\.(md|markdown)$/i.test(file) ? decodeTextFile(bytes) : undefined;
      files.set(next, raw === undefined ? bytes : Buffer.from(relocateLinks(raw, file, next, relocate)));
    }
    pathMap[command.path] = destination;
    relocateWorkspaceDocuments({ get: file => files.get(file)?.toString('utf8'), set: (file, text) => files.set(file, Buffer.from(text)) }, { notebooks: snapshot.notebooks, workspace: { default_notebook: snapshot.notebooks[0]?.id } }, nb!.id, relocate);
    selectedPath = destination;
  }
  for (const [file, bytes] of files) if (path.posix.basename(file) === '_dir.yml' && bytes !== snapshot.files.get(file)) parseFolderConfig(bytes.toString('utf8'), path.posix.basename(path.posix.dirname(file)), file);
  return { ...snapshot, files, directories: [...directories], selectedPath, pathMap };
}
