import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { emptyStudyWorkspace, StudyWorkspaceSchema, STUDY_FILE, STUDY_MAX_BYTES, GitHubSource, SourceError, type SourceConfig } from '@github-notes/core';
import { getCurrentBranch } from '@github-notes/git';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { authToken } from './auth.js';

const revisionOf = (text: string | null) => text === null ? 'missing' : createHash('sha256').update(text).digest('hex');
async function readLocal(root: string) {
  const file = path.join(root, STUDY_FILE);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new SourceError('Study data must be a regular file.', 403);
    if (stat.size > STUDY_MAX_BYTES) throw new SourceError('Study data is too large.', 413);
    return await fs.readFile(file, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function decode(raw: string | null) {
  if (raw !== null && Buffer.byteLength(raw) > STUDY_MAX_BYTES) throw new SourceError('Study data is too large.', 413);
  try { return raw === null ? emptyStudyWorkspace() : StudyWorkspaceSchema.parse(parse(raw, { maxAliasCount: 20 })); }
  catch { throw new SourceError('Invalid study workspace YAML. Fix the file before saving.', 422); }
}
function fail(res: import('express').Response, error: unknown) {
  res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof SourceError ? error.message : 'Study data could not be saved. Your draft is preserved.' });
}

export function createStudyRouter(base: string, source: SourceConfig): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    try {
      if (source.type === 'local') {
        const raw = await readLocal(source.path);
        return res.json({ study: decode(raw), revision: revisionOf(raw), path: STUDY_FILE, writable: await getCurrentBranch(source.path) === 'main' });
      }
      const token = await authToken(req, base);
      const reader = new GitHubSource(source.repository, source.branch, token);
      const snapshot = await reader.getSnapshot();
      const exists = snapshot.entries.some(entry => entry.path === STUDY_FILE);
      const raw = exists ? (await reader.readFile(STUDY_FILE)).toString('utf8') : null;
      res.json({ study: decode(raw), revision: snapshot.sha, path: STUDY_FILE, writable: Boolean(token && snapshot.info.permissions?.push && source.branch === 'main') });
    } catch (error) { fail(res, error); }
  });
  router.put('/', async (req, res) => {
    try {
      const value = StudyWorkspaceSchema.safeParse(req.body?.study);
      const revision = req.body?.revision;
      if (!value.success || typeof revision !== 'string' || !revision || Object.keys(req.body).some(key => !['study', 'revision'].includes(key))) throw new SourceError('Invalid study workspace configuration.', 400);
      const yaml = stringify(value.data, { lineWidth: 0 });
      if (Buffer.byteLength(yaml) > STUDY_MAX_BYTES) throw new SourceError('Study data is too large.', 413);
      if (source.type === 'local') {
        return await serializeWorkspaceMutation(source.path, async () => {
          if (await getCurrentBranch(source.path) !== 'main') throw new SourceError('Switch to main to save the study workspace.', 403);
          const raw = await readLocal(source.path);
          if (revisionOf(raw) !== revision) throw new SourceError('The study workspace changed. Reload it before saving your draft.', 409);
          const target = path.join(source.path, STUDY_FILE);
          const temporary = `${target}.${randomUUID()}.tmp`;
          try { await fs.writeFile(temporary, yaml, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, target); }
          finally { await fs.rm(temporary, { force: true }); }
          res.json({ study: value.data, revision: revisionOf(yaml), path: STUDY_FILE, writable: true });
        });
      }
      const token = await authToken(req, base);
      if (!token) throw new SourceError('Sign in with write access to save the study workspace.', 403);
      const reader = new GitHubSource(source.repository, source.branch, token);
      const saved = await reader.saveStudyWorkspace(yaml, revision);
      res.json({ study: value.data, revision: saved.revision, path: STUDY_FILE, writable: true });
    } catch (error) { fail(res, error); }
  });
  return router;
}
