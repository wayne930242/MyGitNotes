import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getCurrentBranch } from '@mygitnotes/git';
import {
  copyR2Object, createRemoteSource, deleteR2Object, isNotebookR2Key, listR2Objects, loadWorkspaceConfig, managedNotebook, presignR2Object,
  presignR2Upload, putEmptyR2Object, r2NotebookPrefix, r2ObjectExists, r2ReferenceKeys, r2SettingsFromEnv, resolveSafePath, rewriteR2References,
  SourceError, withinPath, type NotebookConfig, type R2Settings, type SourceConfig,
} from '@mygitnotes/core';
import { authToken } from './auth.js';
import { localFileCatalog } from './file-manager.js';
import { serializeWorkspaceMutation } from './workspace-mutation.js';

const markdown = (file: string) => /\.(md|markdown)$/i.test(file);

interface Workspace {
  notebooks: NotebookConfig[];
  /** Reads every Markdown note in managed notebooks. */
  notes: () => Promise<Map<string, string>>;
  /** Persists rewritten notes as one workspace mutation, rejecting when a note changed since `read`. */
  commit: (changes: Map<string, string>, read: Map<string, string>) => Promise<void>;
}

/**
 * Manages a notebook's objects under `<notebookId>/` in the configured R2 bucket.
 * Every route requires the same workspace write capability as file-manager mutations.
 */
