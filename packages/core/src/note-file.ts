import { applyCompilationMetadata, compilationFields, isCompilationPath } from './compilation.js';
import { parseNoteContent, serializeNoteContent } from './frontmatter.js';
import type { NoteMetadata } from './types.js';

/** Extensions of Markdown and plain-text notes. */
export const NOTE_EXTENSIONS = /\.(md|markdown|mdx|txt)$/i;
/** A file the note pipelines read, list, save and commit: a note or a compilation. */
export const isNoteFile = (file: string) => NOTE_EXTENSIONS.test(file) || isCompilationPath(file);

export interface ParsedNoteFile {
  metadata: NoteMetadata;
  content: string;
  title: string;
  lineNumberOffset: number;
  /** Present only for a compilation, so a note's shape does not change. */
  extra: { kind?: 'compilation'; invalid?: string; };
}

/**
 * Splits a stored file into the fields the note pipelines carry. A note is Markdown with
 * frontmatter; a compilation keeps its whole YAML as content, with a bounded summary as metadata.
 * `notebookRoot` lets a compilation report content outside its notebook as invalid.
 */
export function parseNoteFile(raw: string, filePath: string, notebookRoot?: string): ParsedNoteFile {
  const name = filePath.split('/').pop() ?? filePath;
  if (!isCompilationPath(filePath)) {
    const { metadata, content, title, lineNumberOffset } = parseNoteContent(raw, name);
    return { metadata, content, title, lineNumberOffset, extra: {} };
  }
  const fields = compilationFields(raw, filePath, notebookRoot);
  return { metadata: fields.metadata, content: raw, title: fields.title, lineNumberOffset: 0, extra: { kind: 'compilation', ...(fields.invalid ? { invalid: fields.invalid } : {}) } };
}

/** The stored form of a save: a note's frontmatter and body, or a compilation's YAML carrying the caller's tags and status. */
export function serializeNoteFile(filePath: string, metadata: NoteMetadata, content: string, isNew: boolean, now: Date, existingRaw?: string): string {
  if (isCompilationPath(filePath)) return applyCompilationMetadata(content, metadata);
  return serializeNoteContent(metadata, content, isNew, now, existingRaw);
}
