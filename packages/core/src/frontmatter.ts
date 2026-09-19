import YAML from 'yaml';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { NoteMetadata } from './types.js';
import { stampSaveTimestamps } from './note-timestamps.js';

export interface ParsedNote {
  metadata: NoteMetadata;
  content: string;
  title: string;
  hasFrontmatter: boolean;
  /** Number added to body-relative line numbers to reach the same line in the saved file. */
  lineNumberOffset: number;
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

  return { metadata, content, title, hasFrontmatter, lineNumberOffset: hasFrontmatter && match ? (match[0].match(/\n/g) || []).length : 0 };
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
 * Sets, replaces or removes one frontmatter key in place: the key's own quoting, flow/block
 * style and surrounding comments are kept, and every other key and the Markdown body are left
 * untouched. `value === undefined` removes the key. Mirrors `replaceNoteStatus`/`replaceNoteTags`,
 * generalized to an arbitrary key so a multi-key metadata patch can apply them one at a time.
 */
function patchFrontmatterField(raw: string, key: string, value: unknown): string {
  const match = raw.match(FRONTMATTER_REGEX);
  if (!match) return raw;
  const yaml = match[1];
  const document = YAML.parseDocument(yaml);
  if (!YAML.isMap(document.contents)) return raw;
  const map = document.contents;
  const index = map.items.findIndex(item => YAML.isScalar(item.key) && item.key.value === key);
  const pair = map.items[index];
  const newline = match[0].includes('\r\n') ? '\r\n' : '\n';
  const offset = raw.indexOf('\n') + 1;
  const patch = (start: number, end: number, text: string) => raw.slice(0, offset + start) + text + raw.slice(offset + end);

  if (value === undefined) {
    if (!pair) return raw;
    let start = (pair.key as YAML.Node).range![0];
    let end = (pair.value as YAML.Node).range![2];
    if (map.flow) {
      end = (pair.value as YAML.Node).range![1];
      if (index < map.items.length - 1) end = (map.items[index + 1].key as YAML.Node).range![0];
      else if (index > 0) start = yaml.lastIndexOf(',', start);
    } else {
      start = yaml.lastIndexOf('\n', start - 1) + 1;
      // The extracted YAML omits the newline before the closing delimiter.
      if (end === yaml.length) end += newline.length;
    }
    return patch(start, end, !map.flow && map.items.length === 1 ? `{}${newline}` : '');
  }

  const isCollection = value !== null && typeof value === 'object';

  if (!pair) {
    let insertedValue: unknown = value;
    if (!isCollection) {
      const node = new YAML.Scalar(value);
      if (typeof value === 'string' && (key === 'created' || key === 'updated')) node.type = 'QUOTE_DOUBLE';
      insertedValue = node;
    }
    const newDocument = new YAML.Document({ [key]: insertedValue });
    if (isCollection && map.flow) {
      const newNode = newDocument.get(key, true);
      if (YAML.isSeq(newNode) || YAML.isMap(newNode)) newNode.flow = true;
    }
    const rendered = newDocument.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
    if (map.flow) {
      const end = yaml.lastIndexOf('}');
      return patch(end, end, `${map.items.length ? ', ' : ''}${rendered}`);
    }
    return patch(yaml.length, yaml.length, `${newline}${rendered}`);
  }

  const oldValue = pair.value as YAML.Node;

  if (isCollection || YAML.isSeq(oldValue) || YAML.isMap(oldValue)) {
    const flow = (YAML.isSeq(oldValue) || YAML.isMap(oldValue)) ? oldValue.flow === true : false;
    const newDocument = new YAML.Document({ [key]: value });
    if (flow) {
      const newNode = newDocument.get(key, true);
      if (YAML.isSeq(newNode) || YAML.isMap(newNode)) newNode.flow = true;
    }
    const rendered = newDocument.toString({ lineWidth: 0, flowCollectionPadding: false });
    const withoutKey = rendered.slice(key.length);
    const [vStart, vEnd] = oldValue.range!;
    const hadTrailingNewline = yaml.slice(vStart, vEnd).endsWith('\n');
    let replacement = !hadTrailingNewline && withoutKey.endsWith('\n') ? withoutKey.slice(0, -1) : withoutKey;
    if (match[0].includes('\r\n')) replacement = replacement.replace(/\n/g, '\r\n');
    return patch((pair.key as YAML.Node).range![1], vEnd, replacement);
  }

  const [start, end] = oldValue.range!;
  const trailingNewline = yaml.slice(start, end).endsWith('\n') ? newline : '';
  const spacing = start === end && !/\s/.test(yaml[start - 1]) ? ' ' : '';
  const node = new YAML.Scalar(value);
  if (YAML.isScalar(oldValue) && ['QUOTE_SINGLE', 'QUOTE_DOUBLE'].includes(oldValue.type || '')) node.type = oldValue.type;
  const rendered = new YAML.Document(node).toString({ lineWidth: 0 }).trimEnd();
  return patch(start, end, spacing + rendered + trailingNewline);
}

/**
 * Patches an existing frontmatter block onto `metadata`: a key whose value is unchanged keeps
 * its original quoting, flow/block style, position and comments; a changed or new key is
 * written in place or appended; a key no longer present is removed. Returns `null` when `raw`
 * has no parsable frontmatter map, so the caller falls back to a full render.
 */
function patchNoteMetadata(raw: string, metadata: NoteMetadata): string | null {
  const { metadata: oldMetadata, hasFrontmatter } = parseNoteContent(raw);
  if (!hasFrontmatter) return null;
  let next = raw;
  for (const key of Object.keys(oldMetadata)) {
    if (!(key in metadata)) next = patchFrontmatterField(next, key, undefined);
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!isDeepStrictEqual(oldMetadata[key], value)) next = patchFrontmatterField(next, key, value);
  }
  return next;
}

