/** Markdown formatting commands shared by the live and source editors: each turns a document and a selection into edits. */

export type InlineFormat = 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code';
export type LineFormat = 'heading1' | 'heading2' | 'heading3' | 'bulletList' | 'orderedList' | 'taskList' | 'quote';
export type BlockFormat = 'codeBlock' | 'link' | 'horizontalRule';
export type MarkdownFormat = InlineFormat | LineFormat | BlockFormat;

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** Edits against the original document, sorted and non-overlapping, and the selection in the edited document. */
export interface FormatResult {
  changes: TextEdit[];
  anchor: number;
  head: number;
}

const INLINE_MARKERS: Record<InlineFormat, [string, string]> = { bold: ['**', '**'], italic: ['*', '*'], underline: ['<u>', '</u>'], strikethrough: ['~~', '~~'], code: ['`', '`'] };
const LINE_FORMATS = new Set<string>(['heading1', 'heading2', 'heading3', 'bulletList', 'orderedList', 'taskList', 'quote']);

export function formatMarkdown(doc: string, from: number, to: number, format: MarkdownFormat): FormatResult {
  const start = Math.min(from, to), end = Math.max(from, to);
  if (format in INLINE_MARKERS) return toggleInline(doc, start, end, format as InlineFormat);
  if (LINE_FORMATS.has(format)) return toggleLines(doc, start, end, format as LineFormat);
  if (format === 'codeBlock') return codeBlock(doc, start, end);
  if (format === 'link') return link(doc, start, end);
  return horizontalRule(doc, end);
}

/** Bold and italic share `*`; a run's length says which of them it carries (`***` carries both). */
function starsPresent(format: 'bold' | 'italic', before: number, after: number) {
  return format === 'bold' ? before >= 2 && after >= 2 : before % 2 === 1 && after % 2 === 1;
}

function runBefore(doc: string, pos: number, char: string) {
  let count = 0;
  while (pos - count > 0 && doc[pos - count - 1] === char) count++;
  return count;
}

function runAfter(doc: string, pos: number, char: string) {
  let count = 0;
  while (pos + count < doc.length && doc[pos + count] === char) count++;
  return count;
}

function toggleInline(doc: string, from: number, to: number, format: InlineFormat): FormatResult {
  const [open, close] = INLINE_MARKERS[format];
  const stars = format === 'bold' || format === 'italic';
  const selected = doc.slice(from, to);
  // The selection includes its markers: `**word**` selected.
  const inside = stars ? selected.length >= open.length + close.length && starsPresent(format, runAfter(selected, 0, '*'), runBefore(selected, selected.length, '*')) : selected.length >= open.length + close.length && selected.startsWith(open) && selected.endsWith(close);
  if (inside) {
    const inner = selected.slice(open.length, selected.length - close.length);
    return { changes: [{ from, to, insert: inner }], anchor: from, head: from + inner.length };
  }
  // The markers surround the selection, or an empty pair surrounds the caret.
  const outside = stars ? starsPresent(format, runBefore(doc, from, '*'), runAfter(doc, to, '*')) : doc.slice(from - open.length, from) === open && doc.slice(to, to + close.length) === close;
  if (outside) {
    return { changes: [{ from: from - open.length, to: from, insert: '' }, { from: to, to: to + close.length, insert: '' }], anchor: from - open.length, head: to - open.length };
  }
  // Markers hug the text: `** word **` is not emphasis, so surrounding whitespace stays outside.
  const lead = selected.length - selected.trimStart().length;
  const trail = selected.trim() ? selected.length - selected.trimEnd().length : 0;
  const wrapFrom = from + lead, wrapTo = to - trail;
  return { changes: [{ from: wrapFrom, to: wrapFrom, insert: open }, { from: wrapTo, to: wrapTo, insert: close }], anchor: wrapFrom + open.length, head: wrapTo + open.length };
}

const HEADING = /^#{1,6}[ \t]+/;
const TASK = /^([ \t]*)[-*+][ \t]+\[[ xX]\][ \t]+/;
const BULLET = /^([ \t]*)[-*+][ \t]+/;
const ORDERED = /^([ \t]*)\d+[.)][ \t]+/;
const QUOTE = /^>[ \t]?/;

/** The list marker a line already carries, so another list kind replaces it instead of nesting. */
function listPrefix(text: string): { kind: 'taskList' | 'bulletList' | 'orderedList'; indent: string; length: number; } | null {
  for (const [kind, pattern] of [['taskList', TASK], ['bulletList', BULLET], ['orderedList', ORDERED]] as const) {
    const match = text.match(pattern);
    if (match) return { kind, indent: match[1], length: match[0].length };
  }
  return null;
}

