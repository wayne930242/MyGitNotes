import { type Response, Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'yaml';
import { ApplyLegacyOutlineImportSchema, BOOKMARKS_DOCUMENT, BOOKMARKS_FILE, BOOKMARKS_MAX_BYTES, type BookmarksPage, BookmarksPageSchema, keyedItem, type LegacyOutlineImportRequest, LegacyOutlineImportSchema, PathTraversalError, planLegacyOutlineImport, SourceError, SymlinkEscapeError } from '@mygitnotes/core';
import { getCurrentBranch } from '@mygitnotes/git';
import { keyedDocument, namedRepository, notebookRepository } from './request-workspace.js';
import { regularPath, revisionOf } from './workspace-files.js';
import { serializeWorkspaceMutation } from './workspace-mutation.js';

/** The repository a request names, at its current branch head. */
async function repository(res: Response, id: unknown) {
  const found = await namedRepository(res, id);
  if (found.handle.kind === 'remote') await found.handle.reader.getSnapshot(true);
  return found;
}

function readLocalSource(root: string): Buffer | null {
  const file = regularPath(root, BOOKMARKS_FILE);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new SourceError('Legacy source must be a regular file.', 403);
    if (stat.size > BOOKMARKS_MAX_BYTES) throw new SourceError('Legacy source exceeds 1 MiB.', 413);
    const bytes = fs.readFileSync(file);
    if (bytes.length > BOOKMARKS_MAX_BYTES) throw new SourceError('Legacy source exceeds 1 MiB.', 413);
    return bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Saved source is exportable within the legacy byte bound, even when its YAML/version cannot be imported. */
async function source(res: Response, id: unknown) {
  const entry = await repository(res, id);
  const { handle } = entry;
  if (handle.kind === 'local') {
    const bytes = readLocalSource(handle.root);
    const stat = fs.statSync(handle.root);
    return { entry, bytes, snapshot: undefined, identity: [fs.realpathSync(handle.root), stat.dev, stat.ino], revision: bytes === null ? 'missing' : createHash('sha256').update(bytes).digest('hex'), writable: await getCurrentBranch(handle.root) === 'main' };
  }
  const snapshot = await handle.reader.getSnapshot(true);
  const file = snapshot.entries.find(item => item.path === BOOKMARKS_FILE);
  if (file && (file.type !== 'blob' || file.mode === '120000')) throw new SourceError('Legacy source must be a regular file.', 403);
  if ((file?.size ?? 0) > BOOKMARKS_MAX_BYTES) throw new SourceError('Legacy source exceeds 1 MiB.', 413);
  const bytes = file ? await handle.reader.readSnapshotFile(snapshot, BOOKMARKS_FILE) : null;
  if (bytes && bytes.length > BOOKMARKS_MAX_BYTES) throw new SourceError('Legacy source exceeds 1 MiB.', 413);
  return { entry, bytes, snapshot, identity: entry.ref, revision: snapshot.sha, writable: handle.authenticated && handle.reader.canWrite(snapshot) };
}

function decode(bytes: Buffer | null) {
  if (!bytes) throw new SourceError('No saved legacy collection exists in this repository.', 404);
  const raw = bytes.toString('utf8');
  if (!Buffer.from(raw).equals(bytes)) throw new SourceError('Legacy source is not valid UTF-8. Export its original bytes.', 422);
  try {
    const page: unknown = parse(raw);
    BookmarksPageSchema.parse(page);
    // Validate without substituting schema transforms in the exact retained report.
    return page as BookmarksPage;
  } catch {
    throw new SourceError('Legacy source is malformed or has an unsupported version. Export it unchanged.', 422);
  }
}

async function preview(res: Response, request: LegacyOutlineImportRequest) {
  const state = await source(res, request.repository);
  const resolved = await notebookRepository(res, request.notebookId);
  if (resolved.handle.id !== state.entry.ref.id) throw new SourceError('Notebook does not belong to the named repository.', 403);
  let plan;
  try {
    // The saved collection and the manifest name notebooks by local id; the answer names them by key.
    const local = planLegacyOutlineImport(decode(state.bytes), resolved.notebook, resolved.config.notebooks, { ...request, notebookId: resolved.notebook.id });
    plan = { ...local, retained: local.retained.map(keyedItem(resolved.alias)) };
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(error instanceof Error ? error.message : 'Invalid legacy selection.', 400);
  }
  const { handle } = state.entry;
  if (handle.kind === 'local') {
    const destination = regularPath(handle.root, plan.path);
    if (fs.existsSync(destination)) throw new SourceError('Destination already exists. Choose a new outline path.', 409);
  } else {
    const entries = state.snapshot!.entries;
    if (entries.some(item => item.path === plan.path)) throw new SourceError('Destination already exists. Choose a new outline path.', 409);
    if (entries.some(item => plan.path.startsWith(item.path + '/') && (item.mode === '120000' || item.type !== 'tree'))) throw new SourceError('Destination crosses a symlink or non-directory.', 403);
  }
  const token = revisionOf(JSON.stringify([request, state.entry.ref, state.identity, resolved.config, state.revision, state.bytes?.toString('base64'), 'destination-absent']));
  return { state, plan, token };
}

/** Publish a complete file by exclusive hard link; a racing destination is never overwritten. */
function createLocal(root: string, file: string, content: string) {
  const directories: string[] = [];
  let temporary: string | undefined;
  try {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) {
      const directory = regularPath(root, parts.slice(0, i).join('/'));
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
        directories.push(directory);
      }
    }
    const target = regularPath(root, file);
    temporary = path.join(path.dirname(target), `.${randomUUID()}.tmp`);
    fs.writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    fs.linkSync(temporary, regularPath(root, file));
  } catch (error) {
    if (temporary) fs.rmSync(temporary, { force: true });
    for (const directory of directories.reverse()) fs.rmdirSync(directory);
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new SourceError('Destination already exists. Nothing was overwritten.', 409);
    throw error;
  } finally {
    if (temporary) fs.rmSync(temporary, { force: true });
  }
}

