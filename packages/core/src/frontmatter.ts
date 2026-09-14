import YAML from 'yaml';
import path from 'node:path';
import { NoteMetadata } from './types.js';

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

/**
 * Serializes metadata and Markdown body back into file format.
 * Preserves all unknown frontmatter keys.
 */
export function serializeNoteContent(metadata: NoteMetadata, content: string): string {
  const keys = Object.keys(metadata);
  const trimmedContent = content.trim();

  if (keys.length === 0) {
    return trimmedContent ? `${trimmedContent}\n` : '';
  }

  const yamlStr = YAML.stringify(metadata).trim();
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
