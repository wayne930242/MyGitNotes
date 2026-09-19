import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRemoteSource, loadWorkspaceConfig, readWorkspaceDocument, SCREEN_DOCUMENT, serializeWorkspaceDocument, type SourceConfig, SourceError, type WorkspaceConfig, type WorkspaceDocument } from '@mygitnotes/core';
import { getCurrentBranch } from '@mygitnotes/git';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { authToken } from './auth.js';

const revisionOf = (text: string | null) => text === null ? 'missing' : createHash('sha256').update(text).digest('hex');

/** Reads and writes one workspace document as `{ page, revision, path, writable }`. */
export function createWorkspaceDocumentRouter(base: string, source: SourceConfig, document: WorkspaceDocument): Router {
  const { file, label, maxBytes } = document;
  async function readLocal(root: string, name = file) {
    const target = path.join(root, name);
    try {
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new SourceError(`${label} configuration must be a regular file.`, 403);
      if (stat.size > maxBytes) throw new SourceError(`${label} configuration is too large.`, 413);
      return await fs.readFile(target, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  function decode(raw: string | null, config: WorkspaceConfig | null) {
    try {
      return readWorkspaceDocument(document, raw, config);
    } catch {
      throw new SourceError(`Invalid ${label} YAML. Fix the file before saving.`, 422);
    }
  }
  /** Applies the document's notebook ownership rule against the workspace notebooks and Screen lanes. */
  async function own(value: unknown, config: WorkspaceConfig | null, readScreen: () => Promise<string | null>) {
    if (!document.own) return { page: value, foreign: false };
    let screen;
    try {
      screen = readWorkspaceDocument(SCREEN_DOCUMENT, await readScreen(), config);
    } catch {
      throw new SourceError('Invalid Screen YAML. Fix the file before saving.', 422);
    }
    return document.own(value, config?.notebooks ?? [], screen);
  }
  function fail(res: import('express').Response, error: unknown) {
    res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof SourceError ? error.message : `${label} configuration could not be saved. Your draft is preserved.` });
  }
  const router = Router();
  router.get('/', async (req, res) => {
    try {
      if (source.type === 'local') {
        const raw = await readLocal(source.path);
        const config = loadWorkspaceConfig(source.path);
        const { page } = await own(decode(raw, config), config, () => readLocal(source.path, SCREEN_DOCUMENT.file));
        return res.json({ page, revision: revisionOf(raw), path: file, writable: await getCurrentBranch(source.path) === 'main' });
      }
      const token = await authToken(req, base);
      const reader = createRemoteSource(source, token);
      const snapshot = await reader.getSnapshot();
      const exists = snapshot.entries.some(entry => entry.path === file);
      const raw = exists ? (await reader.readFile(file)).toString('utf8') : null;
      const config = await reader.config();
      const { page } = await own(decode(raw, config), config, async () => snapshot.entries.some(entry => entry.path === SCREEN_DOCUMENT.file) ? (await reader.readFile(SCREEN_DOCUMENT.file)).toString('utf8') : null);
      res.json({ page, revision: snapshot.sha, path: file, writable: Boolean(token && snapshot.info.permissions?.push && source.branch === 'main') });
    } catch (error) {
      fail(res, error);
    }
  });
  router.put('/', async (req, res) => {
    try {
      const value = document.schema.safeParse(req.body?.page);
      const revision = req.body?.revision;
      if (!value.success || typeof revision !== 'string' || !revision || Object.keys(req.body).some(key => !['page', 'revision'].includes(key))) throw new SourceError(`Invalid ${label} configuration.`, 400);
      const yaml = serializeWorkspaceDocument(value.data);
      if (Buffer.byteLength(yaml) > maxBytes) throw new SourceError(`${label} configuration is too large.`, 413);
      const foreign = () => new SourceError(`${label} content must belong to its notebook.`, 400);
      if (source.type === 'local') {
        return await serializeWorkspaceMutation(source.path, async () => {
          if (await getCurrentBranch(source.path) !== 'main') throw new SourceError(`Switch to main to save the ${label} configuration.`, 403);
          if ((await own(value.data, loadWorkspaceConfig(source.path), () => readLocal(source.path, SCREEN_DOCUMENT.file))).foreign) throw foreign();
          const raw = await readLocal(source.path);
          if (revisionOf(raw) !== revision) throw new SourceError(`The ${label} configuration changed. Reload it before saving your draft.`, 409);
          const target = path.join(source.path, file);
          const temporary = `${target}.${randomUUID()}.tmp`;
          try {
            await fs.writeFile(temporary, yaml, { flag: 'wx', mode: 0o600 });
            await fs.rename(temporary, target);
          } finally {
            await fs.rm(temporary, { force: true });
          }
          res.json({ page: value.data, revision: revisionOf(yaml), path: file, writable: true });
        });
      }
      const token = await authToken(req, base);
      if (!token) throw new SourceError(`Sign in with write access to save the ${label} configuration.`, 403);
      const reader = createRemoteSource(source, token);
      const snapshot = await reader.getSnapshot();
      const screen = async () => snapshot.entries.some(entry => entry.path === SCREEN_DOCUMENT.file) ? (await reader.readFile(SCREEN_DOCUMENT.file)).toString('utf8') : null;
      if ((await own(value.data, await reader.config(), screen)).foreign) throw foreign();
      const saved = await reader.saveWorkspaceDocument(document, yaml, revision);
      res.json({ page: value.data, revision: saved.revision, path: file, writable: true });
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}
