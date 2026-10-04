import { z } from 'zod';
import { BookmarkError } from './bookmark-error.js';

export const TextAnchorSchema = z.object({ version: z.literal(1), kind: z.enum(['heading', 'paragraph']), exact: z.string().min(1).max(8192), prefix: z.string().max(128), suffix: z.string().max(128), fromHint: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export type TextAnchor = z.infer<typeof TextAnchorSchema>;
export interface BookmarkRange {
  from: number;
  to: number;
}
export interface BookmarkPosition extends BookmarkRange {
  kind: TextAnchor['kind'];
  label: string;
}
export type AnchorResolution = { state: 'resolved'; range: BookmarkRange; } | { state: 'unresolved'; reason: 'missing-position' | 'ambiguous-position'; };

/** Offsets are UTF-16 source offsets; the map includes the end boundary. */
export function normalizeBookmarkBody(body: string): { text: string; offsets: number[]; } {
  const offsets: number[] = [];
  let text = '';
  for (let index = 0; index < body.length; index++) {
    offsets.push(index);
    if (body[index] === '\r' && body[index + 1] === '\n') index++;
    text += body[index];
  }
  offsets.push(body.length);
  return { text, offsets };
}
export function bookmarkOriginalRange(body: string, range: BookmarkRange): BookmarkRange {
  const { offsets } = normalizeBookmarkBody(body);
  return { from: offsets[range.from], to: offsets[range.to] };
}
export function captureTextAnchor(body: string, range: BookmarkRange, kind: TextAnchor['kind']): TextAnchor {
  const { text, offsets } = normalizeBookmarkBody(body);
  const from = offsets.indexOf(range.from), to = offsets.indexOf(range.to);
  if (from < 0 || to <= from) throw new BookmarkError('invalid-position', 'Select a nonempty source range');
  const result = TextAnchorSchema.safeParse({ version: 1, kind, exact: text.slice(from, to), prefix: text.slice(Math.max(0, from - 128), from), suffix: text.slice(to, to + 128), fromHint: from });
  if (!result.success) throw new BookmarkError('invalid-position', 'Select a passage of at most 8192 characters');
  return result.data;
}
export function resolveTextAnchor(body: string, anchor: TextAnchor): AnchorResolution {
  const { text } = normalizeBookmarkBody(body);
  const matches: number[] = [];
  for (let from = text.indexOf(anchor.exact); from >= 0; from = text.indexOf(anchor.exact, from + 1)) matches.push(from);
  if (!matches.length) return { state: 'unresolved', reason: 'missing-position' };
  const candidates = matches.length === 1 ? matches : matches.filter(from => text.slice(Math.max(0, from - anchor.prefix.length), from) === anchor.prefix && text.slice(from + anchor.exact.length, from + anchor.exact.length + anchor.suffix.length) === anchor.suffix);
  if (candidates.length !== 1) return { state: 'unresolved', reason: 'ambiguous-position' };
  return { state: 'resolved', range: bookmarkOriginalRange(body, { from: candidates[0], to: candidates[0] + anchor.exact.length }) };
}

/** Source-only candidate spans. Never searches rendered Markdown or includes fenced/indented code. */
export function listBookmarkPositions(body: string, format = 'md'): BookmarkPosition[] {
  const { text, offsets } = normalizeBookmarkBody(body);
  const lines = text.split('\n');
  const positions: BookmarkPosition[] = [];
  let offset = 0, blockStart = -1, blockEnd = -1;
  let fence: { marker: string; length: number; } | undefined;
  const plain = format === 'txt' || format === 'text';
  const add = (kind: BookmarkPosition['kind'], from: number, to: number) => {
    if (to > from) positions.push({ kind, from: offsets[from], to: offsets[to], label: text.slice(from, to) });
  };
  const flush = () => {
    if (blockStart >= 0) add('paragraph', blockStart, blockEnd);
    blockStart = -1;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const end = offset + line.length;
    const marker = !plain && line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      offset = end + 1;
      continue;
    }
    if (marker) {
      flush();
      fence = { marker: marker[1][0], length: marker[1].length };
      offset = end + 1;
      continue;
    }
    if (!line.trim() || (!plain && (/^( {4}|\t)/.test(line) || /^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)))) {
      flush();
      offset = end + 1;
      continue;
    }
    const atx = !plain && line.match(/^ {0,3}#{1,6}(?:\s+|$)/);
    const setext = !plain && index + 1 < lines.length && /^ {0,3}(=+|-+)\s*$/.test(lines[index + 1]);
    if (atx || setext) {
      flush();
      const to = setext ? end + 1 + lines[index + 1].length : end;
      add('heading', offset, to);
      if (setext) index++;
      offset = to + 1;
      continue;
    }
    if (blockStart < 0) blockStart = offset;
    blockEnd = end;
    offset = end + 1;
  }
  flush();
  return positions;
}

export function captureBookmarkSelection(body: string, range: BookmarkRange, format = 'md'): TextAnchor {
  const candidate = listBookmarkPositions(body, format).find(position => range.from >= position.from && range.to <= position.to && range.to > range.from);
  if (!candidate) throw new BookmarkError('invalid-position', 'Select text within one prose block or use the position picker');
  return captureTextAnchor(body, range, candidate.kind);
}
