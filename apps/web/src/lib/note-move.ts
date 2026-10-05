import { baseName } from './paths.js';
import type { WorkingNote } from './working-notes.js';

/** How a note reaches another folder of its notebook. */
export type NoteMovePlan =
  | { kind: 'none'; }
  /** A remote note that was never committed exists only as a browser draft, which moves under its new path. */
  | { kind: 'draft'; destination: string; draft: WorkingNote; }
  /** Any other note moves as a file, which also relocates the links, Focus tabs and bookmarks that name it. */
  | { kind: 'file'; destination: string; };

/** The folder of `path` relative to the notebook `root`, or null at the root itself. */
export function noteFolder(path: string, root: string): string | null {
  const parent = path.slice(0, path.lastIndexOf('/'));
  const base = root.replace(/\/$/, '');
  return parent === base ? null : parent.slice(base.length + 1);
}

/** Plans moving the note at `path` into `folder` (relative to `root`, null for the root), given its remote draft if any. */
export function planNoteMove(path: string, root: string, folder: string | null, draft: WorkingNote | undefined): NoteMovePlan {
  const base = root.replace(/\/$/, '');
  const destination = `${folder ? `${base}/${folder}` : base}/${baseName(path)}`;
  if (destination === path) return { kind: 'none' };
  return draft && !draft.base ? { kind: 'draft', destination, draft } : { kind: 'file', destination };
}
