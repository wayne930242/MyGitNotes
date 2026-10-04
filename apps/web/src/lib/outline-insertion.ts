import { parser } from '@lezer/markdown';
import { noteMarkdownLink } from '@mygitnotes/core/workspace-links';
import type { NoteRef } from '@mygitnotes/core/note-query';

/** Append without interpreting items as folders or rewriting the existing source. */
export function outlineLinkInsertion(content: string, destination: string, source: NoteRef & { title: string; }): { at: number; text: string; } | null {
  const tree = parser.parse(content);
  const end = content.trimEnd().length;
  let node = tree.resolveInner(end, -1);
  while (node) {
    // An unterminated fence or HTML block could swallow an appended bullet. HTML is
    // deliberately conservative: let the user finish/edit that block themselves.
    if (['HTMLBlock', 'CommentBlock', 'ProcessingInstructionBlock'].includes(node.name)) return null;
    if (node.name === 'FencedCode' && node.getChildren('CodeMark').length < 2) return null;
    if (!node.parent) break;
    node = node.parent;
  }
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const separator = !content ? '' : content.endsWith(newline + newline) ? '' : content.endsWith(newline) ? newline : newline + newline;
  return { at: content.length, text: `${separator}- ${noteMarkdownLink(destination, source.path, source.title)}${newline}` };
}
