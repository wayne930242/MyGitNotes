import { type Response, Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getCurrentBranch } from '@mygitnotes/git';
import { assetHash, assetInfo, assetRoot, editableFile, type FileCommand, FileCommandSchema, filePresentation, type FileSnapshot, isCompilationPath, isNotebookContent, managedNotebook, type NotebookConfig, parseFolderConfig, planFileChange, type RemoteChange, type RemoteSnapshot, type RemoteSource, SourceError, withinPath, WORKSPACE_DOCUMENTS, type WorkspaceConfig } from '@mygitnotes/core';
import { eachRepository, notebookRepository, noteRepository, type RepositoryHandle } from './request-workspace.js';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { regularPath, writeFileAtomicSync } from './workspace-files.js';

const auxiliary = WORKSPACE_DOCUMENTS.map(document => document.file);
interface CatalogFile {
  size: number;
  stamp: string;
  hash?: string;
  mtime?: number;
}
interface FileCatalog {
  notebooks: FileSnapshot['notebooks'];
  directories: string[];
  protectedPaths: string[];
  files: Map<string, CatalogFile>;
}
export function localFileCatalog(root: string, notebooks: NotebookConfig[]): FileCatalog {
  const catalog: FileCatalog = { notebooks, directories: [], protectedPaths: [], files: new Map() };
  const visited = new Set<string>();
  // lstat rejects a file that became a symlink after the listing.
  const add = (file: string, full: string) => {
    const stat = fs.lstatSync(full, { bigint: true });
    if (!stat.isFile()) throw new SourceError('Expected a regular file.', 400);
    catalog.files.set(file, { size: Number(stat.size), mtime: Number(stat.mtimeMs), stamp: [stat.size, stat.mtimeNs, stat.ctimeNs, stat.ino, stat.mode].join(':') });
  };
  // Only a walk's starting directory goes through `regularPath`; it descends solely into entries the listing reports as
  // real directories, so the paths below it need no per-file symlink check.
  const visit = (dir: string, full: string) => {
    if (visited.has(dir)) return;
    visited.add(dir);
    catalog.directories.push(dir);
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      const file = dir + '/' + entry.name;
      if (!managedNotebook(file, notebooks) || entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) catalog.protectedPaths.push(file);
      else if (entry.isDirectory()) visit(file, path.join(full, entry.name));
      else add(file, path.join(full, entry.name));
    }
  };
  const start = (dir: string) => {
    const full = regularPath(root, dir);
    if (fs.existsSync(full)) visit(dir, full);
  };
  for (const nb of notebooks) {
    start(nb.root);
    if (nb.pathAliases) {
      for (const target of Object.values(nb.pathAliases)) {
        const targetDir = target.replace(/\*$/, '').replace(/\/$/, '');
        if (targetDir) start(targetDir);
      }
    }
  }
  for (const file of auxiliary) {
    const full = regularPath(root, file);
    if (fs.existsSync(full)) add(file, full);
  }
  return catalog;
}
function localRead(root: string, file: string) {
  const full = regularPath(root, file), stat = fs.statSync(full);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new SourceError('File reads support up to 5 MiB.', 413);
  return fs.readFileSync(full);
}
/** Git object ids of worktree files, reused while a file's stamp is unchanged, so an asset listing hashes only edited files. */
const localHashes = new Map<string, { stamp: string; hash: string; }>();
async function localHash(root: string, file: string, size: number, stamp: string) {
  const key = `${root}\0${file}`;
  const cached = localHashes.get(key);
  if (cached?.stamp === stamp) return cached.hash;
  const hash = createHash('sha1').update(`blob ${size}\0`);
  for await (const chunk of fs.createReadStream(regularPath(root, file))) hash.update(chunk);
  const digest = hash.digest('hex');
  // A file rewritten after its stamp was taken has a new stamp next time, so this hash is never served for newer bytes.
  localHashes.set(key, { stamp, hash: digest });
  return digest;
}
function needsContent(file: string, command?: FileCommand) {
  if (!command) return true;
  // Keep original bytes for rollback if unlink/rmdir fails partway through deletion.
  if (command.kind === 'delete-directory') return withinPath(file, command.path);
  if (command.kind === 'move' || command.kind === 'remove-directory') return withinPath(file, command.path) || /\.(md|markdown)$/i.test(file) || isCompilationPath(file) || auxiliary.includes(file);
  return file === command.path || command.kind === 'metadata' && file === command.path + '/_dir.yml';
}
export function localFileSnapshot(root: string, notebooks: NotebookConfig[], command?: FileCommand): FileSnapshot {
  const catalog = localFileCatalog(root, notebooks);
  let total = 0;
  const files = new Map<string, Buffer>();
  for (const [file, entry] of catalog.files) {
    // Untouched entries retain their paths for collision checks. Only affected
    // files and reference-bearing documents need content for the planner.
    if (!needsContent(file, command)) {
      files.set(file, Buffer.alloc(0));
      continue;
    }
    total += entry.size;
    if (total > 32 * 1024 * 1024) throw new SourceError('File operations support 32 MiB per workspace snapshot.', 413);
    files.set(file, localRead(root, file));
  }
  return { ...catalog, files };
}
function catalogRevision(catalog: FileCatalog) {
  return createHash('sha256').update(JSON.stringify([catalog.notebooks, [...catalog.directories].sort(), [...catalog.protectedPaths].sort(), [...catalog.files].sort(([a], [b]) => a.localeCompare(b)).map(([file, entry]) => [file, entry.stamp])])).digest('hex');
}
async function remoteFiles(reader: RemoteSource, command: FileCommand): Promise<{ snapshot: FileSnapshot; state: RemoteSnapshot; }> {
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
    if (!needsContent(file, command)) {
      snapshot.files.set(file, Buffer.alloc(0));
      continue;
    }
    const bytes = await reader.readSnapshotFile(state, file);
    total += bytes.length;
    if (total > 32 * 1024 * 1024) throw new SourceError('File operations support 32 MiB per workspace snapshot.', 413);
    snapshot.files.set(file, bytes);
  }
  return { snapshot, state };
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
  const write = (file: string, bytes: Buffer, mode?: number) => writeFileAtomicSync(regularPath(root, file), bytes, mode);
  try {
    for (const dir of addedDirs) fs.mkdirSync(regularPath(root, dir), { recursive: true });
    for (const file of changes) {
      if (after.files.has(file)) {
        const source = Object.keys(after.pathMap).find(key => after.pathMap[key] === file);
        write(file, after.files.get(file)!, modes.get(source || file));
      }
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

export function createFileManagerRouter(): Router {
  const router = Router();
  /** The snapshot of the repository serving the command's notebook; a command never leaves its notebook. */
  const load = async (res: Response, command: FileCommand) => {
    const { handle, config } = await notebookRepository(res, command.notebookId);
    if (handle.kind === 'local') {
      const snapshot = localFileSnapshot(handle.root, config.notebooks, command);
      return { snapshot, revision: catalogRevision(localFileCatalog(handle.root, config.notebooks)), writable: await getCurrentBranch(handle.root) === 'main', reader: undefined, remoteSnapshot: undefined, local: handle.root, notebooks: config.notebooks };
    }
    const { reader } = handle;
    const { snapshot, state } = await remoteFiles(reader, command);
    return { snapshot, revision: state.sha, writable: reader.canWrite(state), reader, remoteSnapshot: state, local: undefined, notebooks: config.notebooks };
  };
  const catalogOf = async (handle: RepositoryHandle, config: WorkspaceConfig) => {
    if (handle.kind === 'local') {
      const index = localFileCatalog(handle.root, config.notebooks);
      return { index, revision: catalogRevision(index), writable: await getCurrentBranch(handle.root) === 'main', read: async (file: string) => localRead(handle.root, file), local: handle.root };
    }
    const { reader } = handle;
    const state = await reader.getSnapshot(true);
    const index: FileCatalog = { notebooks: config.notebooks, directories: [], protectedPaths: [], files: new Map() };
    for (const entry of state.entries) {
      if (entry.mode === '120000' || !managedNotebook(entry.path, config.notebooks)) continue;
      if (entry.type === 'tree') index.directories.push(entry.path);
      else if (entry.type === 'blob') index.files.set(entry.path, { size: entry.size || 0, stamp: entry.sha, hash: entry.sha });
    }
    return { index, revision: state.sha, writable: reader.canWrite(state), read: (file: string) => reader.readFile(file), local: undefined };
  };
  /** The catalog of the repository serving a notebook, which lists every notebook of that repository. */
  const catalog = async (res: Response, notebookId: unknown) => {
    const { handle, config } = await notebookRepository(res, notebookId);
    return catalogOf(handle, config);
  };
  const notebook = (snapshot: Pick<FileSnapshot, 'notebooks'>, id: unknown) => {
    const nb = snapshot.notebooks.find(nb => nb.id === id);
    if (!nb) throw new SourceError('Choose a notebook.', 400);
    return nb;
  };
  router.get('/api/files', async (req, res) => {
    try {
      const state = await catalog(res, req.query.notebookId), nb = notebook(state.index, req.query.notebookId);
      const entries = [...state.index.directories.map(file => ({ path: file, directory: true, size: 0 })), ...[...state.index.files].map(([file, info]) => ({ path: file, directory: false, size: info.size }))].filter(entry => managedNotebook(entry.path, state.index.notebooks)?.id === nb.id && entry.path !== nb.root).map(entry => ({ ...entry, noteDirectory: entry.directory && isNotebookContent(entry.path.slice(nb.root.length + 1), nb), name: path.posix.basename(entry.path), hidden: entry.path.slice(nb.root.length + 1).split('/').some(p => p.startsWith('.')), presentation: filePresentation(entry.path) }));
      res.json({ root: nb.root, entries, revision: state.revision, writable: state.writable, remote: state.local === undefined });
    } catch (error) {
      fail(res, error);
    }
  });
  router.get('/api/files/read', async (req, res) => {
    try {
      const state = await catalog(res, req.query.notebookId), nb = notebook(state.index, req.query.notebookId), file = String(req.query.path || '');
      if (managedNotebook(file, state.index.notebooks)?.id !== nb.id) throw new SourceError('Path is outside this notebook.', 403);
      if (state.index.directories.includes(file)) {
        const raw = state.index.files.has(file + '/_dir.yml') ? (await state.read(file + '/_dir.yml')).toString('utf8') : '';
        return res.json({ path: file, metadata: parseFolderConfig(raw, path.posix.basename(file), file), revision: state.revision });
      }
      if (!state.index.files.has(file)) throw new SourceError('File unavailable.', 404);
      const bytes = await state.read(file);
      res.json({ path: file, hash: assetHash(bytes), content: editableFile(file, bytes) ?? null, revision: state.revision, size: bytes.length });
    } catch (error) {
      fail(res, error);
    }
  });
  router.get('/api/assets', async (req, res) => {
    try {
      // Without a notebook the listing covers the manifest's first notebook.
      const notebookId = req.query.notebookId || (await eachRepository(res))[0]?.config.notebooks[0]?.id;
      const state = await catalog(res, notebookId), nb = notebook(state.index, notebookId);
      const root = assetRoot(nb), assets = [];
      for (const [file, info] of state.index.files) {
        if (managedNotebook(file, state.index.notebooks)?.id !== nb.id || file.slice(nb.root.length + 1).split('/').some(part => part.startsWith('.'))) continue;
        if (!withinPath(file, root) && filePresentation(file) === 'file' && !/\.(bin|zip|gz|7z|rar|woff2?|ttf|otf)$/i.test(file)) continue;
        const hash = info.hash || (state.local !== undefined ? await localHash(state.local, file, info.size, info.stamp) : assetHash(await state.read(file)));
        assets.push({ ...assetInfo(file, withinPath(file, root) ? root : nb.root, hash, info.size, info.mtime), revision: state.revision });
      }
      res.json({ assets });
    } catch (error) {
      fail(res, error);
    }
  });
  router.get(['/api/files/raw', '/raw-assets/by-hash/:hash', '/raw-assets/*'], async (req, res) => {
    try {
      let state: Awaited<ReturnType<typeof catalogOf>> | undefined;
      let file = String(req.query.path || '');
      let bytes: Buffer | undefined;
      if (req.params.hash) {
        if (!/^[a-f0-9]{40}$/.test(req.params.hash)) throw new SourceError('Invalid file hash.', 400);
        file = '';
        search: for (const { handle, config } of await eachRepository(res)) {
          state = await catalogOf(handle, config);
          for (const [candidate, info] of state.index.files) {
            if (!managedNotebook(candidate, state.index.notebooks) || info.size > 5 * 1024 * 1024) continue;
            if (info.hash) {
              if (info.hash === req.params.hash) {
                file = candidate;
                break search;
              }
            } else {
              const content = await state.read(candidate);
              if (assetHash(content) === req.params.hash) {
                file = candidate;
                bytes = content;
                break search;
              }
            }
          }
        }
      } else if (req.path.startsWith('/raw-assets/')) {
        file = (req.params as Record<string, string>)[0];
        // `notebook` names the asset's notebook, since notebook roots may repeat across repositories.
        const resolved = await noteRepository(res, file, req.query.notebook).catch((error: unknown) => {
          if (error instanceof SourceError && error.status === 403) throw new SourceError('Path is outside the notebooks.', 403);
          throw error;
        });
        state = await catalogOf(resolved.handle, resolved.config);
      } else {
        state = await catalog(res, req.query.notebookId);
        const nb = notebook(state.index, req.query.notebookId);
        if (managedNotebook(file, state.index.notebooks)?.id !== nb.id) throw new SourceError('Path is outside this notebook.', 403);
      }
      if (!state) throw new SourceError('File unavailable.', 404);
      if (!state.index.files.has(file)) throw new SourceError('File unavailable.', 404);
      bytes ??= await state.read(file);
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.removeHeader('X-Frame-Options');
      res.type(path.extname(file) || 'application/octet-stream');
      if (req.query.download === '1') res.attachment(path.posix.basename(file));
      res.send(bytes);
    } catch (error) {
      fail(res, error);
    }
  });
  router.post('/api/files', async (req, res) => {
    const execute = async () => {
      const command = FileCommandSchema.parse(req.body?.command), state = await load(res, command);
      if (!state.writable) throw new SourceError('Write access on the main workspace branch is required.', 403);
      if (!req.body.revision || req.body.revision !== state.revision) throw new SourceError('The workspace changed. Reload before saving.', 409);
      const after = planFileChange(state.snapshot, command), paths = changedFiles(state.snapshot, after);
      let nextRevision: string;
      if (state.local !== undefined) {
        applyLocalFilePlan(state.local, state.snapshot, after);
        nextRevision = catalogRevision(localFileCatalog(state.local, state.notebooks));
      } else {
        const entries = state.remoteSnapshot!.entries;
        const changes: RemoteChange[] = paths.map(file => {
          const bytes = after.files.get(file);
          if (!bytes) return { path: file, sha: null };
          const original = [...state.snapshot.files].find(([, original]) => original === bytes);
          if (original) return { path: file, sha: entries.find(entry => entry.path === original[0])!.sha };
          const content = editableFile(file, bytes);
          return content === undefined ? { path: file, base64: bytes.toString('base64') } : { path: file, content };
        });
        nextRevision = changes.length ? (await state.reader!.commitChanges(changes, state.revision, command.kind, 'files', undefined, state.remoteSnapshot)).revision : state.revision;
      }
      res.json({ revision: nextRevision, selectedPath: after.selectedPath, pathMap: after.pathMap, deletedPaths: [...paths.filter(file => !after.files.has(file)), ...state.snapshot.directories.filter(dir => !after.directories.includes(dir))] });
    };
    try {
      // A local mutation is serialized on the worktree it changes.
      const command = FileCommandSchema.safeParse(req.body?.command);
      const { handle } = command.success ? await notebookRepository(res, command.data.notebookId) : { handle: undefined };
      if (handle?.kind === 'local') await serializeWorkspaceMutation(handle.root, execute);
      else await execute();
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}
function fail(res: Response, error: unknown) {
  res.status(error instanceof SourceError ? error.status : 400).json({ error: error instanceof Error ? error.message : 'File operation failed.' });
}