/**
 * Serializes metadata and Markdown body back into file format.
 * Preserves all unknown frontmatter keys. Stamps `created`/`updated`
 * (see `stampSaveTimestamps`) on every save; `isNew` must reflect whether
 * this note existed before this save, so an edit to a pre-existing note
 * that predates this feature never invents a `created` date.
 *
 * When `existingRaw` is the note's current file content and its Markdown body is unchanged,
 * the frontmatter is patched key by key onto that existing block instead of being rendered
 * from scratch, so a metadata-only edit (e.g. a status change) changes only the lines of the
 * keys it actually edits.
 */
export function serializeNoteContent(metadata: NoteMetadata, content: string, isNew: boolean, now: Date = new Date(), existingRaw?: string): string {
  const stamped = stampSaveTimestamps(metadata, isNew, now);
  const keys = Object.keys(stamped);
  const trimmedContent = content.trim();

  if (existingRaw !== undefined) {
    const existing = parseNoteContent(existingRaw);
    if (existing.hasFrontmatter && existing.content === content) {
      const patched = patchNoteMetadata(existingRaw, stamped);
      if (patched !== null) return patched;
    }
  }

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
    const yaml = match[1];
    const document = YAML.parseDocument(yaml);
    if (!YAML.isMap(document.contents)) return raw;
    const map = document.contents;
    const index = map.items.findIndex(pair => YAML.isScalar(pair.key) && pair.key.value === 'status');
    const pair = map.items[index];
    if (!pair && status === null || pair && document.get('status') === status) return raw;
    const newline = match[0].includes('\r\n') ? '\r\n' : '\n';
    const offset = raw.indexOf('\n') + 1;
    const patch = (start: number, end: number, text: string) => raw.slice(0, offset + start) + text + raw.slice(offset + end);
    const node = new YAML.Scalar(status);
    if (YAML.isScalar(pair?.value) && ['QUOTE_SINGLE', 'QUOTE_DOUBLE'].includes(pair.value.type || '')) node.type = pair.value.type;
    const rendered = new YAML.Document(node).toString({ lineWidth: 0 }).trimEnd();
    if (!pair) {
      if (map.flow) {
        const end = yaml.lastIndexOf('}');
        return patch(end, end, `${map.items.length ? ', ' : ''}status: ${rendered}`);
      }
      return patch(yaml.length, yaml.length, `${newline}status: ${rendered}`);
    }
    const key = pair.key as YAML.Scalar;
    const value = pair.value as YAML.Node;
    if (status !== null) {
      const [start, end] = value.range!;
      const trailingNewline = yaml.slice(start, end).endsWith('\n') ? newline : '';
      const spacing = start === end && !/\s/.test(yaml[start - 1]) ? ' ' : '';
      return patch(start, end, spacing + rendered + trailingNewline);
    }
    let start = key.range![0], end = value.range![2];
    if (map.flow) {
      end = value.range![1];
      if (index < map.items.length - 1) end = (map.items[index + 1].key as YAML.Node).range![0];
      else if (index > 0) start = yaml.lastIndexOf(',', start);
    } else {
      start = yaml.lastIndexOf('\n', start - 1) + 1;
      // The extracted YAML omits the newline before the closing delimiter.
      if (end === yaml.length) end += newline.length;
    }
    return patch(start, end, !map.flow && map.items.length === 1 ? `{}${newline}` : '');
  }
  return status === null ? raw : `---\n${YAML.stringify({ status })}---\n${raw}`;
}

