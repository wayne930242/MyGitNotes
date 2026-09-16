import express from 'express';
import { presignR2Object, r2ReferenceKeys, r2SettingsFromEnv } from '@mygitnotes/core';

/** Reads a configured note's Markdown with the requester's workspace permission; throws when unreadable. */
export type NoteReader = (res: express.Response, notePath: string) => Promise<string>;

/**
 * Redirects to a short-lived R2 URL only when the requester can read `note`
 * and that note references the requested key.
 */
export function createR2AssetHandler(readNote: NoteReader): express.RequestHandler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const settings = r2SettingsFromEnv();
    const key = (req.params as Record<string, string>)[0];
    const notePath = req.query.note;
    if (!settings || !key || typeof notePath !== 'string') return res.status(404).json({ error: 'Asset not found.' });
    let content: string;
    try { content = await readNote(res, notePath); } catch { return res.status(404).json({ error: 'Asset not found.' }); }
    if (!r2ReferenceKeys(content).includes(key)) return res.status(404).json({ error: 'Asset not found.' });
    res.redirect(302, await presignR2Object(settings, key));
  };
}
