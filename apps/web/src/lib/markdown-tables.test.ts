import { describe, expect, it } from 'vitest';
import { findMarkdownTables, serializeMarkdownTable, tableCellEditorText } from './markdown-tables.js';

describe('Markdown table editing', () => {
  it('finds document tables and preserves their source boundaries', () => {
    const source = '# Heading\n\n| Name | Value |\n| :--- | ---: |\n| **bold** | `a\\|b` |\n\nAfter\n\nA | B\n--- | ---\nx | y\n';
    const tables = findMarkdownTables(source);
    expect(tables).toHaveLength(2);
    expect(tables[0].rows).toEqual([['Name', 'Value'], ['**bold**', '`a\\|b`']]);
    expect(tables[0].alignments).toEqual(['left', 'right']);
    const table = tables[0];
    table.rows[1][0] = 'updated';
    const next = source.slice(0, table.from) + serializeMarkdownTable(table) + source.slice(table.to);
    expect(next.startsWith('# Heading\n\n')).toBe(true);
    expect(next.endsWith('\n\nAfter\n\nA | B\n--- | ---\nx | y\n')).toBe(true);
    expect(findMarkdownTables(next)[0].rows[1]).toEqual(['updated', '`a\\|b`']);
  });
  it('ignores code fences and nested tables', () => {
    expect(findMarkdownTables('```md\n| A | B |\n| - | - |\n```\n\n> | A | B |\n> | - | - |\n')).toEqual([]);
  });
  it('maps CRLF offsets back to the original document without changing surrounding text', () => {
    const source = 'Before\r\n\r\n| A | B |\r\n| --- | --- |\r\n| x | y |\r\n\r\nAfter';
    const [table] = findMarkdownTables(source);
    expect(table.from).toBe(source.indexOf('| A'));
    expect(source.slice(table.to)).toBe('\r\n\r\nAfter');
    expect(source.slice(0, table.from) + serializeMarkdownTable(table, '\r\n') + source.slice(table.to)).toBe(source);
  });
  it('preserves empty cells and pads incomplete rows', () => {
    const [table] = findMarkdownTables('| A | B | C |\n| - | - | - |\n| | middle | |\n| one |\n');
    expect(table.rows).toEqual([['A', 'B', 'C'], ['', 'middle', ''], ['one', '', '']]);
  });
  it('escapes new pipes, retains escaped pipes, and round trips alignment', () => {
    const text = serializeMarkdownTable({ rows: [['A', 'B'], ['a|b', 'c\\|d']], alignments: ['center', 'right'] }, '\r\n');
    expect(text).toBe('| A | B |\r\n| :---: | ---: |\r\n| a\\|b | c\\|d |');
    const [table] = findMarkdownTables(text);
    expect(table.alignments).toEqual(['center', 'right']);
    expect(serializeMarkdownTable(table, '\r\n')).toBe(text);
  });
  it('round trips multiline cell text through Markdown line breaks', () => {
    const text = serializeMarkdownTable({ rows: [['A'], ['First line\nSecond | line']], alignments: ['none'] });
    expect(text).toContain('First line<br>Second \\| line');
    expect(findMarkdownTables(text)[0].rows).toHaveLength(2);
    expect(tableCellEditorText(findMarkdownTables(text)[0].rows[1][0])).toBe('First line\nSecond \\| line');
    expect(tableCellEditorText('one<BR />two<br/>three')).toBe('one\ntwo\nthree');
    expect(tableCellEditorText('`<br>` and \\<br> and ``code `<br>` text``')).toBe('`<br>` and \\<br> and ``code `<br>` text``');
  });
});
