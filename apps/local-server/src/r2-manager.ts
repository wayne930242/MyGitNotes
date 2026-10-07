import { type Request, type Response, Router } from 'express';
import fs from 'node:fs';
import { getCurrentBranch } from '@mygitnotes/git';
import { copyR2Object, deleteR2Object, isValidR2Key, listR2Objects, managedNotebook, type NotebookConfig, presignR2Object, presignR2Upload, putEmptyR2Object, r2ObjectExists, r2ReferenceKeys, resolveSafePath, rewriteR2References, SourceError, withinPath } from '@mygitnotes/core';
import { type AssetScope, type AssetStorage, inAssetScope, resolveAssetScope } from './asset-storage.js';
import { eachRepository, type RepositoryHandle } from './request-workspace.js';
import { localFileCatalog } from './file-manager.js';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { writeFileAtomicSync } from './workspace-files.js';

const markdown = (file: string) => /\.(md|markdown)$/i.test(file);

/** One available repository's notes, for scanning and rewriting R2 references. */
interface RepositoryNotes {
  id: string;
  notebooks: NotebookConfig[];
  /** Whether the requester may rewrite this repository's notes. */
  writable: boolean;
  /** Reads every Markdown note in the repository's managed notebooks. */
  notes: () => Promise<Map<string, string>>;
  /** Persists rewritten notes as one mutation of this repository, rejecting when a note changed since `read`. */
  commit: (changes: Map<string, string>, read: Map<string, string>) => Promise<void>;
}
/** A note of one repository that references R2 objects. */
interface ReferencingNote {
  repository: string;
  notebookId: string;
  path: string;
}

/**
 * Manages every object in the requester's asset scope (the whole configured bucket, by default); notes may
 * reference any key, so the manager is not confined to a notebook prefix. A key outside the scope answers
 * 404. Routes require write access to the named notebook's repository, and a move requires it for every
 * repository whose notes it rewrites.
 */
