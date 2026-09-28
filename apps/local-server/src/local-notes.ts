import { Request, Response, Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { classifyResource, deleteNoteFile, lookupNotes, noteAgenda, type NoteCatalog, noteFacets, noteGraph, type NoteItem, parseNoteQuery, queryNotePaths, queryNotes, readNoteFile, resolveSafePath, scanNotebookNotes, SourceError, type WorkspaceConfig, writeNoteFile } from '@mygitnotes/core';
import { changeFile, generateCommitMessage, listChanges, stageAndCommit } from '@mygitnotes/git';
import { localHome, localRepository } from './request-workspace.js';

export function createLocalNotesRouter(): Router {
  const router = Router();

  /** Per-request read model over the working tree; local reads are not cached. */
  function localCatalog(repoRoot: string, workspace: WorkspaceConfig): NoteCatalog {
    const scans = new Map<string, NoteItem[]>();
    const scan = (notebook: Parameters<typeof scanNotebookNotes>[1]) => {
      let notes = scans.get(notebook.id);
      if (!notes) {
        notes = scanNotebookNotes(repoRoot, notebook);
        scans.set(notebook.id, notes);
      }
      return notes;
    };
    return { revision: async () => '', config: async () => workspace, index: async notebook => scan(notebook).map(({ content: _content, ...note }) => note), contents: async notes => new Map(notes.map(note => [note.path, scans.get(note.notebookId)?.find(item => item.path === note.path)?.content ?? ''])), memo: (_kind, _notebooks, compute) => compute() };
  }

  async function catalogOf(res: Response) {
    const { root, config } = await localRepository(res);
    return localCatalog(root, config);
  }

  function queryError(res: Response, error: unknown) {
    res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof Error ? error.message : String(error) });
  }

  router.get('/query', async (req: Request, res: Response) => {
    try {
      const { query, options } = parseNoteQuery(req.query);
      const catalog = await catalogOf(res);
      res.json(options.select ? await queryNotePaths(catalog, query) : await queryNotes(catalog, query, options));
    } catch (error) {
      queryError(res, error);
    }
  });
  router.get('/facets', async (req: Request, res: Response) => {
    try {
      res.json(await noteFacets(await catalogOf(res), req.query.showHidden === '1'));
    } catch (error) {
      queryError(res, error);
    }
  });
  router.post('/lookup', async (req: Request, res: Response) => {
    try {
      res.json(await lookupNotes(await catalogOf(res), req.body?.paths, req.body?.content === true));
    } catch (error) {
      queryError(res, error);
    }
  });
  router.get('/agenda', async (req: Request, res: Response) => {
    try {
      if (typeof req.query.notebookId !== 'string' || !req.query.notebookId) throw new SourceError('notebookId is required.');
      res.json(await noteAgenda(await catalogOf(res), req.query.notebookId, req.query.showHidden === '1'));
    } catch (error) {
      queryError(res, error);
    }
  });
  router.get('/graph', async (_req: Request, res: Response) => {
    try {
      res.json(await noteGraph(await catalogOf(res)));
    } catch (error) {
      queryError(res, error);
    }
  });

  router.get('/', async (req: Request, res: Response) => {
    try {
      const { root: repoRoot, config } = await localRepository(res);

      const notebookId = req.query.notebookId as string | undefined;
      const notebooks = notebookId ? config.notebooks.filter((nb) => nb.id === notebookId) : config.notebooks;

      const allNotes = [];
      for (const nb of notebooks) {
        allNotes.push(...scanNotebookNotes(repoRoot, nb));
      }

      res.json({ notes: allNotes });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Read single note
  router.get('/read', async (req: Request, res: Response) => {
    try {
      const relPath = req.query.path as string;
      if (!relPath) {
        return res.status(400).json({ error: 'path query parameter is required' });
      }
      const { root: repoRoot, config } = await localRepository(res);
      const notebookId = (req.query.notebookId as string) || classifyResource(relPath, config).notebookId || 'default';
      const note = readNoteFile(repoRoot, relPath, notebookId);
      res.json({ note });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return res.status(404).json({ error: 'Note not found.' });
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Save note & create commit
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { path: notePath, content, metadata, commitMessage, notebookId } = req.body;
      if (!notePath || typeof content !== 'string') {
        return res.status(400).json({ error: 'path and content are required' });
      }
      const { root: repoRoot } = localHome(res);

      if (req.body.createOnly && fs.existsSync(resolveSafePath(repoRoot, notePath))) return res.status(409).json({ error: 'A note already exists at this path.' });
      const saved = writeNoteFile(repoRoot, notePath, content, metadata, notebookId);

      // If noCommit is requested or commit is false, write file and leave working tree dirty
      if (req.body.noCommit === true || req.body.commit === false) {
        return res.json({ success: true, note: saved, committed: false });
      }

      // Commit change
      let message = commitMessage;
      if (!message) {
        message = await generateCommitMessage({ filePath: notePath, diff: content });
      }

      const commit = await stageAndCommit(repoRoot, [notePath], message);
      res.json({ success: true, note: saved, commit, committed: true });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Delete note & create commit (or leave uncommitted if noCommit is true)
  router.delete('/', async (req: Request, res: Response) => {
    try {
      const notePath = req.query.path as string;
      const noCommit = req.query.noCommit === 'true' || req.body?.noCommit === true;
      if (!notePath) {
        return res.status(400).json({ error: 'path is required' });
      }
      const { root: repoRoot } = localHome(res);

      deleteNoteFile(repoRoot, notePath);
      if (noCommit) {
        return res.json({ success: true, committed: false });
      }

      const commit = await stageAndCommit(repoRoot, [notePath], `docs(notes): delete ${path.basename(notePath)}`);
      res.json({ success: true, commit, committed: true });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Restore note before commit
  router.post('/restore', async (req: Request, res: Response) => {
    try {
      const { path: notePath, content, metadata, notebookId } = req.body;
      if (!notePath) {
        return res.status(400).json({ error: 'path is required' });
      }
      const { root: repoRoot, config } = await localRepository(res);

      if (typeof content === 'string') {
        const restored = writeNoteFile(repoRoot, notePath, content, metadata, notebookId);
        return res.json({ success: true, note: restored });
      }

      const change = (await listChanges(repoRoot)).find(file => file.path === notePath);
      if (!change) return res.status(409).json({ error: 'This note has no changes to restore.' });
      const restored = await changeFile(repoRoot, notePath, 'restore', req.body.revision || change.revision);
      if (!change.tracked) return res.json({ success: true, note: null, ...restored });
      let resolvedNb = notebookId;
      if (!resolvedNb) {
        const matched = config.notebooks.find((nb) => {
          const rootRel = nb.root.replace(/\\/g, '/');
          return notePath === rootRel || notePath.startsWith(`${rootRel}/`);
        });
        if (matched) resolvedNb = matched.id;
      }
      const restoredNote = readNoteFile(repoRoot, notePath, resolvedNb || 'default');
      res.json({ success: true, note: restoredNote });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
