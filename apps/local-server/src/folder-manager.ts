import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { loadWorkspaceConfig, resolveSafePath, isNotebookContent, planFolderChange, FolderCommandSchema, GitHubSource, SourceError, SCREEN_PAGE_FILE, type FolderSnapshot, type SourceConfig } from '@github-notes/core';
import { getCurrentBranch } from '@github-notes/git';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { authToken } from './auth.js';

const isText = (file: string) => /\.(md|markdown|txt)$/i.test(file) || path.posix.basename(file) === '_dir.yml';
function regularPath(root: string, relative: string) {
  const full = resolveSafePath(root, relative);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new SourceError('Symlinks are protected.', 403); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return full;
}
export function localFolderSnapshot(root: string): FolderSnapshot {
  const config = loadWorkspaceConfig(root);
  if (!config) throw new SourceError('Workspace configuration is missing.', 400);
  const snapshot: FolderSnapshot = { notebooks: config.notebooks, directories: [], protectedPaths: [], files: new Map() };
  let bytes = 0;
  const read = (file: string) => {
    const full = regularPath(root, file);
    const stat = fs.lstatSync(full);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new SourceError('Unsupported or oversized notebook file.', 413);
    bytes += stat.size;
    if (bytes > 32 * 1024 * 1024) throw new SourceError('Folder operations currently support up to 32 MiB of notebook text.', 413);
    snapshot.files.set(file, fs.readFileSync(full, 'utf8'));
  };
  for (const nb of config.notebooks) {
    const rootPath = regularPath(root, nb.root);
    if (!fs.existsSync(rootPath)) continue;
    const visit = (directory: string) => {
      snapshot.directories.push(directory);
      for (const entry of fs.readdirSync(regularPath(root, directory), { withFileTypes: true })) {
        const file = `${directory}/${entry.name}`;
        const relative = file.slice(nb.root.length + 1);
        if (entry.isSymbolicLink() || !isNotebookContent(relative, nb) || !entry.isDirectory() && (!entry.isFile() || !isText(file))) { snapshot.protectedPaths.push(file); continue; }
        if (entry.isDirectory()) visit(file); else read(file);
      }
    };
    visit(nb.root);
  }
  if (fs.existsSync(path.join(root, SCREEN_PAGE_FILE))) read(SCREEN_PAGE_FILE);
  return snapshot;
}
function revision(snapshot: FolderSnapshot) {
  return createHash('sha256').update(JSON.stringify([snapshot.notebooks, [...snapshot.directories].sort(), [...snapshot.protectedPaths].sort(), [...snapshot.files].sort(([a], [b]) => a.localeCompare(b))])).digest('hex');
}
function changesFor(before: FolderSnapshot, after: ReturnType<typeof planFolderChange>) {
  const changes = [...new Set([...before.files.keys(), ...after.files.keys()])].filter(file => before.files.get(file) !== after.files.get(file)).map(file => after.files.has(file) ? { path: file, content: after.files.get(file)! } : { path: file, sha: null });
  if (changes.length > 200 || changes.reduce((sum, change) => sum + Buffer.byteLength(change.content || ''), 0) > 5 * 1024 * 1024) throw new SourceError('Folder operation exceeds 200 changed files or 5 MiB. Move a smaller folder.', 413);
  return changes;
}

/** Synchronous preflight and apply keep other requests out of the local transaction. */
export function applyLocalFolderPlan(root: string, before: FolderSnapshot, after: ReturnType<typeof planFolderChange>) {
  const changes = changesFor(before, after);
  const modes = new Map(changes.filter(c => before.files.has(c.path)).map(c => [c.path, fs.statSync(regularPath(root, c.path)).mode]));
  for (const file of [...changes.map(c => c.path), ...after.directories]) regularPath(root, file);
  const newDirs = after.directories.filter(dir => !before.directories.includes(dir)).sort((a, b) => a.length - b.length);
  const removedDirs = before.directories.filter(dir => !after.directories.includes(dir)).sort((a, b) => b.length - a.length);
  const applied: string[] = [];
  const write = (file: string, content: string) => {
    const target = regularPath(root, file);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, content, { flag: 'wx', mode: modes.get(file) || 0o600 }); fs.renameSync(temporary, target); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  };
  try {
    for (const dir of newDirs) fs.mkdirSync(regularPath(root, dir), { recursive: true });
    for (const change of changes.filter(c => c.content !== undefined)) { write(change.path, change.content!); applied.push(change.path); }
    for (const change of changes.filter(c => c.sha === null)) { fs.unlinkSync(regularPath(root, change.path)); applied.push(change.path); }
    for (const dir of removedDirs) fs.rmdirSync(regularPath(root, dir));
  } catch (error) {
    for (const dir of [...removedDirs].reverse()) fs.mkdirSync(regularPath(root, dir), { recursive: true });
    for (const file of applied.reverse()) {
      if (before.files.has(file)) write(file, before.files.get(file)!);
      else fs.unlinkSync(regularPath(root, file));
    }
    for (const dir of [...newDirs].reverse()) if (fs.existsSync(regularPath(root, dir))) fs.rmdirSync(regularPath(root, dir));
    throw error;
  }
}

