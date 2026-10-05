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
  return planRelocation(path, `${folder ? `${base}/${folder}` : base}/${baseName(path)}`, draft);
}

/** Plans putting the note at `path` at `destination`, given its remote draft if any. */
export function planRelocation(path: string, destination: string, draft: WorkingNote | undefined): NoteMovePlan {
  if (destination === path) return { kind: 'none' };
  return draft && !draft.base ? { kind: 'draft', destination, draft } : { kind: 'file', destination };
}

/** The kind suffix a renamed note keeps: `.outline.md`, `.compilation.yml`, or its plain extension. */
export function noteSuffix(path: string): string {
  return path.match(/(\.outline\.md|\.compilation\.yml|\.[^./]+)$/)?.[1] ?? '';
}

/** The file name stem for `title`: letters and digits of any script, dashes between words; empty when it has none. */
export function noteStem(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80).replace(/-$/, '');
}

/** The path of the note at `path` once renamed to `title`, in the same folder and with the same suffix. */
export function renamedPath(path: string, title: string): string {
  return `${path.slice(0, path.lastIndexOf('/') + 1)}${noteStem(title)}${noteSuffix(path)}`;
}

/**
 * The content and metadata of a note retitled `title`. A frontmatter title is rewritten where the note has one (an
 * outline always keeps its title there), and so is a first H1 that repeats the `previous` title, as a template's
 * note does. Without a frontmatter title the first H1 names the note, so it is the one rewritten; a note with
 * neither gains a frontmatter title.
 */
export function retitle(content: string, metadata: Record<string, unknown>, title: string, outline: boolean, previous?: string): { content: string; metadata: Record<string, unknown>; } {
  const heading = content.match(/^#\s+(.+)$/m);
  if (outline || !heading) return { content, metadata: { ...metadata, title } };
  const rewritten = content.replace(/^#\s+.+$/m, `# ${title}`);
  if (typeof metadata.title !== 'string') return { content: rewritten, metadata };
  return { content: heading[1].trim() === previous ? rewritten : content, metadata: { ...metadata, title } };
}
