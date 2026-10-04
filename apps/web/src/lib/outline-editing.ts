import { parser } from '@lezer/markdown';
import { applyEdits, type FormatResult, type TextEdit } from './markdown-format.js';

export type OutlineCommand = 'sibling' | 'annotation' | 'indent' | 'outdent';
export type OutlineDrop = 'before' | 'after' | 'child';

/** Transient source ranges, never a second editable document model. */
export interface OutlineItem {
  from: number;
  to: number;
  marker: number;
  content: number;
  indent: number;
  contentIndent: number;
  parent: number | null;
  list: number;
  prefix: string;
}

const lineStart = (source: string, at: number) => source.lastIndexOf('\n', Math.max(0, at) - 1) + 1;
const lineEnd = (source: string, at: number) => {
  const end = source.indexOf('\n', at);
  const to = end < 0 ? source.length : end;
  return source[to - 1] === '\r' ? to - 1 : to;
};
const newline = (source: string) => source.includes('\r\n') ? '\r\n' : '\n';
const afterLine = (source: string, at: number) => {
  const end = source.indexOf('\n', at);
  return end < 0 ? source.length : end + 1;
};

/** Only real Markdown list items qualify; fences, indented code and escaped bullets never do. */
export function outlineItems(source: string): OutlineItem[] {
  const cursor = parser.parse(source).cursor();
  const items: OutlineItem[] = [];
  do {
    if (cursor.name !== 'ListItem') continue;
    const node = cursor.node;
    const from = lineStart(source, node.from);
    const prefix = /^([ ]*)([-+*]|\d+[.)])([ ]+|$)/.exec(source.slice(from, lineEnd(source, node.from)));
    if (!prefix || from + prefix[1].length !== node.from) continue;
    let parent = node.parent;
    while (parent && parent.name !== 'ListItem') parent = parent.parent;
    const indent = prefix[1].length;
    items.push({ from, to: lineEnd(source, node.to), marker: node.from, content: from + prefix[0].length, indent, contentIndent: prefix[0].length || indent + 2, parent: parent?.from ?? null, list: node.parent!.from, prefix: prefix[2] + (prefix[3] || ' ') });
  } while (cursor.next());
  return items;
}

function itemAt(source: string, at: number, items: OutlineItem[]): OutlineItem | undefined {
  let node = parser.parse(source).resolveInner(at, at === 0 ? 1 : -1);
  while (node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) return undefined;
    if (node.name === 'ListItem') return items.find(item => item.marker === node.from);
    if (!node.parent) break;
    node = node.parent;
  }
  // The end of an empty marker belongs to the list but not always its syntax node.
  return items.filter(item => item.from <= at && at <= item.to && source.slice(item.content, item.to).trim() === '').at(-1);
}

const unchanged = (anchor: number, head: number): FormatResult => ({ changes: [], anchor, head });
const mapped = (at: number, changes: TextEdit[]) => changes.reduce((position, change) => position + (change.from <= at ? change.insert.length - Math.min(change.to - change.from, Math.max(0, at - change.from)) : 0), at);

