import { lookupNotes } from './notes-api.js';

/** How many candidate names are checked against the server at once. */
const NAMES = 20;

/**
 * The first path `pick` offers that no note holds. `pick` is called with a `taken` test and returns the
 * path it settles on, so one lookup answers up to {@link NAMES} candidates; a name taken beyond them fails.
 */
export async function firstFreePath(notebookId: string, pick: (taken: (path: string) => boolean) => string): Promise<string> {
  const tried: string[] = [];
  pick(path => {
    tried.push(path);
    return tried.length < NAMES;
  });
  const existing = new Set((await lookupNotes(tried.map(path => ({ notebookId, path })))).notes.map(note => note.path));
  return pick(path => {
    if (!tried.includes(path)) throw new Error('Too many compilations share this name. Choose another one.');
    return existing.has(path);
  });
}
