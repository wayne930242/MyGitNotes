import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { FolderCommandSchema, type FolderSnapshot, isCompilationPath, isNotebookContent, type NotebookConfig, planFolderChange, type RemoteChange, type RemoteSnapshot, RemoteSource, SourceError, stampIsRacy, versionFileChanges, WORKSPACE_DOCUMENTS } from '@mygitnotes/core';
import { getCurrentBranch } from '@mygitnotes/git';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { notebookRepository } from './request-workspace.js';
import { regularPath, writeFileAtomicSync } from './workspace-files.js';
import { moveLocalVersionFiles } from './version-files.js';

const documents = WORKSPACE_DOCUMENTS.map(document => document.file);

const isText = (file: string) => /\.(md|markdown|txt)$/i.test(file) || isCompilationPath(file) || path.posix.basename(file) === '_dir.yml';
/**
 * Visits what a folder change may touch: each notebook's directories, the paths it must leave alone, and the text
 * files and workspace documents it may rewrite. Each file comes with its absolute path: only the notebook root is
 * resolved through `regularPath`, and the walk descends solely into entries the directory listing reports as real
 * directories, so no path below it crosses a symlink without re-checking every segment per file.
 */
function walkFolders(root: string, notebooks: NotebookConfig[], visitor: { directory: (path: string) => void; protectedPath: (path: string) => void; file: (path: string, full: string) => void; }) {
  for (const nb of notebooks) {
    const rootPath = regularPath(root, nb.root);
    if (!fs.existsSync(rootPath)) continue;
    const visit = (directory: string, full: string) => {
      visitor.directory(directory);
      for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
        const file = `${directory}/${entry.name}`;
        const relative = file.slice(nb.root.length + 1);
        if (entry.isSymbolicLink() || !isNotebookContent(relative, nb) || !entry.isDirectory() && (!entry.isFile() || !isText(file))) {
          visitor.protectedPath(file);
          continue;
        }
        if (entry.isDirectory()) visit(file, path.join(full, entry.name));
        else visitor.file(file, path.join(full, entry.name));
      }
    };
    visit(nb.root, rootPath);
  }
  for (const file of documents) if (fs.existsSync(path.join(root, file))) visitor.file(file, regularPath(root, file));
}
export function localFolderSnapshot(root: string, notebooks: NotebookConfig[]): FolderSnapshot {
  const snapshot: FolderSnapshot = { notebooks, directories: [], protectedPaths: [], files: new Map() };
  let bytes = 0;
  walkFolders(root, notebooks, {
    directory: directory => snapshot.directories.push(directory),
    protectedPath: file => snapshot.protectedPaths.push(file),
    file: (file, full) => {
      // lstat rejects a file that became a symlink after the listing.
      const stat = fs.lstatSync(full);
      if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new SourceError('Unsupported or oversized notebook file.', 413);
      bytes += stat.size;
      if (bytes > 32 * 1024 * 1024) throw new SourceError('Folder operations currently support up to 32 MiB of notebook text.', 413);
      snapshot.files.set(file, fs.readFileSync(full, 'utf8'));
    },
  });
  return snapshot;
}
/**
 * The state a folder change is checked against, from file stamps rather than file contents, like the file
 * manager's revision: any write changes a file's change time, so an edit made since it was read still conflicts.
 * A file changed within its timestamp tick of `at` could change again without a new stamp, so its content counts
 * too. The revision carries `at`, and a later check judges the same files racy against that same moment, as git does
 * with its index time, so a revision stays valid once the tick has passed.
 */
