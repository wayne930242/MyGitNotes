import { Request, Response, Router } from 'express';
import { formatTemplateDate, loadNoteTemplate, loadWorkspaceConfig, renderNoteTemplate, scanNotebookFolders } from '@mygitnotes/core';

export function createLocalFoldersTemplatesRouter(repoRoot: string): Router {
  const router = Router();

  router.get('/api/folders', (req, res) => {
    try {
      const config = loadWorkspaceConfig(repoRoot);
      res.json({ folders: config?.notebooks.flatMap(nb => scanNotebookFolders(repoRoot, nb)) || [] });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  router.get('/api/templates/render', (req: Request, res: Response) => {
    try {
      const notebookId = req.query.notebookId as string;
      const templateId = req.query.templateId as string;
      const title = (req.query.title as string) || '';
      const config = loadWorkspaceConfig(repoRoot);
      const notebook = config?.notebooks.find((nb) => nb.id === notebookId);
      if (!notebook) return res.status(404).json({ error: `Notebook not found: ${notebookId}` });
      const template = loadNoteTemplate(repoRoot, notebook, templateId);
      const rendered = renderNoteTemplate(template, { title, date: formatTemplateDate() });
      res.json(rendered);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