export function createOutlineImportRouter(): Router {
  const router = Router();
  const fail = (res: Response, error: unknown) => {
    const protectedPath = error instanceof PathTraversalError || error instanceof SymlinkEscapeError;
    res.status(error instanceof SourceError ? error.status : protectedPath ? 403 : 500).json({ error: error instanceof SourceError || protectedPath ? error.message : 'Import failed. Original legacy bytes are unchanged. Inspect the requested destination before retrying.' });
  };
  router.get('/source', async (req, res) => {
    try {
      const state = await source(res, req.query.repository);
      let page, error;
      try {
        page = decode(state.bytes);
      } catch (issue) {
        error = (issue as Error).message;
      }
      // `base64` keeps the stored bytes for export; `page` names notebooks by key.
      res.json({ repository: state.entry.ref.id, path: BOOKMARKS_FILE, revision: state.revision, writable: state.writable, base64: state.bytes?.toString('base64') ?? null, page: page ? keyedDocument(BOOKMARKS_DOCUMENT, state.entry.alias, page) : null, error: error ?? null });
    } catch (error) {
      fail(res, error);
    }
  });
  router.post('/preview', async (req, res) => {
    try {
      const input = LegacyOutlineImportSchema.safeParse(req.body);
      if (!input.success) throw new SourceError('Invalid import request.', 400);
      const { state, plan, token } = await preview(res, input.data);
      res.json({ ...plan, token, repository: state.entry.ref.id, notebookId: input.data.notebookId, revision: state.revision, writable: state.writable, persistence: state.entry.handle.kind === 'local' ? 'worktree' : 'commit' });
    } catch (error) {
      fail(res, error);
    }
  });
  router.post('/', async (req, res) => {
    try {
      const input = ApplyLegacyOutlineImportSchema.safeParse(req.body);
      if (!input.success) throw new SourceError('Invalid import request.', 400);
      const { token, acknowledgePartial, ...request } = input.data;
      const original = await repository(res, request.repository);
      const apply = async () => {
        const current = await preview(res, request);
        const { state, plan } = current;
        if (!state.writable) throw new SourceError('Import requires write access on main.', 403);
        if (token !== current.token) throw new SourceError('Source, owner, repository or destination changed. Preview again.', 409);
        if (plan.partial && !acknowledgePartial) throw new SourceError('Acknowledge the retained entries before partial import.', 400);
        if (plan.markdown === null) throw new SourceError('No selected entries can be represented as ordinary links. No outline was created.', 422);
        const { handle } = state.entry;
        if (handle.kind !== original.handle.kind || handle.kind === 'local' && original.handle.kind === 'local' && handle.root !== original.handle.root) throw new SourceError('Repository mapping changed. Preview again.', 409);
        let revision: string;
        if (handle.kind === 'local') {
          // A second read after async permission/config loading prevents stale source
          // from being paired with the final write. No awaits occur after this check.
          const bytes = readLocalSource(handle.root);
          if (!bytes || !bytes.equals(state.bytes!)) throw new SourceError('Legacy source changed. Preview again.', 409);
          createLocal(handle.root, plan.path, plan.markdown);
          revision = revisionOf(plan.markdown);
        } else {
          const saved = await handle.reader.commitChanges([{ path: plan.path, content: plan.markdown }], state.snapshot!.sha, 'import-outline', 'notes', undefined, state.snapshot);
          revision = saved.revision;
        }
        res.json({ ...plan, repository: state.entry.ref.id, notebookId: request.notebookId, revision, persistence: handle.kind === 'local' ? 'worktree' : 'commit' });
      };
      if (original.handle.kind === 'local') await serializeWorkspaceMutation(original.handle.root, apply);
      else await apply();
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}
