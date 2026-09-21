import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { isMermaidInfo } from '../../lib/mermaid.js';

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>;

/** A ```mermaid fence anywhere in the document, including inside blockquotes and list items. */
export interface MermaidFence {
  /** Start of the opening marker, after any blockquote or list prefix on its line. */
  from: number;
  to: number;
  /** The diagram text without the container prefixes. */
  source: string;
  /** The fence as written, prefixes included; identifies the fence again after the document changed. */
  text: string;
  /** The fence with `source` as its body, keeping the opening line, closing line and prefixes. */
  withSource: (source: string) => string;
}

/** Continuation lines carry the opening line's quote marks; list markers turn into the indent that follows them. */
function continuationPrefix(opening: string) {
  return opening.replace(/[^>\s]+/g, marker => ' '.repeat(marker.length));
}

function readFence(state: EditorState, node: SyntaxNode): MermaidFence | null {
  const info = node.getChild('CodeInfo');
  if (!info || !isMermaidInfo(state.sliceDoc(info.from, info.to))) return null;
  const { doc } = state;
  const openLine = doc.lineAt(node.from);
  const endLine = doc.lineAt(node.to);
  const marks = node.getChildren('CodeMark');
  const closeMark = marks.length > 1 ? marks[marks.length - 1] : null;
  const bodyEnd = closeMark ? endLine.number - 1 : endLine.number;
  // A container prefix ends a CodeText, so a body line starts where its CodeText starts, or at column 0
  // when a CodeText runs on into it (no container prefix to skip there).
  const contentStart = new Map<number, number>();
  for (const text of node.getChildren('CodeText')) {
    const first = doc.lineAt(text.from);
    if (!contentStart.has(first.number)) contentStart.set(first.number, text.from - first.from);
    for (let number = first.number + 1; number <= doc.lineAt(Math.max(text.from, text.to - 1)).number; number++) if (!contentStart.has(number)) contentStart.set(number, 0);
  }
  const body: string[] = [];
  let bodyPrefix: string | null = null;
  for (let number = openLine.number + 1; number <= bodyEnd; number++) {
    const line = doc.line(number);
    const start = contentStart.get(number);
    body.push(start === undefined ? '' : line.text.slice(start));
    if (start !== undefined && bodyPrefix === null) bodyPrefix = line.text.slice(0, start);
  }
  const openPrefix = doc.sliceString(openLine.from, node.from);
  const prefix = bodyPrefix ?? continuationPrefix(openPrefix);
  const blank = prefix.trimEnd();
  const marker = /^\s*(`{3,}|~{3,})/.exec(doc.sliceString(node.from, openLine.to))?.[1] ?? '```';
  const opening = doc.sliceString(node.from, openLine.to);
  const closing = closeMark ? doc.sliceString(doc.line(endLine.number).from, node.to) : prefix + marker;
  return {
    from: node.from,
    to: node.to,
    source: body.join('\n'),
    text: doc.sliceString(node.from, node.to),
    withSource: source => {
      const trimmed = source.replace(/\n+$/, '');
      return [opening, ...(trimmed ? trimmed.split('\n').map(line => line ? prefix + line : blank) : []), closing].join('\n');
    },
  };
}

export function findMermaidFences(state: EditorState): MermaidFence[] {
  const found: MermaidFence[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') return;
      const fence = readFence(state, node.node);
      if (fence) found.push(fence);
    },
  });
  return found;
}

export function mermaidFenceAt(state: EditorState, node: SyntaxNode): MermaidFence | null {
  return node.name === 'FencedCode' ? readFence(state, node) : null;
}

/** Finds the opened fence again: the one still at its position, else the only fence with the same text. */
export function relocateMermaidFence(state: EditorState, opened: MermaidFence): MermaidFence | null {
  const same = findMermaidFences(state).filter(fence => fence.text === opened.text);
  return same.find(fence => fence.from === opened.from) ?? (same.length === 1 ? same[0] : null);
}
