import { Router } from 'express';
import path from 'node:path';
import { readWorkspaceDocument, serializeWorkspaceDocument, SourceError, type WorkspaceConfig, type WorkspaceDocument } from '@mygitnotes/core';
import { getCurrentBranch } from '@mygitnotes/git';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { repositoryOrHome as documentRepository } from './request-workspace.js';
import { readBoundedFile, readSnapshotText, revisionOf, writeFileAtomic } from './workspace-files.js';

/** Reads and writes one workspace document of one repository as `{ page, revision, path, writable, repository }`. */
export function createWorkspaceDocumentRouter(document: WorkspaceDocument): Router {
  const { file, label, maxBytes } = document;
  const readLocal = (root: string) => readBoundedFile(root, file, maxBytes, `${label} configuration`);
  function decode(raw: string | null, config: WorkspaceConfig | null) {
    try {
      return readWorkspaceDocument(document, raw);
    } catch {
      throw new SourceError(`Invalid ${label} YAML. Fix the file before saving.`, 422);
    }
  }
  /** Applies the document's notebook ownership rule against the workspace notebooks. */
  function own(value: unknown, config: WorkspaceConfig | null) {
    return document.own ? document.own(value, config?.notebooks ?? []) : { page: value, foreign: false };
  }
  function fail(res: import('express').Response, error: unknown) {
    res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof SourceError ? error.message : `${label} configuration could not be saved. Your draft is preserved.` });
  }
  const router = Router();
  router.get('/', async (req, res) => {
    try {
      const { id, handle, config } = await documentRepository(res, req.query.repository);
      if (handle.kind === 'local') {
        const raw = await readLocal(handle.root);
        const { page } = own(decode(raw, config), config);
        return res.json({ page, revision: revisionOf(raw), path: file, writable: await getCurrentBranch(handle.root) === 'main', repository: id });
      }
      const { reader } = handle;
      const snapshot = await reader.getSnapshot();
      const raw = await readSnapshotText(reader, snapshot, file);
      const { page } = own(decode(raw, config), config);
      res.json({ page, revision: snapshot.sha, path: file, writable: reader.canWrite(snapshot), repository: id });
    } catch (error) {
      fail(res, error);
    }
  });
  router.put('/', async (req, res) => {
    try {
      const value = document.schema.safeParse(req.body?.page);
      const revision = req.body?.revision;
      if (!value.success || typeof revision !== 'string' || !revision || Object.keys(req.body).some(key => !['page', 'revision', 'repository'].includes(key))) throw new SourceError(`Invalid ${label} configuration.`, 400);
      const yaml = serializeWorkspaceDocument(value.data);
      if (Buffer.byteLength(yaml) > maxBytes) throw new SourceError(`${label} configuration is too large.`, 413);
      const foreign = () => new SourceError(`${label} content must belong to its notebook.`, 400);
      const { id, handle, config } = await documentRepository(res, req.body.repository);
      if (handle.kind === 'local') {
        const { root } = handle;
        return await serializeWorkspaceMutation(root, async () => {
          if (await getCurrentBranch(root) !== 'main') throw new SourceError(`Switch to main to save the ${label} configuration.`, 403);
          if (own(value.data, config).foreign) throw foreign();
          const raw = await readLocal(root);
          if (revisionOf(raw) !== revision) throw new SourceError(`The ${label} configuration changed. Reload it before saving your draft.`, 409);
          await writeFileAtomic(path.join(root, file), yaml);
          res.json({ page: value.data, revision: revisionOf(yaml), path: file, writable: true, repository: id });
        });
      }
      if (!handle.authenticated) throw new SourceError(`Sign in with write access to save the ${label} configuration.`, 403);
      const { reader } = handle;
      const snapshot = await reader.getSnapshot();
      if (own(value.data, config).foreign) throw foreign();
      const saved = await reader.saveWorkspaceDocument(document, yaml, revision);
      res.json({ page: value.data, revision: saved.revision, path: file, writable: true, repository: id });
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}
