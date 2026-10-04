import { Router } from 'express';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BookmarkError, bookmarkRepositoryPath, type BookmarkResolution, BookmarkResolveRequestSchema, type BookmarkTarget, isCompilationPath, isNotebookContent, normalizeBookmarkBody, parseCompilation, parseNoteContent, resolveTextAnchor, SourceError, validateBookmarkTargetScope } from '@mygitnotes/core';
import { notebookRepository } from './request-workspace.js';
import { readBoundedFile, regularPath } from './workspace-files.js';
import { serializeWorkspaceMutation } from './workspace-mutation.js';

const requestSchema = BookmarkResolveRequestSchema;

/** Read-only POST: mounted before local write middleware. URLs never cause a fetch. */
export function createBookmarksResolver(): Router {
  const router = Router();
  router.post('/', async (req, res) => {
    try {
      const input = requestSchema.safeParse(req.body);
      if (!input.success) throw new SourceError('Invalid bookmark resolution request.', 400);
      const { notebook, config, handle } = await notebookRepository(res, input.data.notebookId);
      for (const { target } of input.data.targets) validateBookmarkTargetScope(target, notebook, config.notebooks);
      const resolve = async () => {
        const snapshot = handle.kind === 'remote' ? await handle.reader.getSnapshot(true) : undefined;
        const kind = async (path: string): Promise<'file' | 'folder' | 'missing'> => {
          if (handle.kind === 'remote' && snapshot) {
            if (snapshot.entries.some(e => (e.path === path || path.startsWith(e.path + '/')) && e.mode === '120000')) throw new SourceError('Symlinks are protected.', 403);
            const entry = snapshot.entries.find(e => e.path === path);
            if (entry) return entry.type === 'tree' ? 'folder' : 'file';
            return snapshot.entries.some(e => e.path.startsWith(path + '/')) ? 'folder' : 'missing';
          }
          if (handle.kind !== 'local') throw new SourceError('Repository unavailable.', 503);
          const file = regularPath(handle.root, path);
          try {
            const stat = await fs.stat(file);
            return stat.isDirectory() ? 'folder' : stat.isFile() ? 'file' : 'missing';
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
            throw error;
          }
        };
        const bodies = new Map<string, Promise<string>>();
        const read = (path: string) => {
          let pending = bodies.get(path);
          if (!pending) {
            pending = handle.kind === 'remote' && snapshot ? handle.reader.readSnapshotFile(snapshot, path).then(bytes => bytes.toString('utf8')) : handle.kind === 'local'
              ? readBoundedFile(handle.root, path, 5 * 1024 * 1024, 'Note').then(raw => {
                if (raw === null) throw new SourceError('Note changed during resolution.', 409);
                return raw;
              })
              : Promise.reject(new SourceError('Repository unavailable.', 503));
            bodies.set(path, pending);
          }
          return pending;
        };
        const full = (relative: string) => bookmarkRepositoryPath(notebook, relative, config.notebooks);
        const folderExists = async (relative: string) => await kind(full(relative)) === 'folder';
        const one = async (target: BookmarkTarget): Promise<BookmarkResolution> => {
          if (target.kind === 'url') return { state: 'external', url: target.url };
          if (target.kind === 'query') {
            for (const folder of target.query.folders) if (!await folderExists(folder)) return { state: 'unresolved', reason: 'missing-query-folder' };
            return { state: 'resolved', target };
          }
          if (target.kind === 'folder') return await folderExists(target.path) ? { state: 'resolved', target } : { state: 'unresolved', reason: 'missing-folder' };
          const path = full(target.path);
          const missing = target.kind === 'compilation' ? 'missing-compilation' : 'missing-note';
          if (!isNotebookContent(target.path, notebook)) throw new SourceError('Target is not notebook content.', 403);
          if (await kind(path) !== 'file') return { state: 'unresolved', reason: missing };
          if (target.kind === 'compilation') {
            if (!isCompilationPath(path)) return { state: 'unresolved', reason: 'invalid-compilation' };
            const raw = await read(path);
            try {
              parseCompilation(raw, notebook.root);
            } catch {
              return { state: 'unresolved', reason: 'invalid-compilation' };
            }
          } else {
            if (!/\.(md|markdown|mdx|txt)$/i.test(path)) throw new SourceError('Target is not a note.', 400);
            if (target.kind === 'position') {
              const raw = await read(path);
              const body = /\.txt$/i.test(path) ? raw : parseNoteContent(raw).content;
              const result = resolveTextAnchor(body, target.anchor);
              if (result.state !== 'resolved') return result;
              return { state: 'resolved', target, range: result.range, contentRevision: createHash('sha256').update(normalizeBookmarkBody(body).text).digest('hex') };
            }
          }
          return { state: 'resolved', target };
        };
        const results: { id: string; resolution: BookmarkResolution; }[] = [];
        for (let index = 0; index < input.data.targets.length; index += 6) {
          results.push(
            ...await Promise.all(
              input.data.targets.slice(index, index + 6).map(async ({ id, target }) => {
                try {
                  return { id, resolution: await one(target) };
                } catch (error) {
                  if (error instanceof SourceError && [400, 403, 413].includes(error.status)) throw error;
                  return { id, resolution: { state: 'unavailable', retryable: true } as BookmarkResolution };
                }
              }),
            ),
          );
        }
        return { notebookId: notebook.id, repository: handle.id, revision: snapshot?.sha ?? '', results };
      };
      res.json(handle.kind === 'local' ? await serializeWorkspaceMutation(handle.root, resolve) : await resolve());
    } catch (error) {
      res.status(error instanceof BookmarkError ? 400 : error instanceof SourceError ? error.status : 503).json({ error: error instanceof Error ? error.message : 'Bookmarks unavailable.' });
    }
  });
  return router;
}
