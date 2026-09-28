import { Request, Response, Router } from 'express';
import { formatTemplateDate, loadNoteTemplate, renderNoteTemplate, scanNotebookFolders } from '@mygitnotes/core';
import { localRepository } from './request-workspace.js';

export function createLocalFoldersTemplatesRouter(): Router {
  const router = Router();

  router.get('/api/folders', async (_req, res) => {
    try {
      const { root, config } = await localRepository(res);
      res.json({ folders: config.notebooks.flatMap(nb => scanNotebookFolders(root, nb)) });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  router.get('/api/templates/render', async (req: Request, res: Response) => {
    try {
      const notebookId = req.query.notebookId as string;
      const templateId = req.query.templateId as string;
      const title = (req.query.title as string) || '';
      const { root, config } = await localRepository(res);
      const notebook = config.notebooks.find((nb) => nb.id === notebookId);
      if (!notebook) return res.status(404).json({ error: `Notebook not found: ${notebookId}` });
      const template = loadNoteTemplate(root, notebook, templateId);
      const rendered = renderNoteTemplate(template, { title, date: formatTemplateDate() });
      res.json(rendered);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
