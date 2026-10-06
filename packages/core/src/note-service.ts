import fs from 'node:fs';
import path from 'node:path';
import { NotebookConfig, NoteItem, NoteMetadata } from './types.js';
import { resolveSafePath } from './path-guard.js';
import { isNotebookContent } from './folders.js';
import { isCompilationPath } from './compilation.js';
import { NOTE_EXTENSIONS, parseNoteFile, serializeNoteFile } from './note-file.js';
import { loadWorkspaceConfig } from './config.js';

/**
 * Reads a single note or compilation file from disk safely. `notebookRoot` lets a compilation
 * report content outside its notebook as invalid.
 */
export function readNoteFile(repoRoot: string, relPath: string, notebookId: string, notebookRoot?: string): NoteItem {
  const safePath = resolveSafePath(repoRoot, relPath);
  const raw = fs.readFileSync(safePath, 'utf-8');
  const stat = fs.statSync(safePath);

  const { metadata, content, title, lineNumberOffset, extra } = parseNoteFile(raw, relPath, notebookRoot);

  const filename = path.basename(relPath);
  const noteId = typeof metadata.id === 'string' && metadata.id.trim() ? metadata.id.trim() : path.basename(filename, path.extname(filename));

  const tags = Array.isArray(metadata.tags) ? metadata.tags.map(String) : [];
  const status = typeof metadata.status === 'string' ? metadata.status : undefined;

  return { id: noteId, path: relPath.replace(/\\/g, '/'), notebookId, title, status, tags, metadata, content, lineNumberOffset, mtime: stat.mtimeMs, size: stat.size, ...extra };
}

/**
 * Writes or updates a note file on disk safely.
 */
export function writeNoteFile(repoRoot: string, relPath: string, content: string, metadata?: NoteMetadata, notebookId?: string, notebookRoot?: string): NoteItem {
  const safePath = resolveSafePath(repoRoot, relPath);
  const isNew = !fs.existsSync(safePath);
  const dir = path.dirname(safePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existingRaw = isNew ? undefined : fs.readFileSync(safePath, 'utf-8');
  const finalOutput = metadata ? serializeNoteFile(relPath, metadata, content, isNew, new Date(), existingRaw) : content;

  fs.writeFileSync(safePath, finalOutput, 'utf-8');

  const normalizedRel = path.relative(repoRoot, safePath).replace(/\\/g, '/');
  let resolvedNotebookId = notebookId;

  if (!resolvedNotebookId) {
    try {
      const config = loadWorkspaceConfig(repoRoot);
      if (config) {
        const matched = config.notebooks.find((nb) => {
          const rootRel = nb.root.replace(/\\/g, '/');
          return normalizedRel === rootRel || normalizedRel.startsWith(`${rootRel}/`);
        });
        if (matched) {
          resolvedNotebookId = matched.id;
        }
      }
    } catch {
      // fallback
    }
  }

  if (!resolvedNotebookId) {
    const parts = normalizedRel.split('/');
    resolvedNotebookId = parts.length >= 2 ? parts[1] : 'default';
  }

  return readNoteFile(repoRoot, normalizedRel, resolvedNotebookId, notebookRoot);
}

/**
 * Parsed files of each notebook scan, reused while a file's size, change times and inode are unchanged, so a
 * scan reads and parses only the files edited since the last one. A scan keeps only the files it saw.
 */
const scanCache = new Map<string, Map<string, { stamp: string; note: NoteItem; }>>();

/** A copy the caller may change without altering the cached parse; the body string is immutable and shared. */
function copyNote({ content, ...rest }: NoteItem): NoteItem {
  return { ...structuredClone(rest), content };
}

function walkNotebook(repoRoot: string, notebook: NotebookConfig, compilations: boolean): NoteItem[] {
  const safeRoot = resolveSafePath(repoRoot, notebook.root);
  const cacheKey = JSON.stringify([path.resolve(repoRoot), notebook.id, notebook.root]);
  if (!fs.existsSync(safeRoot)) {
    scanCache.delete(cacheKey);
    return [];
  }

  const templateFiles = new Set((notebook.templates || []).map(t => t.file));
  const notes: NoteItem[] = [];
  const previous = scanCache.get(cacheKey);
  const seen = new Map<string, { stamp: string; note: NoteItem; }>();

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relToRepo = path.relative(repoRoot, fullPath).replace(/\\/g, '/');

      const relToNb = path.relative(safeRoot, fullPath).replace(/\\/g, '/');
      if (!isNotebookContent(relToNb, notebook) || templateFiles.has(relToNb)) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (NOTE_EXTENSIONS.test(entry.name) || compilations && isCompilationPath(entry.name)) {
          // Stat before reading: a file changed in between carries a newer body than its stamp, so the next scan reads it again.
          const stat = fs.statSync(fullPath);
          const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
          const cached = previous?.get(relToRepo);
          const note = cached?.stamp === stamp ? cached.note : readNoteFile(repoRoot, relToRepo, notebook.id, notebook.root);
          seen.set(relToRepo, { stamp, note });
          notes.push(copyNote(note));
        }
      }
    }
  }

  walk(safeRoot);
  scanCache.set(cacheKey, seen);
  return notes;
}

/**
 * Lists all notes in a given notebook.
 */
export function scanNotebookNotes(repoRoot: string, notebook: NotebookConfig): NoteItem[] {
  return scanNotebookMarkdownNotes(repoRoot, notebook).filter(note => !note.kind);
}

/** All native Markdown note bodies, including outlines, for reference safety checks. */
export function scanNotebookMarkdownNotes(repoRoot: string, notebook: NotebookConfig): NoteItem[] {
  return walkNotebook(repoRoot, notebook, false);
}

/** Lists the notes and compilations of a notebook; the catalog tells them apart by `kind`. */
export function scanNotebookEntries(repoRoot: string, notebook: NotebookConfig): NoteItem[] {
  return walkNotebook(repoRoot, notebook, true);
}

/**
 * Deletes a note file safely.
 */
export function deleteNoteFile(repoRoot: string, relPath: string): void {
  const safePath = resolveSafePath(repoRoot, relPath);
  if (fs.existsSync(safePath)) {
    fs.unlinkSync(safePath);
  }
}
