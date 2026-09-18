import { Router, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getCurrentBranch } from '@mygitnotes/git';
import {
  loadWorkspaceConfig, resolveSafePath, managedNotebook, withinPath, editableFile, filePresentation, isNotebookContent,
  planFileChange, FileCommandSchema, assetHash, assetInfo, assetRoot, parseFolderConfig, WORKSPACE_DOCUMENTS,
  createRemoteSource, SourceError, type FileSnapshot, type FileCommand, type SourceConfig, type RemoteSource, type RemoteChange,
} from '@mygitnotes/core';
import { authToken } from './auth.js';
import { serializeWorkspaceMutation } from './workspace-mutation.js';

const auxiliary = WORKSPACE_DOCUMENTS.map(document => document.file);
function regularPath(root: string, file: string) {
  const full = resolveSafePath(root, file);
  let cursor = root;
  for (const part of file.split('/')) {
    cursor = path.join(cursor, part);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new SourceError('Symlinks are protected.', 403); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return full;
}
interface CatalogFile { size: number; stamp: string; hash?: string; mtime?: number }
interface FileCatalog { notebooks: FileSnapshot['notebooks']; directories: string[]; protectedPaths: string[]; files: Map<string, CatalogFile> }
export function localFileCatalog(root: string): FileCatalog {
  const config = loadWorkspaceConfig(root);
  if (!config) throw new SourceError('Workspace configuration is missing.', 400);
  const catalog: FileCatalog = { notebooks: config.notebooks, directories: [], protectedPaths: [], files: new Map() };
  const add = (file: string) => {
    const stat = fs.statSync(regularPath(root, file), { bigint: true });
    if (!stat.isFile()) throw new SourceError('Expected a regular file.', 400);
    catalog.files.set(file, { size: Number(stat.size), mtime: Number(stat.mtimeMs), stamp: [stat.size, stat.mtimeNs, stat.ctimeNs, stat.ino, stat.mode].join(':') });
  };
  const visit = (dir: string) => {
    if (catalog.directories.includes(dir)) return;
    catalog.directories.push(dir);
    for (const entry of fs.readdirSync(regularPath(root, dir), { withFileTypes: true })) {
      const file = dir + '/' + entry.name;
      if (!managedNotebook(file, config.notebooks) || entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) catalog.protectedPaths.push(file);
      else if (entry.isDirectory()) visit(file);
      else add(file);
    }
  };
  for (const nb of config.notebooks) {
    if (fs.existsSync(regularPath(root, nb.root))) visit(nb.root);
    if (nb.pathAliases) {
      for (const target of Object.values(nb.pathAliases)) {
        const targetDir = target.replace(/\*$/, '').replace(/\/$/, '');
        if (targetDir && fs.existsSync(regularPath(root, targetDir))) {
          visit(targetDir);
        }
      }
    }
  }
  for (const file of auxiliary) if (fs.existsSync(regularPath(root, file))) add(file);
  return catalog;
}
function localRead(root: string, file: string) {
  const full = regularPath(root, file), stat = fs.statSync(full);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new SourceError('File reads support up to 5 MiB.', 413);
  return fs.readFileSync(full);
}
async function localHash(root: string, file: string, size: number) {
  const hash = createHash('sha1').update(`blob ${size}\0`);
  for await (const chunk of fs.createReadStream(regularPath(root, file))) hash.update(chunk);
  return hash.digest('hex');
}
function needsContent(file: string, command?: FileCommand) {
  if (!command) return true;
  if (command.kind === 'move' || command.kind === 'remove-directory') return withinPath(file, command.path) || /\.(md|markdown)$/i.test(file) || auxiliary.includes(file);
  return file === command.path || command.kind === 'metadata' && file === command.path + '/_dir.yml';
}
export function localFileSnapshot(root: string, command?: FileCommand): FileSnapshot {
  const catalog = localFileCatalog(root);
  let total = 0;
  const files = new Map<string, Buffer>();
  for (const [file, entry] of catalog.files) {
    // Untouched entries retain their paths for collision checks. Only affected
    // files and reference-bearing documents need content for the planner.
    if (!needsContent(file, command)) { files.set(file, Buffer.alloc(0)); continue; }
    total += entry.size;
    if (total > 32 * 1024 * 1024) throw new SourceError('File operations support 32 MiB per workspace snapshot.', 413);
    files.set(file, localRead(root, file));
  }
  return { ...catalog, files };
}
function catalogRevision(catalog: FileCatalog) {
  return createHash('sha256').update(JSON.stringify([catalog.notebooks, [...catalog.directories].sort(), [...catalog.protectedPaths].sort(),
    [...catalog.files].sort(([a], [b]) => a.localeCompare(b)).map(([file, entry]) => [file, entry.stamp])])).digest('hex');
}
async function remoteFiles(reader: RemoteSource, command: FileCommand): Promise<FileSnapshot> {
  const state = await reader.getSnapshot(true), config = await reader.config();
  const snapshot: FileSnapshot = { notebooks: config.notebooks, files: new Map(), directories: [], protectedPaths: [] };
  const readable: string[] = [];
  for (const entry of state.entries) {
    if (!config.notebooks.some(nb => withinPath(entry.path, nb.root)) && !auxiliary.includes(entry.path)) continue;
    if (entry.mode === '120000' || !['blob', 'tree'].includes(entry.type) || !auxiliary.includes(entry.path) && !managedNotebook(entry.path, config.notebooks)) snapshot.protectedPaths.push(entry.path);
    else if (entry.type === 'tree') snapshot.directories.push(entry.path);
    else readable.push(entry.path);
  }
  let total = 0;
  for (const file of readable) {
    if (!needsContent(file, command)) { snapshot.files.set(file, Buffer.alloc(0)); continue; }
    const bytes = await reader.readFile(file); total += bytes.length;
    if (total > 32 * 1024 * 1024) throw new SourceError('File operations support 32 MiB per workspace snapshot.', 413);
    snapshot.files.set(file, bytes);
  }
  return snapshot;
}
export function changedFiles(before: FileSnapshot, after: FileSnapshot) {
  const files = [...new Set([...before.files.keys(), ...after.files.keys()])].filter(file => !before.files.get(file)?.equals(after.files.get(file) ?? Buffer.alloc(0)) || !after.files.has(file));
  // A new empty file is a change even though it contains zero bytes.
  if (files.length > 200 || files.reduce((sum, file) => sum + (after.files.get(file)?.length || 0), 0) > 5 * 1024 * 1024) throw new SourceError('Operation exceeds 200 changed files or 5 MiB.', 413);
  return files;
}
export function applyLocalFilePlan(root: string, before: FileSnapshot, after: ReturnType<typeof planFileChange>) {
  const changes = changedFiles(before, after);
  const addedDirs = after.directories.filter(dir => !before.directories.includes(dir)).sort((a, b) => a.length - b.length);
  const removedDirs = before.directories.filter(dir => !after.directories.includes(dir)).sort((a, b) => b.length - a.length);
  const modes = new Map([...before.files.keys()].map(file => [file, fs.statSync(regularPath(root, file)).mode]));
  for (const file of [...changes, ...addedDirs, ...removedDirs]) regularPath(root, file);
  const write = (file: string, bytes: Buffer, mode?: number) => {
    const target = regularPath(root, file), temp = target + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temp, bytes, { flag: 'wx', mode: mode ?? 0o600 }); fs.renameSync(temp, target); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  };
  try {
    for (const dir of addedDirs) fs.mkdirSync(regularPath(root, dir), { recursive: true });
    for (const file of changes) if (after.files.has(file)) {
      const source = Object.keys(after.pathMap).find(key => after.pathMap[key] === file);
      write(file, after.files.get(file)!, modes.get(source || file));
    }
    for (const file of changes) if (!after.files.has(file)) fs.unlinkSync(regularPath(root, file));
    for (const dir of removedDirs) fs.rmdirSync(regularPath(root, dir));
  } catch (error) {
    for (const dir of before.directories) fs.mkdirSync(regularPath(root, dir), { recursive: true });
    for (const file of changes) {
      if (before.files.has(file)) write(file, before.files.get(file)!, modes.get(file));
      else if (fs.existsSync(regularPath(root, file))) fs.unlinkSync(regularPath(root, file));
    }
    for (const dir of [...addedDirs].reverse()) if (fs.existsSync(regularPath(root, dir))) fs.rmdirSync(regularPath(root, dir));
    throw error;
  }
}