function movementResult(source: string, changes: TextEdit[], anchor: number, head = anchor): FormatResult {
  let updated = applyEdits(source, changes);
  // A separator moved from the middle to EOF must not introduce a new final newline.
  if (!source.endsWith('\n') && updated.endsWith('\n')) updated = updated.slice(0, -newline(source).length);
  let from = 0, oldEnd = source.length, newEnd = updated.length;
  while (from < oldEnd && from < newEnd && source[from] === updated[from]) from++;
  while (oldEnd > from && newEnd > from && source[oldEnd - 1] === updated[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { changes: from === oldEnd && from === newEnd ? [] : [{ from, to: oldEnd, insert: updated.slice(from, newEnd) }], anchor: Math.min(anchor, updated.length), head: Math.min(head, updated.length) };
}

function shiftLines(source: string, from: number, to: number, amount: number): TextEdit[] {
  const changes: TextEdit[] = [];
  for (let at = from; at <= to;) {
    const end = lineEnd(source, at);
    if (source.slice(at, end).length) {
      if (amount > 0) changes.push({ from: at, to: at, insert: ' '.repeat(amount) });
      else {
        const spaces = /^ */.exec(source.slice(at, end))![0].length;
        changes.push({ from: at, to: at + Math.min(spaces, -amount), insert: '' });
      }
    }
    const next = source.indexOf('\n', at);
    if (next < 0) break;
    at = next + 1;
  }
  return changes;
}

/** Bounded list operations shared by the two native editor adapters; null delegates to Markdown defaults. */
export function editOutline(source: string, anchor: number, head: number, command: OutlineCommand): FormatResult | null {
  const from = Math.min(anchor, head), to = Math.max(anchor, head);
  const items = outlineItems(source);
  const item = itemAt(source, from, items);
  if (!item) return null;
  if (command === 'indent' || command === 'outdent') {
    const lastAt = to > from && source[to - 1] === '\n' ? to - 1 : to;
    const selected = items.filter(candidate => candidate.list === item.list && candidate.parent === item.parent && candidate.from >= item.from && candidate.from <= lastAt);
    const last = selected.at(-1) ?? item;
    if (to > from && lastAt > last.to + newline(source).length) return null;
    const previous = items.filter(candidate => candidate.list === item.list && candidate.parent === item.parent && candidate.from < item.from).at(-1);
    const parent = items.find(candidate => candidate.marker === item.parent);
    if (command === 'indent' && !previous || command === 'outdent' && !parent) return unchanged(anchor, head);
    const amount = command === 'indent' ? previous!.contentIndent - item.indent : parent!.indent - item.indent;
    if (command === 'outdent' && parent!.to > last.to) {
      // Following children must remain with their original parent, not become children of the promoted item.
      const end = afterLine(source, last.to);
      const insertAt = afterLine(source, parent!.to);
      const raw = source.slice(item.from, end);
      const shifts = shiftLines(raw, 0, Math.max(0, raw.length - 1), amount);
      let text = raw;
      for (const change of [...shifts].reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
      const lead = insertAt === source.length && !source.endsWith('\n') ? newline(source) : '';
      if (!text.endsWith('\n') && insertAt < source.length) text += newline(source);
      const position = insertAt - (end - item.from) + lead.length;
      return movementResult(source, [{ from: item.from, to: end, insert: '' }, { from: insertAt, to: insertAt, insert: lead + text }], position + mapped(anchor - item.from, shifts), position + mapped(head - item.from, shifts));
    }
    const changes = shiftLines(source, item.from, last.to, amount);
    return { changes, anchor: mapped(anchor, changes), head: mapped(head, changes) };
  }
  if (lineStart(source, from) !== lineStart(source, to) || from < item.content && lineStart(source, from) === item.from) return null;
  if (itemAt(source, to, items)?.marker !== item.marker) return null;
  const eol = newline(source);
  if (command === 'annotation') {
    const insert = eol + ' '.repeat(item.contentIndent);
    return { changes: [{ from, to, insert }], anchor: from + insert.length, head: from + insert.length };
  }
  if (!source.slice(item.content, item.to).trim()) {
    const parent = items.find(candidate => candidate.marker === item.parent);
    const insert = parent ? ' '.repeat(parent.indent) + item.prefix : '';
    return { changes: [{ from: item.from, to: item.to, insert }], anchor: item.from + insert.length, head: item.from + insert.length };
  }
  const end = lineEnd(source, to);
  const tail = source.slice(to, end);
  const prefix = ' '.repeat(item.indent) + item.prefix.replace(/^(\d+)([.)])/, (_, number: string, mark: string) => `${Number(number) + 1}${mark}`);
  const insert = eol + prefix + tail;
  const changes: TextEdit[] = end === item.to ? [{ from, to: end, insert }] : [{ from, to: end, insert: '' }, { from: item.to, to: item.to, insert }];
  const position = item.to - (end - from) + eol.length + prefix.length;
  return { changes, anchor: position, head: position };
}

/** Move whole source subtrees within one document. The editor owns cancellation and read-only checks. */
export function moveOutlineItem(source: string, from: number, target: number, placement: OutlineDrop): FormatResult | null {
  const items = outlineItems(source);
  const item = items.find(candidate => candidate.from === from || candidate.marker === from);
  const destination = items.find(candidate => candidate.from === target || candidate.marker === target);
  if (!item || !destination || destination.from >= item.from && destination.from <= item.to) return null;
  const insertAt = placement === 'before' ? destination.from : afterLine(source, destination.to);
  const end = afterLine(source, item.to);
  if (insertAt > item.from && insertAt < end) return null;
  const indent = placement === 'child' ? destination.contentIndent : destination.indent;
  const raw = source.slice(item.from, end);
  const amount = indent - item.indent;
  let text = raw;
  for (const change of shiftLines(raw, 0, Math.max(0, raw.length - 1), amount).reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  const eol = newline(source);
  if (!text.endsWith('\n') && insertAt < source.length) text += eol;
  if (insertAt === source.length && source.length && !source.endsWith('\n')) text = eol + text;
  const changes = [{ from: item.from, to: end, insert: '' }, { from: insertAt, to: insertAt, insert: text }].sort((a, b) => a.from - b.from);
  const position = insertAt - (insertAt >= end ? end - item.from : 0) + (text.startsWith(eol) ? eol.length : 0) + indent + item.prefix.length;
  return movementResult(source, changes, position);
}
