import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';

export type TableAlignment = 'none' | 'left' | 'center' | 'right';
export interface MarkdownTable {
  from: number;
  to: number;
  rows: string[][];
  alignments: TableAlignment[];
}

// Keep inline Markdown and escaped pipes intact while splitting GFM cells.
function cells(line: string): string[] {
  const parts: string[] = [];
  let cell = '', slashes = 0;
  for (const char of line.trim()) {
    if (char === '|' && slashes % 2 === 0) {
      parts.push(cell.trim());
      cell = '';
    } else cell += char;
    slashes = char === '\\' ? slashes + 1 : 0;
  }
  parts.push(cell.trim());
  if (parts[0] === '') parts.shift();
  if (parts.at(-1) === '') parts.pop();
  return parts;
}

export function findMarkdownTables(content: string): MarkdownTable[] {
  const collapsedNewlines: number[] = [];
  const normalized = content.replace(/\r\n?/g, (newline, offset: number) => {
    if (newline.length === 2) collapsedNewlines.push(offset - collapsedNewlines.length);
    return '\n';
  });
  const sourceOffset = (offset: number) => offset + collapsedNewlines.filter(position => position < offset).length;
  const state = EditorState.create({ doc: normalized, extensions: [markdown({ base: markdownLanguage })] });
  const tables: MarkdownTable[] = [];
  ensureSyntaxTree(state, normalized.length, 1000)?.iterate({
    enter(node) {
      if (node.name !== 'Table' || node.node.parent?.name !== 'Document') return;
      const lines = normalized.slice(node.from, node.to).split('\n');
      const header = cells(lines[0]);
      const alignments = cells(lines[1]).map<TableAlignment>(cell => cell.startsWith(':') ? (cell.endsWith(':') ? 'center' : 'left') : cell.endsWith(':') ? 'right' : 'none');
      const rows = [header, ...lines.slice(2).map(cells)];
      // Preserve surplus source cells too, including malformed but recoverable tables.
      const width = Math.max(header.length, ...rows.map(row => row.length));
      for (const row of rows) while (row.length < width) row.push('');
      while (alignments.length < width) alignments.push('none');
      tables.push({ from: sourceOffset(node.from), to: sourceOffset(node.to), rows, alignments });
      return false;
    },
  });
  return tables;
}

function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, '<br>').replace(/(\\*)\|/g, (match, slashes: string) => slashes.length % 2 === 0 ? `\\${match}` : match);
}

export function tableCellEditorText(value: string): string {
  // Display HTML line breaks as editable newlines, preserving code and escapes.
  return value.replace(/(`+)([\s\S]*?)\1(?!`)|\\[\\<]|<br\s*\/?>/gi, token => /^<br\s*\/?>$/i.test(token) ? '\n' : token);
}

export function serializeMarkdownTable(table: Pick<MarkdownTable, 'rows' | 'alignments'>, newline = '\n'): string {
  const row = (values: string[]) => `| ${values.map(escapeCell).join(' | ')} |`;
  const separators = { none: '---', left: ':---', center: ':---:', right: '---:' };
  return [row(table.rows[0]), row(table.alignments.map(value => separators[value])), ...table.rows.slice(1).map(row)].join(newline);
}
