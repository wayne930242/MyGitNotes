import { Request, Response, Router } from 'express';
import { formatTemplateDate, keyedItem, loadNoteTemplate, renderNoteTemplate, scanNotebookFolders, SourceError } from '@mygitnotes/core';
import { asLocal, eachRepository, notebookRepository } from './request-workspace.js';

export function createLocalFoldersTemplatesRouter(): Router {
  const router = Router();

  router.get('/api/folders', async (_req, res) => {
    try {
      res.json({ folders: (await eachRepository(res)).flatMap(({ handle, alias, config }) => config.notebooks.flatMap(nb => scanNotebookFolders(asLocal(handle).root, nb).map(keyedItem(alias)))) });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  router.get('/api/templates/render', async (req: Request, res: Response) => {
    try {
      const notebookId = req.query.notebookId as string;
      const templateId = req.query.templateId as string;
      const title = (req.query.title as string) || '';
      const { handle, notebook } = await notebookRepository(res, notebookId);
      const template = loadNoteTemplate(asLocal(handle).root, notebook, templateId);
      const rendered = renderNoteTemplate(template, { title, date: formatTemplateDate() });
      res.json(rendered);
    } catch (err: unknown) {
      res.status(err instanceof SourceError ? err.status : 400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