export function createR2ManagerRouter(base: string, source: SourceConfig): Router {
  const router = Router();
  const workspace = async (req: Request): Promise<Workspace> => {
    if (source.type === 'local') {
      if (await getCurrentBranch(source.path) !== 'main') throw new SourceError('Write access on the main workspace branch is required.', 403);
      const root = source.path, config = loadWorkspaceConfig(root);
      if (!config) throw new SourceError('Workspace configuration is missing.', 400);
      return {
        notebooks: config.notebooks,
        notes: async () => new Map([...localFileCatalog(root).files.keys()].filter(markdown).map(file => [file, fs.readFileSync(resolveSafePath(root, file), 'utf8')])),
        commit: (changes, read) => serializeWorkspaceMutation(root, async () => {
          for (const file of changes.keys()) if (fs.readFileSync(resolveSafePath(root, file), 'utf8') !== read.get(file)) throw new SourceError('A note changed during the move. Reload and try again.', 409);
          for (const [file, content] of changes) {
            const target = resolveSafePath(root, file), temp = `${target}.${randomUUID()}.tmp`;
            try { fs.writeFileSync(temp, content, { flag: 'wx', mode: fs.statSync(target).mode }); fs.renameSync(temp, target); }
            finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
          }
        }),
      };
    }
    const token = await authToken(req, base), reader = createRemoteSource(source, token);
    const snapshot = token ? await reader.getSnapshot(true) : undefined;
    if (!token || !snapshot?.info.permissions?.push || source.branch !== 'main') throw new SourceError('Write access on the main workspace branch is required.', 403);
    const config = await reader.config();
    return {
      notebooks: config.notebooks,
      notes: async () => {
        const files = snapshot.entries.filter(entry => entry.type === 'blob' && entry.mode !== '120000' && markdown(entry.path) && managedNotebook(entry.path, config.notebooks)).map(entry => entry.path);
        // One archive download warms the blob cache; sequential reads keep any misses within GitHub's request queue.
        await reader.prefetchFiles(files);
        const notes = new Map<string, string>();
        for (const file of files) notes.set(file, (await reader.readFile(file)).toString('utf8'));
        return notes;
      },
      commit: async changes => { await reader.commitChanges([...changes].map(([path, content]) => ({ path, content })), snapshot.sha, 'move', 'files'); },
    };
  };
  const context = async (req: Request, input: Record<string, unknown>) => {
    const space = await workspace(req);
    const notebook = space.notebooks.find(nb => nb.id === input.notebookId);
    if (!notebook) throw new SourceError('Choose a notebook.', 400);
    const settings = r2SettingsFromEnv();
    if (!settings) throw new SourceError('R2 storage is not configured.', 404);
    return { space, notebook, settings };
  };
  const notebookKey = (value: unknown, notebookId: string) => {
    if (typeof value !== 'string' || !isNotebookR2Key(value, notebookId)) throw new SourceError('R2 key is outside this notebook.', 403);
    return value;
  };
  /** Resolves a file key or every object under a folder key. */
  const affected = async (settings: R2Settings, key: string, directory: boolean) => {
    const keys = directory ? (await listR2Objects(settings, key + '/')).map(object => object.key) : [key];
    if (!directory && !await r2ObjectExists(settings, key)) throw new SourceError('R2 object not found.', 404);
    if (!keys.length) throw new SourceError('R2 folder is empty.', 404);
    return keys;
  };
  const referencing = (notes: Map<string, string>, keys: string[]) =>
    [...notes].filter(([, content]) => r2ReferenceKeys(content).some(key => keys.includes(key))).map(([file]) => file).sort();
  const handle = (action: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try { await action(req, res); } catch (error) {
      const retryAfter = error instanceof SourceError ? error.retryAfter : undefined;
      if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
      res.status(error instanceof SourceError ? error.status : 502).json({ error: error instanceof Error ? error.message : 'R2 operation failed.', ...(retryAfter ? { retryAfter } : {}) });
    }
  };

  router.get('/api/r2', handle(async (req, res) => {
    const { notebook, settings } = await context(req, req.query);
    const prefix = r2NotebookPrefix(notebook.id);
    res.json({ prefix, objects: (await listR2Objects(settings, prefix)).filter(object => isNotebookR2Key(object.key, notebook.id)) });
  }));
  router.get('/api/r2/raw', handle(async (req, res) => {
    const { notebook, settings } = await context(req, req.query);
    res.redirect(302, await presignR2Object(settings, notebookKey(req.query.key, notebook.id), 300, req.query.download === '1'));
  }));
  router.post('/api/r2/upload', handle(async (req, res) => {
    const { notebook, settings } = await context(req, req.body);
    const key = notebookKey(req.body.key, notebook.id);
    if (await r2ObjectExists(settings, key)) throw new SourceError('Destination already exists.', 409);
    res.json({ key, url: await presignR2Upload(settings, key) });
  }));
  router.post('/api/r2/mkdir', handle(async (req, res) => {
    const { notebook, settings } = await context(req, req.body);
    const key = notebookKey(`${req.body.key}/.keep`, notebook.id);
    if ((await listR2Objects(settings, `${req.body.key}/`)).length || await r2ObjectExists(settings, req.body.key) || !await putEmptyR2Object(settings, key)) throw new SourceError('Destination already exists.', 409);
    res.json({ key });
  }));
  router.get('/api/r2/references', handle(async (req, res) => {
    const { space, notebook, settings } = await context(req, req.query);
    const objects = await affected(settings, notebookKey(req.query.key, notebook.id), req.query.directory === '1');
    res.json({ objects, notes: referencing(await space.notes(), objects) });
  }));
  router.post('/api/r2/move', handle(async (req, res) => {
    const { space, notebook, settings } = await context(req, req.body);
    const key = notebookKey(req.body.key, notebook.id), destination = notebookKey(req.body.destination, notebook.id);
    if (withinPath(destination, key)) throw new SourceError('Choose a destination outside the moved item.', 400);
    const objects = await affected(settings, key, req.body.directory === true);
    // CopyObject has no destination precondition on R2, so this check stays check-then-act.
    const moves = Object.fromEntries(objects.map(object => [object, destination + object.slice(key.length)]));
    for (const target of Object.values(moves)) if (await r2ObjectExists(settings, target)) throw new SourceError('Destination already exists.', 409);
    const notes = await space.notes();
    const rewritten = new Map([...notes].map(([file, content]) => [file, rewriteR2References(content, moves)] as [string, string]).filter(([file, content]) => content !== notes.get(file)));
    const copied: string[] = [];
    try {
      for (const [from, to] of Object.entries(moves)) { await copyR2Object(settings, from, to); copied.push(to); }
      if (rewritten.size) await space.commit(rewritten, notes);
    } catch (error) {
      await Promise.allSettled(copied.map(target => deleteR2Object(settings, target)));
      throw error;
    }
    for (const from of objects) await deleteR2Object(settings, from);
    res.json({ moves, notes: [...rewritten.keys()].sort() });
  }));
  router.post('/api/r2/delete', handle(async (req, res) => {
    const { notebook, settings } = await context(req, req.body);
    const objects = await affected(settings, notebookKey(req.body.key, notebook.id), req.body.directory === true);
    for (const object of objects) await deleteR2Object(settings, object);
    res.json({ deleted: objects });
  }));
  return router;
}
