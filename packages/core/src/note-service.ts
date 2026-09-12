import fs from 'node:fs';
import path from 'node:path';
import { NotebookConfig, NoteItem, NoteMetadata } from './types.js';
import { resolveSafePath } from './path-guard.js';
import { parseNoteContent, serializeNoteContent } from './frontmatter.js';
import { isNotebookContent } from './folders.js';
import { loadWorkspaceConfig } from './config.js';

/**
 * Reads a single note file from disk safely.
 */
export function readNoteFile(
  repoRoot: string,
  relPath: string,
  notebookId: string
): NoteItem {
  const safePath = resolveSafePath(repoRoot, relPath);
  const raw = fs.readFileSync(safePath, 'utf-8');
  const stat = fs.statSync(safePath);
  const filename = path.basename(relPath);

  const { metadata, content, title } = parseNoteContent(raw, filename);

  const noteId =
    typeof metadata.id === 'string' && metadata.id.trim()
      ? metadata.id.trim()
      : path.basename(filename, path.extname(filename));

  const tags = Array.isArray(metadata.tags) ? metadata.tags.map(String) : [];
  const status = typeof metadata.status === 'string' ? metadata.status : undefined;

  return {
    id: noteId,
    path: relPath.replace(/\\/g, '/'),
    notebookId,
    title,
    status,
    tags,
    metadata,
    content,
    mtime: stat.mtimeMs,
    size: stat.size,
  };
}

/**
 * Writes or updates a note file on disk safely.
 */
export function writeNoteFile(
  repoRoot: string,
  relPath: string,
  content: string,
  metadata?: NoteMetadata,
  notebookId?: string
): NoteItem {
  const safePath = resolveSafePath(repoRoot, relPath);
  const dir = path.dirname(safePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const finalOutput = metadata
    ? serializeNoteContent(metadata, content)
    : content;

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

  return readNoteFile(repoRoot, normalizedRel, resolvedNotebookId);
}

/**
 * Lists all notes in a given notebook.
 */
export function scanNotebookNotes(
  repoRoot: string,
  notebook: NotebookConfig
): NoteItem[] {
  const safeRoot = resolveSafePath(repoRoot, notebook.root);
  if (!fs.existsSync(safeRoot)) {
    return [];
  }

  const notes: NoteItem[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relToRepo = path.relative(repoRoot, fullPath).replace(/\\/g, '/');

      const relToNb = path.relative(safeRoot, fullPath).replace(/\\/g, '/');
      if (!isNotebookContent(relToNb, notebook)) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.md', '.markdown', '.txt'].includes(ext)) {
          notes.push(readNoteFile(repoRoot, relToRepo, notebook.id));
        }
      }
    }
  }

  walk(safeRoot);
  return notes;
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