function localFolderRevision(root: string, notebooks: NotebookConfig[], at = Date.now()): string {
  const directories: string[] = [], protectedPaths: string[] = [], files: [string, string][] = [];
  walkFolders(root, notebooks, {
    directory: directory => directories.push(directory),
    protectedPath: file => protectedPaths.push(file),
    file: (file, full) => {
      const stat = fs.lstatSync(full, { bigint: true });
      const stamp = [stat.size, stat.mtimeNs, stat.ctimeNs, stat.ino, stat.mode].join(':');
      files.push([file, stampIsRacy(stat, at) ? `${stamp}:${createHash('sha256').update(fs.readFileSync(full)).digest('hex')}` : stamp]);
    },
  });
  return `${at}.${createHash('sha256').update(JSON.stringify([notebooks, directories.sort(), protectedPaths.sort(), files.sort(([a], [b]) => a.localeCompare(b))])).digest('hex')}`;
}
/** Whether `revision` from `localFolderRevision` still describes the workspace. */
function localFolderRevisionHolds(root: string, notebooks: NotebookConfig[], revision: string) {
  const at = Number(revision.slice(0, revision.indexOf('.')));
  return Number.isSafeInteger(at) && localFolderRevision(root, notebooks, at) === revision;
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
  const write = (file: string, content: string) => writeFileAtomicSync(regularPath(root, file), content, modes.get(file) || 0o600);
  try {
    for (const dir of newDirs) fs.mkdirSync(regularPath(root, dir), { recursive: true });
    for (const change of changes.filter(c => c.content !== undefined)) {
      write(change.path, change.content!);
      applied.push(change.path);
    }
    for (const change of changes.filter(c => c.sha === null)) {
      fs.unlinkSync(regularPath(root, change.path));
      applied.push(change.path);
    }
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

async function remoteSnapshot(reader: RemoteSource): Promise<{ snapshot: FolderSnapshot; state: RemoteSnapshot; }> {
  const state = await reader.getSnapshot(true);
  const { entries } = state;
  const config = await reader.config();
  const snapshot: FolderSnapshot = { notebooks: config.notebooks, directories: [], protectedPaths: [], files: new Map() };
  const readable: string[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const nb = config.notebooks.find(nb => entry.path === nb.root || entry.path.startsWith(nb.root + '/'));
    const isDocument = documents.includes(entry.path);
    if (!nb && !isDocument) continue;
    const allowed = isDocument || nb && (entry.path === nb.root || isNotebookContent(entry.path.slice(nb.root.length + 1), nb));
    if (!allowed || entry.mode === '120000' || !['blob', 'tree'].includes(entry.type) || entry.type === 'blob' && !isDocument && !isText(entry.path)) snapshot.protectedPaths.push(entry.path);
    else if (entry.type === 'tree') snapshot.directories.push(entry.path);
    else {
      readable.push(entry.path);
      bytes += entry.size || 0;
    }
  }
  if (bytes > 32 * 1024 * 1024) throw new SourceError('Folder operations currently support up to 32 MiB of notebook text.', 413);
  await reader.prefetchFiles(readable);
  for (const file of readable) snapshot.files.set(file, (await reader.readSnapshotFile(state, file)).toString('utf8'));
  return { snapshot, state };
}

export function createFolderManagerRouter(): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    try {
      // Folder changes stay inside one notebook, so the revision is its repository's.
      const { handle, config } = await notebookRepository(res, req.query.notebookId);
      if (handle.kind === 'local') return res.json({ revision: localFolderRevision(handle.root, config.notebooks), writable: await getCurrentBranch(handle.root) === 'main' });
      const { reader } = handle;
      const snapshot = await reader.getSnapshot(true);
      res.json({ revision: snapshot.sha, writable: reader.canWrite(snapshot) });
    } catch (error) {
      fail(res, error);
    }
  });
  router.post('/', async (req, res) => {
    try {
      const parsed = FolderCommandSchema.safeParse(req.body?.command);
      if (!parsed.success || typeof req.body?.revision !== 'string') throw new SourceError('Invalid folder request.', 400);
      const { handle, config, notebook } = await notebookRepository(res, parsed.data.notebookId);
      // The plan finds the notebook among its repository's notebooks, which carry local ids.
      const command = { data: { ...parsed.data, notebookId: notebook.id } };
      if (handle.kind === 'local') {
        const { root } = handle;
        return await serializeWorkspaceMutation(root, async () => {
          if (await getCurrentBranch(root) !== 'main') throw new SourceError('Folder changes require the main workspace branch.', 403);
          if (!localFolderRevisionHolds(root, config.notebooks, req.body.revision)) throw new SourceError('The workspace changed. Reload the folders and try again.', 409);
          const before = localFolderSnapshot(root, config.notebooks);
          const after = planFolderChange(before, command.data);
          applyLocalFolderPlan(root, before, after);
          moveLocalVersionFiles(root, Object.keys(after.pathMap), file => after.pathMap[file] ?? file, () => false);
          return res.json({ selectedPath: after.selectedPath, revision: localFolderRevision(root, config.notebooks) });
        });
      }
      if (!handle.authenticated) throw new SourceError('Sign in with write access to manage folders.', 403);
      const { reader } = handle;
      const { snapshot: before, state: current } = await remoteSnapshot(reader);
      if (current.sha !== req.body.revision) throw new SourceError('The workspace changed. Reload the folders and try again.', 409);
      const after = planFolderChange(before, command.data);
      const changes: RemoteChange[] = [...changesFor(before, after), ...versionFileChanges(current.entries, Object.keys(after.pathMap), file => after.pathMap[file] ?? file, () => false)];
      const receipt = changes.length ? await reader.commitChanges(changes, req.body.revision, command.data.kind, 'folders', undefined, current) : { revision: current.sha };
      res.json({ selectedPath: after.selectedPath, revision: receipt.revision });
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}
function fail(res: import('express').Response, error: unknown) {
  res.status(error instanceof SourceError ? error.status : 400).json({ error: error instanceof Error ? error.message : 'Folder operation failed.' });
}
