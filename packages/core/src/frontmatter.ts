import YAML from 'yaml';
import path from 'node:path';
import { NoteMetadata } from './types.js';
import { stampSaveTimestamps } from './note-timestamps.js';

export interface ParsedNote {
  metadata: NoteMetadata;
  content: string;
  title: string;
  hasFrontmatter: boolean;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Extracts the first H1 heading from Markdown content.
 */
export function extractFirstH1(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Parses note file content, extracting optional YAML frontmatter and determining the title.
 */
export function parseNoteContent(rawContent: string, fallbackFilename?: string): ParsedNote {
  const match = rawContent.match(FRONTMATTER_REGEX);

  let metadata: NoteMetadata = {};
  let content = rawContent;
  let hasFrontmatter = false;

  if (match) {
    const rawYaml = match[1];
    try {
      const parsed = YAML.parse(rawYaml);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as NoteMetadata;
        hasFrontmatter = true;
        content = rawContent.slice(match[0].length);
      }
    } catch {
      // If frontmatter YAML is malformed, treat entire file as plain content
      metadata = {};
      hasFrontmatter = false;
      content = rawContent;
    }
  }

  // Derive title fallback
  let title = '';
  if (typeof metadata.title === 'string' && metadata.title.trim()) {
    title = metadata.title.trim();
  } else {
    const firstH1 = extractFirstH1(content);
    if (firstH1) {
      title = firstH1;
    } else if (fallbackFilename) {
      const ext = path.extname(fallbackFilename);
      title = path.basename(fallbackFilename, ext);
    } else {
      title = 'Untitled';
    }
  }

  // Normalize tags
  if (metadata.tags && Array.isArray(metadata.tags)) {
    metadata.tags = metadata.tags.map(String);
  }

  return {
    metadata,
    content,
    title,
    hasFrontmatter,
  };
}

/** Forces a document's `created`/`updated` scalars to render double-quoted, matching existing note style. */
function quoteTimestampScalars(document: YAML.Document): void {
  for (const key of ['created', 'updated']) {
    if (typeof document.get(key) !== 'string') continue;
    const node = document.get(key, true);
    if (node instanceof YAML.Scalar) node.type = 'QUOTE_DOUBLE';
  }
}

function stringifyMetadata(metadata: NoteMetadata): string {
  const doc = new YAML.Document(metadata);
  quoteTimestampScalars(doc);
  return doc.toString();
}

/**
 * Serializes metadata and Markdown body back into file format.
 * Preserves all unknown frontmatter keys. Stamps `created`/`updated`
 * (see `stampSaveTimestamps`) on every save; `isNew` must reflect whether
 * this note existed before this save, so an edit to a pre-existing note
 * that predates this feature never invents a `created` date.
 */
export function serializeNoteContent(metadata: NoteMetadata, content: string, isNew: boolean, now: Date = new Date()): string {
  const stamped = stampSaveTimestamps(metadata, isNew, now);
  const keys = Object.keys(stamped);
  const trimmedContent = content.trim();

  if (keys.length === 0) {
    return trimmedContent ? `${trimmedContent}\n` : '';
  }

  const yamlStr = stringifyMetadata(stamped).trim();
  if (!trimmedContent) {
    return `---\n${yamlStr}\n---\n`;
  }

  return `---\n${yamlStr}\n---\n\n${trimmedContent}\n`;
}

/** Patch only status; keep the Markdown body and other YAML fields intact. */
export function replaceNoteStatus(raw: string, status: string | null): string {
  const match = raw.match(FRONTMATTER_REGEX);
  if (match && parseNoteContent(raw).hasFrontmatter) {
    const document = YAML.parseDocument(match[1]);
    if (status === null) document.delete('status'); else document.set('status', status);
    const newline = match[0].includes('\r\n') ? '\r\n' : '\n';
    return `---${newline}${document.toString().replace(/\n/g, newline)}---${newline}${raw.slice(match[0].length)}`;
  }
  return status === null ? raw : `---\n${YAML.stringify({ status })}---\n${raw}`;
}

/**
 * Fills `created`/`updated` only where missing, from the given fallbacks.
 * Never overwrites an existing value or touches any other frontmatter key
 * or the Markdown body. Used by the one-time backfill command.
 */
function setQuoted(document: YAML.Document, key: string, value: string): void {
  const node = document.createNode(value) as YAML.Scalar;
  node.type = 'QUOTE_DOUBLE';
  document.set(key, node);
}

export function fillMissingNoteTimestamps(
  raw: string,
  created: string | undefined,
  updated: string | undefined
): { raw: string; changed: boolean } {
  const match = raw.match(FRONTMATTER_REGEX);
  if (match && parseNoteContent(raw).hasFrontmatter) {
    const document = YAML.parseDocument(match[1]);
    let changed = false;
    if (!document.get('created') && created) { setQuoted(document, 'created', created); changed = true; }
    if (!document.get('updated') && updated) { setQuoted(document, 'updated', updated); changed = true; }
    if (!changed) return { raw, changed: false };
    const newline = match[0].includes('\r\n') ? '\r\n' : '\n';
    return { raw: `---${newline}${document.toString().replace(/\n/g, newline)}---${newline}${raw.slice(match[0].length)}`, changed: true };
  }

  const fields: [string, string][] = [];
  if (created) fields.push(['created', created]);
  if (updated) fields.push(['updated', updated]);
  if (fields.length === 0) return { raw, changed: false };
  const document = new YAML.Document({});
  for (const [key, value] of fields) setQuoted(document, key, value);
  return { raw: `---\n${document.toString()}---\n${raw}`, changed: true };
}