export function createFileManagerRouter(base: string, source: SourceConfig): Router {
  const router = Router();
  const load = async (req: import('express').Request, command: FileCommand) => {
    if (source.type === 'local') {
      const snapshot = localFileSnapshot(source.path, command);
      return { snapshot, revision: catalogRevision(localFileCatalog(source.path)), writable: await getCurrentBranch(source.path) === 'main', reader: undefined };
    }
    const token = await authToken(req, base), reader = createRemoteSource(source, token);
    const snapshot = await remoteFiles(reader, command), state = await reader.getSnapshot();
    return { snapshot, revision: state.sha, writable: Boolean(token && state.info.permissions?.push && source.branch === 'main'), reader };
  };
  const catalog = async (req: import('express').Request) => {
    if (source.type === 'local') {
      const index = localFileCatalog(source.path);
      return { index, revision: catalogRevision(index), writable: await getCurrentBranch(source.path) === 'main', read: async (file: string) => localRead(source.path, file) };
    }
    const token = await authToken(req, base), reader = createRemoteSource(source, token);
    const state = await reader.getSnapshot(true), config = await reader.config();
    const index: FileCatalog = { notebooks: config.notebooks, directories: [], protectedPaths: [], files: new Map() };
    for (const entry of state.entries) {
      if (entry.mode === '120000' || !managedNotebook(entry.path, config.notebooks)) continue;
      if (entry.type === 'tree') index.directories.push(entry.path);
      else if (entry.type === 'blob') index.files.set(entry.path, { size: entry.size || 0, stamp: entry.sha, hash: entry.sha });
    }
    return { index, revision: state.sha, writable: Boolean(token && state.info.permissions?.push && source.branch === 'main'), read: (file: string) => reader.readFile(file) };
  };
  const notebook = (snapshot: Pick<FileSnapshot, 'notebooks'>, id: unknown) => {
    const nb = snapshot.notebooks.find(nb => nb.id === id);
    if (!nb) throw new SourceError('Choose a notebook.', 400);
    return nb;
  };
  router.get('/api/files', async (req, res) => {
    try {
      const state = await catalog(req), nb = notebook(state.index, req.query.notebookId);
      const entries = [...state.index.directories.map(file => ({ path: file, directory: true, size: 0 })), ...[...state.index.files].map(([file, info]) => ({ path: file, directory: false, size: info.size }))]
        .filter(entry => managedNotebook(entry.path, state.index.notebooks)?.id === nb.id && entry.path !== nb.root)
        .map(entry => ({ ...entry, noteDirectory: entry.directory && isNotebookContent(entry.path.slice(nb.root.length + 1), nb), name: path.posix.basename(entry.path), hidden: entry.path.slice(nb.root.length + 1).split('/').some(p => p.startsWith('.')), presentation: filePresentation(entry.path) }));
      res.json({ root: nb.root, entries, revision: state.revision, writable: state.writable, remote: source.type !== 'local' });
    } catch (error) { fail(res, error); }
  });
  router.get('/api/files/read', async (req, res) => {
    try {
      const state = await catalog(req), nb = notebook(state.index, req.query.notebookId), file = String(req.query.path || '');
      if (managedNotebook(file, state.index.notebooks)?.id !== nb.id) throw new SourceError('Path is outside this notebook.', 403);
      if (state.index.directories.includes(file)) {
        const raw = state.index.files.has(file + '/_dir.yml') ? (await state.read(file + '/_dir.yml')).toString('utf8') : '';
        return res.json({ path: file, metadata: parseFolderConfig(raw, path.posix.basename(file), file), revision: state.revision });
      }
      if (!state.index.files.has(file)) throw new SourceError('File unavailable.', 404);
      const bytes = await state.read(file);
      res.json({ path: file, hash: assetHash(bytes), content: editableFile(file, bytes) ?? null, revision: state.revision, size: bytes.length });
    } catch (error) { fail(res, error); }
  });
  router.get('/api/assets', async (req, res) => {
    try {
      const state = await catalog(req), nb = notebook(state.index, req.query.notebookId || state.index.notebooks[0]?.id);
      const root = assetRoot(nb), assets = [];
      for (const [file, info] of state.index.files) {
        if (managedNotebook(file, state.index.notebooks)?.id !== nb.id || file.slice(nb.root.length + 1).split('/').some(part => part.startsWith('.'))) continue;
        if (!withinPath(file, root) && filePresentation(file) === 'file' && !/\.(bin|zip|gz|7z|rar|woff2?|ttf|otf)$/i.test(file)) continue;
        const hash = info.hash || (source.type === 'local' ? await localHash(source.path, file, info.size) : assetHash(await state.read(file)));
        assets.push({ ...assetInfo(file, withinPath(file, root) ? root : nb.root, hash, info.size, info.mtime), revision: state.revision });
      }
      res.json({ assets });
    } catch (error) { fail(res, error); }
  });
  router.get(['/api/files/raw', '/raw-assets/by-hash/:hash', '/raw-assets/*'], async (req, res) => {
    try {
      const state = await catalog(req);
      let file = String(req.query.path || '');
      let bytes: Buffer | undefined;
      if (req.params.hash) {
        if (!/^[a-f0-9]{40}$/.test(req.params.hash)) throw new SourceError('Invalid file hash.', 400);
        file = '';
        for (const [candidate, info] of state.index.files) {
          if (!managedNotebook(candidate, state.index.notebooks) || info.size > 5 * 1024 * 1024) continue;
          if (info.hash) { if (info.hash === req.params.hash) { file = candidate; break; } }
          else {
            const content = await state.read(candidate);
            if (assetHash(content) === req.params.hash) { file = candidate; bytes = content; break; }
          }
        }
      } else if (req.path.startsWith('/raw-assets/')) {
        file = (req.params as Record<string, string>)[0];
        if (!managedNotebook(file, state.index.notebooks)) throw new SourceError('Path is outside the notebooks.', 403);
      } else {
        const nb = notebook(state.index, req.query.notebookId);
        if (managedNotebook(file, state.index.notebooks)?.id !== nb.id) throw new SourceError('Path is outside this notebook.', 403);
      }
      if (!state.index.files.has(file)) throw new SourceError('File unavailable.', 404);
      bytes ??= await state.read(file);
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.removeHeader('X-Frame-Options');
      res.type(path.extname(file) || 'application/octet-stream');
      if (req.query.download === '1') res.attachment(path.posix.basename(file));
      res.send(bytes);
    } catch (error) { fail(res, error); }
  });
  router.post('/api/files', async (req, res) => {
    const execute = async () => {
      const command = FileCommandSchema.parse(req.body?.command), state = await load(req, command);
      if (!state.writable) throw new SourceError('Write access on the main workspace branch is required.', 403);
      if (!req.body.revision || req.body.revision !== state.revision) throw new SourceError('The workspace changed. Reload before saving.', 409);
      const after = planFileChange(state.snapshot, command), paths = changedFiles(state.snapshot, after);
      let nextRevision: string;
      if (source.type === 'local') { applyLocalFilePlan(source.path, state.snapshot, after); nextRevision = catalogRevision(localFileCatalog(source.path)); }
      else {
        const entries = (await state.reader!.getSnapshot()).entries;
        const changes: RemoteChange[] = paths.map(file => {
          const bytes = after.files.get(file);
          if (!bytes) return { path: file, sha: null };
          const original = [...state.snapshot.files].find(([, original]) => original === bytes);
          if (original) return { path: file, sha: entries.find(entry => entry.path === original[0])!.sha };
          const content = editableFile(file, bytes);
          return content === undefined ? { path: file, base64: bytes.toString('base64') } : { path: file, content };
        });
        nextRevision = changes.length ? (await state.reader!.commitChanges(changes, state.revision, command.kind, 'files')).revision : state.revision;
      }
      res.json({ revision: nextRevision, selectedPath: after.selectedPath, pathMap: after.pathMap, deletedPaths: paths.filter(file => !after.files.has(file)) });
    };
    try {
      if (source.type === 'local') await serializeWorkspaceMutation(source.path, execute); else await execute();
    } catch (error) { fail(res, error); }
  });
  return router;
}
function fail(res: Response, error: unknown) { res.status(error instanceof SourceError ? error.status : 400).json({ error: error instanceof Error ? error.message : 'File operation failed.' }); }