export function createR2ManagerRouter(storage: AssetStorage): Router {
  const router = Router();
  const open = async (id: string, handle: RepositoryHandle, config: { notebooks: NotebookConfig[]; }): Promise<RepositoryNotes> => {
    if (handle.kind === 'local') {
      const { root } = handle;
      return {
        id,
        notebooks: config.notebooks,
        writable: await getCurrentBranch(root) === 'main',
        notes: async () => new Map([...localFileCatalog(root, config.notebooks).files.keys()].filter(markdown).map(file => [file, fs.readFileSync(resolveSafePath(root, file), 'utf8')])),
        commit: (changes, read) =>
          serializeWorkspaceMutation(root, async () => {
            for (const file of changes.keys()) if (fs.readFileSync(resolveSafePath(root, file), 'utf8') !== read.get(file)) throw new SourceError('A note changed during the move. Reload and try again.', 409);
            for (const [file, content] of changes) {
              const target = resolveSafePath(root, file);
              writeFileAtomicSync(target, content, fs.statSync(target).mode);
            }
          }),
      };
    }
    const { reader } = handle;
    const snapshot = handle.authenticated ? await reader.getSnapshot(true) : undefined;
    return {
      id,
      notebooks: config.notebooks,
      writable: Boolean(snapshot && reader.canWrite(snapshot)),
      notes: async () => {
        if (!snapshot) throw new SourceError('Write access on the main workspace branch is required.', 403);
        const matching = snapshot.entries.filter(entry => entry.type === 'blob' && entry.mode !== '120000' && markdown(entry.path) && managedNotebook(entry.path, config.notebooks));
        const totalBytes = matching.reduce((sum, entry) => sum + (entry.size || 0), 0);
        if (totalBytes > 32 * 1024 * 1024) throw new SourceError('R2 operations support up to 32 MiB of notebook text.', 413);
        const files = matching.map(entry => entry.path);
        // One archive download warms the blob cache; sequential reads keep any misses within GitHub's request queue.
        await reader.prefetchFiles(files);
        const notes = new Map<string, string>();
        for (const file of files) notes.set(file, (await reader.readFile(file)).toString('utf8'));
        return notes;
      },
      commit: async (changes, _read) => {
        if (!snapshot) throw new SourceError('Write access on the main workspace branch is required.', 403);
        await reader.commitChanges([...changes].map(([path, content]) => ({ path, content })), snapshot.sha, 'move', 'files');
      },
    };
  };
  /**
   * The named notebook and every available repository, opened only when a route scans notes. The notebook's
   * repository must be writable: `authorize` checks that (it is checked at once unless `deferAuthorize` is set).
   */
  const context = async (req: Request, res: Response, input: Record<string, unknown>, deferAuthorize = false) => {
    const entries = await eachRepository(res);
    const target = entries.find(({ config }) => config.notebooks.some(nb => nb.id === input.notebookId));
    const notebook = target?.config.notebooks.find(nb => nb.id === input.notebookId);
    if (!target || !notebook) throw new SourceError('Choose a notebook.', 400);
    const opened = new Map<string, Promise<RepositoryNotes>>();
    const openEntry = ({ handle, config }: (typeof entries)[number]) => {
      if (!opened.has(handle.id)) opened.set(handle.id, open(handle.id, handle, config));
      return opened.get(handle.id)!;
    };
    const authorize = async () => {
      if (!(await openEntry(target)).writable) throw new SourceError('Write access on the main workspace branch is required.', 403);
    };
    if (!deferAuthorize) await authorize();
    const scope = await resolveAssetScope(storage, req, res, target.handle);
    if (!scope) throw new SourceError('R2 storage is not configured.', 404);
    /** Tells the storage about a size change; a failure ends the request, so a quota never drifts silently. */
    const record = (key: string, deltaBytes: number) => storage.record?.(scope, key, deltaBytes) ?? Promise.resolve();
    return { repositories: () => Promise.all(entries.map(openEntry)), notebook, scope, settings: scope.settings, record, authorize };
  };
  /** A well-formed key inside the scope; a key outside it is not found, whatever it names. */
  const bucketKey = (scope: AssetScope, value: unknown) => {
    if (typeof value !== 'string' || !isValidR2Key(value)) throw new SourceError('R2 key is invalid.', 403);
    if (!inAssetScope(scope, value)) throw new SourceError('R2 object not found.', 404);
    return value;
  };
  /** Resolves a file key or every object under a folder key, with each object's size when the storage meters them. */
  const affected = async (scope: AssetScope, key: string, directory: boolean) => {
    const { settings } = scope;
    let objects: { key: string; size: number; }[];
    if (directory) objects = await listR2Objects(settings, key + '/');
    else if (storage.record) objects = (await listR2Objects(settings, key)).filter(object => object.key === key);
    else objects = await r2ObjectExists(settings, key) ? [{ key, size: 0 }] : [];
    if (!directory && !objects.length) throw new SourceError('R2 object not found.', 404);
    if (!objects.length) throw new SourceError('R2 folder is empty.', 404);
    return objects;
  };
  /** Notes of every repository that reference any of `keys`, named by notebook and path: two repositories can hold the same path. */
  const referencing = (repository: RepositoryNotes, notes: Map<string, string>, keys: string[]): ReferencingNote[] => [...notes].filter(([, content]) => r2ReferenceKeys(content).some(key => keys.includes(key))).map(([file]) => ({ repository: repository.id, notebookId: managedNotebook(file, repository.notebooks)!.id, path: file }));
  const byPath = (a: ReferencingNote, b: ReferencingNote) => a.path.localeCompare(b.path) || a.notebookId.localeCompare(b.notebookId);
  const handle = (action: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      await action(req, res);
    } catch (error) {
      const retryAfter = error instanceof SourceError ? error.retryAfter : undefined;
      if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
      res.status(error instanceof SourceError ? error.status : 502).json({ error: error instanceof Error ? error.message : 'R2 operation failed.', ...(retryAfter ? { retryAfter } : {}) });
    }
  };

  router.get(
    '/api/r2',
    handle(async (req, res) => {
      const { scope } = await context(req, res, req.query);
      res.json({ prefix: scope.prefix, objects: (await listR2Objects(scope.settings, scope.prefix)).filter(object => isValidR2Key(object.key)) });
    }),
  );
  router.get(
    '/api/r2/raw',
    handle(async (req, res) => {
      const { scope, settings } = await context(req, res, req.query);
      res.redirect(302, await presignR2Object(settings, bucketKey(scope, req.query.key), 300, req.query.download === '1'));
    }),
  );
  router.post(
    '/api/r2/upload',
    handle(async (req, res) => {
      const { scope, settings } = await context(req, res, req.body);
      const key = bucketKey(scope, req.body.key);
      const size = req.body.size;
      if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) throw new SourceError('Upload size is required.', 400);
      if (size > scope.limits.maxObjectBytes) throw new SourceError('The file is larger than the storage allows for one object.', 413);
      if (await r2ObjectExists(settings, key)) throw new SourceError('Destination already exists.', 409);
      await storage.reserve?.(scope, key, size);
      res.json({ key, url: await presignR2Upload(settings, key, undefined, size) });
    }),
  );
  router.post(
    '/api/r2/uploaded',
    handle(async (req, res) => {
      const { scope, settings, record, authorize } = await context(req, res, req.body, true);
      const key = bucketKey(scope, req.body.key);
      // Without a quota to settle there is nothing to confirm, so the community default makes no further request.
      if (!storage.record) return res.json({ key });
      await authorize();
      // The browser sent the object straight to the bucket, so the storage learns its size from the bucket.
      // Confirming a key is idempotent: a repeat records the same key and size again (see `AssetStorage.record`).
      const object = (await listR2Objects(settings, key)).find(found => found.key === key);
      if (!object) throw new SourceError('R2 object not found.', 404);
      await record(key, object.size);
      res.json({ key });
    }),
  );
  router.post(
    '/api/r2/mkdir',
    handle(async (req, res) => {
      const { scope, settings, record } = await context(req, res, req.body);
      const folder = bucketKey(scope, req.body.key);
      const key = bucketKey(scope, `${folder}/.keep`);
      if ((await listR2Objects(settings, `${folder}/`)).length || await r2ObjectExists(settings, folder) || !await putEmptyR2Object(settings, key)) throw new SourceError('Destination already exists.', 409);
      await record(key, 0);
      res.json({ key });
    }),
  );
  router.get(
    '/api/r2/references',
    handle(async (req, res) => {
      const { repositories, scope } = await context(req, res, req.query);
      const objects = (await affected(scope, bucketKey(scope, req.query.key), req.query.directory === '1')).map(object => object.key);
      const notes = (await Promise.all((await repositories()).map(async repository => referencing(repository, await repository.notes(), objects)))).flat().sort(byPath);
      res.json({ objects, notes: notes.map(({ notebookId, path }) => ({ notebookId, path })) });
    }),
  );
  router.post(
    '/api/r2/move',
    handle(async (req, res) => {
      const { repositories, scope, settings, record } = await context(req, res, req.body);
      const key = bucketKey(scope, req.body.key), destination = bucketKey(scope, req.body.destination);
      if (withinPath(destination, key)) throw new SourceError('Choose a destination outside the moved item.', 400);
      const found = await affected(scope, key, req.body.directory === true);
      const objects = found.map(object => object.key), bytes = new Map(found.map(object => [object.key, object.size]));
      // CopyObject has no destination precondition on R2, so this check stays check-then-act.
      const moves = Object.fromEntries(objects.map(object => [object, destination + object.slice(key.length)]));
      for (const target of Object.values(moves)) if (await r2ObjectExists(settings, target)) throw new SourceError('Destination already exists.', 409);
      // Each repository's rewritten notes land in one commit there; every such repository must be writable before anything is copied.
      const rewrites = (await Promise.all((await repositories()).map(async repository => {
        const notes = await repository.notes();
        const rewritten = new Map([...notes].map(([file, content]) => [file, rewriteR2References(content, moves)] as [string, string]).filter(([file, content]) => content !== notes.get(file)));
        return { repository, notes, rewritten };
      }))).filter(({ rewritten }) => rewritten.size);
      const readOnly = rewrites.find(({ repository }) => !repository.writable);
      if (readOnly) throw new SourceError(`Write access to ${readOnly.repository.id} is required to rewrite its notes.`, 403);
      const copied: { to: string; bytes: number; }[] = [];
      const committed: string[] = [];
      try {
        for (const [from, to] of Object.entries(moves)) {
          await copyR2Object(settings, from, to);
          copied.push({ to, bytes: bytes.get(from)! });
          await record(to, bytes.get(from)!);
        }
        for (const { repository, notes, rewritten } of rewrites) {
          await repository.commit(rewritten, notes);
          committed.push(repository.id);
        }
      } catch (error) {
        // Before any commit the move is undone; after one, notes point at both keys, so both stay.
        if (!committed.length) {
          const undo = async ({ to, bytes }: (typeof copied)[number]) => {
            await deleteR2Object(settings, to);
            await record(to, -bytes);
          };
          await Promise.allSettled(copied.map(undo));
          throw error;
        }
        const status = error instanceof SourceError ? error.status : 502;
        return res.status(status).json({ error: `${(error as Error).message} Notes in ${committed.join(', ')} were rewritten; both the old and the new keys remain.`, committed });
      }
      for (const from of objects) {
        await deleteR2Object(settings, from);
        await record(from, -bytes.get(from)!);
      }
      const notes = rewrites.flatMap(({ repository, rewritten }) => [...rewritten.keys()].map(file => ({ repository: repository.id, notebookId: managedNotebook(file, repository.notebooks)!.id, path: file }))).sort(byPath);
      res.json({ moves, notes: notes.map(({ notebookId, path }) => ({ notebookId, path })) });
    }),
  );
  router.post(
    '/api/r2/delete',
    handle(async (req, res) => {
      const { scope, settings, record } = await context(req, res, req.body);
      const objects = await affected(scope, bucketKey(scope, req.body.key), req.body.directory === true);
      for (const object of objects) {
        await deleteR2Object(settings, object.key);
        await record(object.key, -object.size);
      }
      res.json({ deleted: objects.map(object => object.key) });
    }),
  );
  return router;
}