function toggleLines(doc: string, from: number, to: number, format: LineFormat): FormatResult {
  const firstLine = doc.lastIndexOf('\n', from - 1) + 1;
  // A selection ending at the start of a line does not take that line along.
  const last = to > from && (to === 0 || doc[to - 1] === '\n') ? to - 1 : to;
  const lineStarts: number[] = [];
  for (let pos = firstLine; pos <= last;) {
    lineStarts.push(pos);
    const next = doc.indexOf('\n', pos);
    if (next === -1) break;
    pos = next + 1;
  }
  const lines = lineStarts.map(start => {
    const end = doc.indexOf('\n', start);
    return { start, text: doc.slice(start, end === -1 ? doc.length : end) };
  });
  const content = lines.filter(line => line.text.trim());
  const targets = content.length ? content : lines;
  const changes: TextEdit[] = [];

  if (format.startsWith('heading')) {
    const level = Number(format.at(-1));
    const marker = `${'#'.repeat(level)} `;
    const applied = targets.every(line => line.text.match(HEADING)?.[0].trimEnd() === '#'.repeat(level));
    for (const { start, text } of targets) {
      const existing = text.match(HEADING)?.[0].length ?? 0;
      changes.push({ from: start, to: start + existing, insert: applied ? '' : marker });
    }
  } else if (format === 'quote') {
    const applied = targets.every(line => QUOTE.test(line.text));
    for (const { start, text } of targets) changes.push(applied ? { from: start, to: start + text.match(QUOTE)![0].length, insert: '' } : { from: start, to: start, insert: '> ' });
  } else {
    const applied = targets.every(line => listPrefix(line.text)?.kind === format);
    targets.forEach(({ start, text }, index) => {
      const prefix = listPrefix(text);
      const indent = prefix?.indent ?? '';
      const marker = applied ? '' : format === 'taskList' ? '- [ ] ' : format === 'orderedList' ? `${index + 1}. ` : '- ';
      changes.push({ from: start + indent.length, to: start + (prefix?.length ?? 0), insert: marker });
    });
  }
  return { changes, anchor: mapPosition(changes, from), head: mapPosition(changes, to) };
}

/** Where `pos` lands once `changes` apply; a position inside a replaced prefix moves to its end. */
function mapPosition(changes: TextEdit[], pos: number) {
  let shift = 0;
  for (const change of changes) {
    if (pos < change.from) break;
    if (pos < change.to || (pos === change.to && change.from === change.to)) return change.from + change.insert.length + shift;
    shift += change.insert.length - (change.to - change.from);
  }
  return pos + shift;
}

/** `text` starts on a line of its own: a break is added after any text before `pos`. */
function lineBreakBefore(doc: string, pos: number) {
  return pos === 0 || doc[pos - 1] === '\n' ? '' : '\n';
}

function codeBlock(doc: string, from: number, to: number): FormatResult {
  const before = lineBreakBefore(doc, from);
  const after = to === doc.length || doc[to] === '\n' ? '' : '\n';
  const body = doc.slice(from, to).replace(/\n$/, '');
  const insert = `${before}\`\`\`\n${body}\n\`\`\`${after}`;
  const bodyStart = from + before.length + 4;
  return { changes: [{ from, to, insert }], anchor: bodyStart, head: bodyStart + body.length };
}

function link(doc: string, from: number, to: number): FormatResult {
  const text = doc.slice(from, to);
  const insert = `[${text}]()`;
  // With text, the caret waits for the URL; without, it waits for the text.
  const caret = text ? from + text.length + 3 : from + 1;
  return { changes: [{ from, to, insert }], anchor: caret, head: caret };
}

function horizontalRule(doc: string, pos: number): FormatResult {
  const lineEnd = doc.indexOf('\n', pos);
  const at = lineEnd === -1 ? doc.length : lineEnd;
  const lineStart = doc.lastIndexOf('\n', at - 1) + 1;
  const previousStart = lineStart === 0 ? 0 : doc.lastIndexOf('\n', lineStart - 2) + 1;
  // A rule right below text would turn that text into a setext heading, so a blank line separates them.
  const textAbove = doc.slice(lineStart, at).trim() ? true : lineStart > 0 && Boolean(doc.slice(previousStart, lineStart - 1).trim());
  const insert = (doc.slice(lineStart, at).trim() ? '\n\n' : textAbove ? '\n' : '') + '---' + (at === doc.length ? '\n' : '');
  const insertAt = doc.slice(lineStart, at).trim() ? at : lineStart;
  const caret = insertAt + insert.length;
  return { changes: [{ from: insertAt, to: at, insert }], anchor: caret, head: caret };
}

/** The document after `result.changes` apply. */
export function applyEdits(doc: string, changes: TextEdit[]): string {
  let output = '', pos = 0;
  for (const change of changes) {
    output += doc.slice(pos, change.from) + change.insert;
    pos = change.to;
  }
  return output + doc.slice(pos);
}
