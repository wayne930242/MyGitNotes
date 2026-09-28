import { type Request, type Response, Router } from 'express';
import fs from 'node:fs';
import { getCurrentBranch } from '@mygitnotes/git';
import { copyR2Object, deleteR2Object, isValidR2Key, listR2Objects, managedNotebook, type NotebookConfig, presignR2Object, presignR2Upload, putEmptyR2Object, r2ObjectExists, r2ReferenceKeys, type R2Settings, r2SettingsFromEnv, resolveSafePath, rewriteR2References, SourceError, withinPath } from '@mygitnotes/core';
import { homeRepository } from './request-workspace.js';
import { localFileCatalog } from './file-manager.js';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { writeFileAtomicSync } from './workspace-files.js';

const markdown = (file: string) => /\.(md|markdown)$/i.test(file);

interface Workspace {
  notebooks: NotebookConfig[];
  /** Reads every Markdown note in managed notebooks. */
  notes: () => Promise<Map<string, string>>;
  /** Persists rewritten notes as one workspace mutation, rejecting when a note changed since `read`. */
  commit: (changes: Map<string, string>, read: Map<string, string>) => Promise<void>;
}

/**
 * Manages every object in the configured R2 bucket; notes may reference any key, so the manager is not
 * confined to a notebook prefix. Every route requires the same workspace write capability as file-manager mutations.
 */
export function createR2ManagerRouter(): Router {
  const router = Router();
  const workspace = async (res: Response): Promise<Workspace> => {
    const { handle, config } = await homeRepository(res);
    if (handle.kind === 'local') {
      const { root } = handle;
      if (await getCurrentBranch(root) !== 'main') throw new SourceError('Write access on the main workspace branch is required.', 403);
      return {
        notebooks: config.notebooks,
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
    if (!snapshot || !reader.canWrite(snapshot)) throw new SourceError('Write access on the main workspace branch is required.', 403);
    return {
      notebooks: config.notebooks,
      notes: async () => {
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
        await reader.commitChanges([...changes].map(([path, content]) => ({ path, content })), snapshot.sha, 'move', 'files');
      },
    };
  };
  const context = async (res: Response, input: Record<string, unknown>) => {
    const space = await workspace(res);
    const notebook = space.notebooks.find(nb => nb.id === input.notebookId);
    if (!notebook) throw new SourceError('Choose a notebook.', 400);
    const settings = r2SettingsFromEnv();
    if (!settings) throw new SourceError('R2 storage is not configured.', 404);
    return { space, notebook, settings };
  };
  const bucketKey = (value: unknown) => {
    if (typeof value !== 'string' || !isValidR2Key(value)) throw new SourceError('R2 key is invalid.', 403);
    return value;
  };
  /** Resolves a file key or every object under a folder key. */
  const affected = async (settings: R2Settings, key: string, directory: boolean) => {
    const keys = directory ? (await listR2Objects(settings, key + '/')).map(object => object.key) : [key];
    if (!directory && !await r2ObjectExists(settings, key)) throw new SourceError('R2 object not found.', 404);
    if (!keys.length) throw new SourceError('R2 folder is empty.', 404);
    return keys;
  };
  const referencing = (notes: Map<string, string>, keys: string[]) => [...notes].filter(([, content]) => r2ReferenceKeys(content).some(key => keys.includes(key))).map(([file]) => file).sort();
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
      const { settings } = await context(res, req.query);
      res.json({ prefix: '', objects: (await listR2Objects(settings, '')).filter(object => isValidR2Key(object.key)) });
    }),
  );
  router.get(
    '/api/r2/raw',
    handle(async (req, res) => {
      const { settings } = await context(res, req.query);
      res.redirect(302, await presignR2Object(settings, bucketKey(req.query.key), 300, req.query.download === '1'));
    }),
  );
  router.post(
    '/api/r2/upload',
    handle(async (req, res) => {
      const { settings } = await context(res, req.body);
      const key = bucketKey(req.body.key);
      if (await r2ObjectExists(settings, key)) throw new SourceError('Destination already exists.', 409);
      res.json({ key, url: await presignR2Upload(settings, key) });
    }),
  );
  router.post(
    '/api/r2/mkdir',
    handle(async (req, res) => {
      const { settings } = await context(res, req.body);
      const key = bucketKey(`${bucketKey(req.body.key)}/.keep`);
      if ((await listR2Objects(settings, `${req.body.key}/`)).length || await r2ObjectExists(settings, req.body.key) || !await putEmptyR2Object(settings, key)) throw new SourceError('Destination already exists.', 409);
      res.json({ key });
    }),
  );
  router.get(
    '/api/r2/references',
    handle(async (req, res) => {
      const { space, settings } = await context(res, req.query);
      const objects = await affected(settings, bucketKey(req.query.key), req.query.directory === '1');
      res.json({ objects, notes: referencing(await space.notes(), objects) });
    }),
  );
  router.post(
    '/api/r2/move',
    handle(async (req, res) => {
      const { space, settings } = await context(res, req.body);
      const key = bucketKey(req.body.key), destination = bucketKey(req.body.destination);
      if (withinPath(destination, key)) throw new SourceError('Choose a destination outside the moved item.', 400);
      const objects = await affected(settings, key, req.body.directory === true);
      // CopyObject has no destination precondition on R2, so this check stays check-then-act.
      const moves = Object.fromEntries(objects.map(object => [object, destination + object.slice(key.length)]));
      for (const target of Object.values(moves)) if (await r2ObjectExists(settings, target)) throw new SourceError('Destination already exists.', 409);
      const notes = await space.notes();
      const rewritten = new Map([...notes].map(([file, content]) => [file, rewriteR2References(content, moves)] as [string, string]).filter(([file, content]) => content !== notes.get(file)));
      const copied: string[] = [];
      try {
        for (const [from, to] of Object.entries(moves)) {
          await copyR2Object(settings, from, to);
          copied.push(to);
        }
        if (rewritten.size) await space.commit(rewritten, notes);
      } catch (error) {
        await Promise.allSettled(copied.map(target => deleteR2Object(settings, target)));
        throw error;
      }
      for (const from of objects) await deleteR2Object(settings, from);
      res.json({ moves, notes: [...rewritten.keys()].sort() });
    }),
  );
  router.post(
    '/api/r2/delete',
    handle(async (req, res) => {
      const { settings } = await context(res, req.body);
      const objects = await affected(settings, bucketKey(req.body.key), req.body.directory === true);
      for (const object of objects) await deleteR2Object(settings, object);
      res.json({ deleted: objects });
    }),
  );
  return router;
}
