import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { emptyScreenPage, readScreenPage, loadWorkspaceConfig, ScreenPageSchema, SCREEN_PAGE_FILE, createRemoteSource, SourceError, type ScreenNotebookConfig, type SourceConfig } from '@mygitnotes/core';
import { getCurrentBranch } from '@mygitnotes/git';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { authToken } from './auth.js';

const revisionOf = (text: string | null) => text === null ? 'missing' : createHash('sha256').update(text).digest('hex');
async function readLocal(root: string) {
  const file = path.join(root, SCREEN_PAGE_FILE);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new SourceError('Screen configuration must be a regular file.', 403);
    if (stat.size > 512 * 1024) throw new SourceError('Screen configuration is too large.', 413);
    return await fs.readFile(file, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function decode(raw: string | null, config: ScreenNotebookConfig | null) {
  try { return raw === null ? emptyScreenPage() : readScreenPage(parse(raw, { maxAliasCount: 20 }), config); }
  catch { throw new SourceError('Invalid Screen Page YAML. Fix the file before saving.', 422); }
}
function fail(res: import('express').Response, error: unknown) {
  res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof SourceError ? error.message : 'Screen configuration could not be saved. Your draft is preserved.' });
}

export function createScreenPageRouter(base: string, source: SourceConfig): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    try {
      if (source.type === 'local') {
        const raw = await readLocal(source.path);
        return res.json({ page: decode(raw, loadWorkspaceConfig(source.path)), revision: revisionOf(raw), path: SCREEN_PAGE_FILE, writable: await getCurrentBranch(source.path) === 'main' });
      }
      const token = await authToken(req, base);
      const reader = createRemoteSource(source, token);
      const snapshot = await reader.getSnapshot();
      const exists = snapshot.entries.some(entry => entry.path === SCREEN_PAGE_FILE);
      const raw = exists ? (await reader.readFile(SCREEN_PAGE_FILE)).toString('utf8') : null;
      res.json({ page: decode(raw, await reader.config()), revision: snapshot.sha, path: SCREEN_PAGE_FILE, writable: Boolean(token && snapshot.info.permissions?.push && source.branch === 'main') });
    } catch (error) { fail(res, error); }
  });
  router.put('/', async (req, res) => {
    try {
      const value = ScreenPageSchema.safeParse(req.body?.page);
      const revision = req.body?.revision;
      if (!value.success || typeof revision !== 'string' || !revision || Object.keys(req.body).some(key => !['page', 'revision'].includes(key))) throw new SourceError('Invalid Screen Page configuration.', 400);
      const yaml = stringify(value.data, { lineWidth: 0 });
      if (Buffer.byteLength(yaml) > 512 * 1024) throw new SourceError('Screen configuration is too large.', 413);
      if (source.type === 'local') {
        return await serializeWorkspaceMutation(source.path, async () => {
          if (await getCurrentBranch(source.path) !== 'main') throw new SourceError('Switch to main to save the Screen Page.', 403);
          const raw = await readLocal(source.path);
          if (revisionOf(raw) !== revision) throw new SourceError('The Screen Page changed. Reload it before saving your draft.', 409);
          const target = path.join(source.path, SCREEN_PAGE_FILE);
          const temporary = `${target}.${randomUUID()}.tmp`;
          try { await fs.writeFile(temporary, yaml, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, target); }
          finally { await fs.rm(temporary, { force: true }); }
          res.json({ page: value.data, revision: revisionOf(yaml), path: SCREEN_PAGE_FILE, writable: true });
        });
      }
      const token = await authToken(req, base);
      if (!token) throw new SourceError('Sign in with write access to save the Screen Page.', 403);
      const reader = createRemoteSource(source, token);
      const saved = await reader.saveScreenPage(yaml, revision);
      res.json({ page: value.data, revision: saved.revision, path: SCREEN_PAGE_FILE, writable: true });
    } catch (error) { fail(res, error); }
  });
  return router;
}
