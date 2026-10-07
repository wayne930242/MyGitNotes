import express from 'express';
import { presignR2Object, r2ReferenceKeys, SourceError } from '@mygitnotes/core';
import { type AssetStorage, inAssetScope } from './asset-storage.js';
import type { RepositoryHandle } from './request-workspace.js';

/** Reads a configured note's Markdown with the requester's workspace permission, with the repository that holds it; throws when unreadable. */
export type NoteReader = (res: express.Response, notePath: string) => Promise<{ content: string; repository: RepositoryHandle; }>;

/**
 * Redirects to a short-lived R2 URL only when the requester can read `note`, that note references the
 * requested key, and the key lies in the requester's asset scope.
 */
export function createR2AssetHandler(storage: AssetStorage, readNote: NoteReader): express.RequestHandler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const key = (req.params as Record<string, string>)[0];
    const notePath = req.query.note;
    if (!key || typeof notePath !== 'string') return res.status(404).json({ error: 'Asset not found.' });
    let note: Awaited<ReturnType<NoteReader>>;
    try {
      note = await readNote(res, notePath);
    } catch {
      return res.status(404).json({ error: 'Asset not found.' });
    }
    let scope;
    try {
      scope = await storage.resolve(req, res, note.repository);
    } catch (error) {
      if (error instanceof SourceError) return res.status(error.status).json({ error: error.message });
      throw error;
    }
    if (!scope || !inAssetScope(scope, key) || !r2ReferenceKeys(note.content).includes(key)) return res.status(404).json({ error: 'Asset not found.' });
    res.redirect(302, await presignR2Object(scope.settings, key));
  };
}
