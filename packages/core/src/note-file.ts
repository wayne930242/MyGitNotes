import { applyCompilationMetadata, compilationFields, isCompilationPath, replaceCompilationTags } from './compilation.js';
import { parseNoteContent, replaceNoteTags, serializeNoteContent } from './frontmatter.js';
import { isOutlinePath, OUTLINE_SUFFIX } from './outline.js';
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
  /** Specialized kind, leaving an ordinary note's shape unchanged. */
  extra: { kind?: 'compilation' | 'outline'; invalid?: string; };
}

/**
 * Splits a stored file into the fields the note pipelines carry. A note is Markdown with
 * frontmatter; a compilation keeps its whole YAML as content, with a bounded summary as metadata.
 * `notebookRoot` lets a compilation report content outside its notebook as invalid.
 */
export function parseNoteFile(raw: string, filePath: string, notebookRoot?: string): ParsedNoteFile {
  const name = filePath.split('/').pop() ?? filePath;
  if (!isCompilationPath(filePath)) {
    const outline = isOutlinePath(filePath);
    const fallback = outline ? name.slice(0, -OUTLINE_SUFFIX.length) + '.md' : name;
    const { metadata, content, title, lineNumberOffset } = parseNoteContent(raw, fallback);
    return { metadata, content, title, lineNumberOffset, extra: outline ? { kind: 'outline' } : {} };
  }
  const fields = compilationFields(raw, filePath, notebookRoot);
  return { metadata: fields.metadata, content: raw, title: fields.title, lineNumberOffset: 0, extra: { kind: 'compilation', ...(fields.invalid ? { invalid: fields.invalid } : {}) } };
}

/** The stored form of a save: a note's frontmatter and body, or a compilation's YAML carrying the caller's tags and status. */
export function serializeNoteFile(filePath: string, metadata: NoteMetadata, content: string, isNew: boolean, now: Date, existingRaw?: string): string {
  if (isCompilationPath(filePath)) return applyCompilationMetadata(content, metadata);
  return serializeNoteContent(metadata, content, isNew, now, existingRaw, isOutlinePath(filePath));
}

/**
 * The metadata a save that names only some frontmatter keys writes over an existing note: its current frontmatter with
 * the given keys replaced, so keys the caller left out are kept. A new note, a note without frontmatter and a compilation,
 * whose content carries its own fields, take the given metadata as it is.
 */
export function keptNoteMetadata(filePath: string, existingRaw: string | undefined, given: NoteMetadata | undefined): NoteMetadata | undefined {
  if (existingRaw === undefined || isCompilationPath(filePath)) return given;
  const { metadata } = parseNoteFile(existingRaw, filePath);
  return Object.keys(metadata).length ? { ...metadata, ...given } : given;
}

/** Replaces only the tags of a stored file: a compilation's `tags` key, or a note's frontmatter `tags`; every other field stays as it is. */
export function replaceFileTags(raw: string, filePath: string, tags: string[]): string {
  if (!isCompilationPath(filePath)) return replaceNoteTags(raw, tags);
  return replaceCompilationTags(raw, tags);
}
