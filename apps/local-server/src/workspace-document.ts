import { Router } from 'express';
import path from 'node:path';
import { BookmarkError, parseNoteContent, readWorkspaceDocument, serializeWorkspaceDocument, SourceError, type WorkspaceConfig, type WorkspaceDocument } from '@mygitnotes/core';
import { getCurrentBranch } from '@mygitnotes/git';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { keyedDocument, repositoryOrHome as documentRepository, storedDocument } from './request-workspace.js';
import { readBoundedFile, readSnapshotText, regularPath, revisionOf, writeFileAtomic } from './workspace-files.js';

/** Reads and writes one workspace document of one repository as `{ page, revision, path, writable, repository }`. */
export function createWorkspaceDocumentRouter(document: WorkspaceDocument): Router {
  const { file, label, maxBytes } = document;
  const readLocal = (root: string) => readBoundedFile(root, file, maxBytes, `${label} configuration`);
  function decode(raw: string | null) {
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
    const status = error instanceof BookmarkError ? error.code === 'duplicate-target' ? 409 : 400 : error instanceof SourceError ? error.status : 500;
    res.status(status).json({ error: error instanceof SourceError || error instanceof BookmarkError ? error.message : `${label} configuration could not be saved. Your draft is preserved.`, ...(error && typeof error === 'object' && 'code' in error ? { code: error.code, ...('existingId' in error ? { existingId: error.existingId } : {}) } : {}) });
  }
  const router = Router();
  router.get('/', async (req, res) => {
    try {
      const { id, alias, handle, config } = await documentRepository(res, req.query.repository);
      // The file stores local ids; the answer names notebooks by key.
      const keyed = (raw: string | null) => keyedDocument(document, alias, own(decode(raw), config).page);
      if (handle.kind === 'local') {
        const raw = await readLocal(handle.root);
        return res.json({ page: keyed(raw), revision: revisionOf(raw), path: file, writable: !document.retired && await getCurrentBranch(handle.root) === 'main', repository: id });
      }
      const { reader } = handle;
      const snapshot = await reader.getSnapshot();
      const raw = await readSnapshotText(reader, snapshot, file);
      if (raw !== null && Buffer.byteLength(raw) > maxBytes) throw new SourceError(`${label} configuration is too large.`, 413);
      res.json({ page: keyed(raw), revision: snapshot.sha, path: file, writable: !document.retired && reader.canWrite(snapshot), repository: id });
    } catch (error) {
      fail(res, error);
    }
  });
  router.put('/', async (req, res) => {
    if (document.retired) return res.status(410).json({ code: 'legacy-authoring-retired', error: 'Legacy bookmark authoring is retired. Export or import the saved source into a new outline.' });
    try {
      const value = document.schema.safeParse(req.body?.page);
      const revision = req.body?.revision;
      if (!value.success || typeof revision !== 'string' || !revision || Object.keys(req.body).some(key => !['page', 'revision', 'repository'].includes(key))) throw new SourceError(`Invalid ${label} configuration.`, 400);
      const { id, alias, handle, config } = await documentRepository(res, req.body.repository);
      // The request names notebooks by key; the file stores local ids.
      const stored = storedDocument(document, alias, value.data);
      const yaml = serializeWorkspaceDocument(stored);
      if (Buffer.byteLength(yaml) > maxBytes) throw new SourceError(`${label} configuration is too large.`, 413);
      const foreign = () => new SourceError(`${label} content must belong to its notebook.`, 400);
      if (handle.kind === 'local') {
        const { root } = handle;
        return await serializeWorkspaceMutation(root, async () => {
          if (await getCurrentBranch(root) !== 'main') throw new SourceError(`Switch to main to save the ${label} configuration.`, 403);
          if (own(stored, config).foreign) throw foreign();
          const raw = await readLocal(root);
          const current = document.validateChange ? decode(raw) : undefined;
          if (revisionOf(raw) !== revision) throw new SourceError(`The ${label} configuration changed. Reload it before saving your draft.`, 409);
          document.validateChange?.(current, stored, config?.notebooks ?? []);
          await document.validateReferences?.(current, stored, config?.notebooks ?? [], async notePath => {
            regularPath(root, notePath);
            const raw = await readBoundedFile(root, notePath, 5 * 1024 * 1024, 'Note');
            return raw === null ? null : /\.txt$/i.test(notePath) ? raw : parseNoteContent(raw).content;
          });
          await writeFileAtomic(path.join(root, file), yaml);
          res.json({ page: value.data, revision: revisionOf(yaml), path: file, writable: true, repository: id });
        });
      }
      if (!handle.authenticated) throw new SourceError(`Sign in with write access to save the ${label} configuration.`, 403);
      const { reader } = handle;
      if (own(stored, config).foreign) throw foreign();
      const saved = await reader.saveWorkspaceDocument(document, yaml, revision);
      res.json({ page: value.data, revision: saved.revision, path: file, writable: true, repository: id });
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}