async function remoteSnapshot(reader: GitHubSource): Promise<FolderSnapshot> {
  const { entries } = await reader.getSnapshot(true);
  const config = await reader.config();
  const snapshot: FolderSnapshot = { notebooks: config.notebooks, directories: [], protectedPaths: [], files: new Map() };
  const readable: string[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const nb = config.notebooks.find(nb => entry.path === nb.root || entry.path.startsWith(nb.root + '/'));
    if (!nb && entry.path !== SCREEN_PAGE_FILE) continue;
    const allowed = entry.path === SCREEN_PAGE_FILE || nb && (entry.path === nb.root || isNotebookContent(entry.path.slice(nb.root.length + 1), nb));
    if (!allowed || entry.mode === '120000' || !['blob', 'tree'].includes(entry.type) || entry.type === 'blob' && entry.path !== SCREEN_PAGE_FILE && !isText(entry.path)) snapshot.protectedPaths.push(entry.path);
    else if (entry.type === 'tree') snapshot.directories.push(entry.path);
    else { readable.push(entry.path); bytes += entry.size || 0; }
  }
  if (bytes > 32 * 1024 * 1024) throw new SourceError('Folder operations currently support up to 32 MiB of notebook text.', 413);
  await reader.prefetchFiles(readable);
  for (const file of readable) snapshot.files.set(file, (await reader.readFile(file)).toString('utf8'));
  return snapshot;
}

export function createFolderManagerRouter(base: string, source: SourceConfig): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    try {
      if (source.type === 'local') return res.json({ revision: revision(localFolderSnapshot(source.path)), writable: await getCurrentBranch(source.path) === 'main' });
      const token = await authToken(req, base);
      const snapshot = await new GitHubSource(source.repository, source.branch, token).getSnapshot(true);
      res.json({ revision: snapshot.sha, writable: Boolean(token && snapshot.info.permissions?.push && source.branch === 'main') });
    } catch (error) { fail(res, error); }
  });
  router.post('/', async (req, res) => {
    try {
      const command = FolderCommandSchema.safeParse(req.body?.command);
      if (!command.success || typeof req.body?.revision !== 'string') throw new SourceError('Invalid folder request.', 400);
      if (source.type === 'local') {
        return await serializeWorkspaceMutation(source.path, async () => {
        if (await getCurrentBranch(source.path) !== 'main') throw new SourceError('Folder changes require the main workspace branch.', 403);
        const before = localFolderSnapshot(source.path);
        if (revision(before) !== req.body.revision) throw new SourceError('The workspace changed. Reload the folders and try again.', 409);
        const after = planFolderChange(before, command.data);
        applyLocalFolderPlan(source.path, before, after);
        return res.json({ selectedPath: after.selectedPath, revision: revision(localFolderSnapshot(source.path)) });
        });
      }
      const token = await authToken(req, base);
      if (!token) throw new SourceError('Sign in with write access to manage folders.', 403);
      const reader = new GitHubSource(source.repository, source.branch, token);
      const before = await remoteSnapshot(reader);
      const current = await reader.getSnapshot();
      if (current.sha !== req.body.revision) throw new SourceError('The workspace changed. Reload the folders and try again.', 409);
      const after = planFolderChange(before, command.data);
      const changes = changesFor(before, after);
      const receipt = changes.length ? await reader.commitChanges(changes, req.body.revision, command.data.kind, 'folders') : { revision: current.sha };
      res.json({ selectedPath: after.selectedPath, revision: receipt.revision });
    } catch (error) { fail(res, error); }
  });
  return router;
}
function fail(res: import('express').Response, error: unknown) {
  res.status(error instanceof SourceError ? error.status : 400).json({ error: error instanceof Error ? error.message : 'Folder operation failed.' });
}