/**
 * Patch only the `tags` array; keep every other frontmatter field, the field's own flow/block
 * style, and the Markdown body byte-identical. The note is expected to already have a `tags`
 * key (callers only invoke this on notes already known to carry the tag being changed).
 */
export function replaceNoteTags(raw: string, tags: string[]): string {
  const match = raw.match(FRONTMATTER_REGEX);
  if (!match || !parseNoteContent(raw).hasFrontmatter) return raw;
  const yamlText = match[1];
  const document = YAML.parseDocument(yamlText);
  if (!YAML.isMap(document.contents)) return raw;
  const map = document.contents;
  const pair = map.items.find(item => YAML.isScalar(item.key) && item.key.value === 'tags');
  if (!pair || !YAML.isNode(pair.value) || !pair.value.range || !pair.key.range) return raw;

  const flow = YAML.isSeq(pair.value) ? pair.value.flow === true : false;
  const newDocument = new YAML.Document({ tags });
  if (flow && tags.length > 0) {
    const seqNode = newDocument.get('tags', true);
    if (YAML.isSeq(seqNode)) seqNode.flow = true;
  }
  const rendered = newDocument.toString({ lineWidth: 0, flowCollectionPadding: false });
  const withoutKey = rendered.slice('tags'.length);
  const hadTrailingNewline = yamlText.slice(pair.value.range[0], pair.value.range[1]).endsWith('\n');
  let replacement = !hadTrailingNewline && withoutKey.endsWith('\n') ? withoutKey.slice(0, -1) : withoutKey;
  if (match[0].includes('\r\n')) replacement = replacement.replace(/\n/g, '\r\n');

  const offset = raw.indexOf('\n') + 1;
  const start = offset + pair.key.range[1];
  const end = offset + pair.value.range[1];
  return raw.slice(0, start) + replacement + raw.slice(end);
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

export function fillMissingNoteTimestamps(raw: string, created: string | undefined, updated: string | undefined): { raw: string; changed: boolean; } {
  const match = raw.match(FRONTMATTER_REGEX);
  if (match && parseNoteContent(raw).hasFrontmatter) {
    const document = YAML.parseDocument(match[1]);
    const lines: string[] = [];
    if (!document.get('created') && created) lines.push(`created: ${JSON.stringify(created)}`);
    if (!document.get('updated') && updated) lines.push(`updated: ${JSON.stringify(updated)}`);
    if (lines.length === 0) return { raw, changed: false };
    // Append raw lines instead of re-serializing, so existing YAML keeps its original formatting.
    const newline = match[0].includes('\r\n') ? '\r\n' : '\n';
    const insertAt = `---${newline}`.length + match[1].length;
    return { raw: `${raw.slice(0, insertAt)}${lines.map(line => `${newline}${line}`).join('')}${raw.slice(insertAt)}`, changed: true };
  }

  const fields: [string, string][] = [];
  if (created) fields.push(['created', created]);
  if (updated) fields.push(['updated', updated]);
  if (fields.length === 0) return { raw, changed: false };
  const document = new YAML.Document({});
  for (const [key, value] of fields) setQuoted(document, key, value);
  return { raw: `---\n${document.toString()}---\n${raw}`, changed: true };
}
