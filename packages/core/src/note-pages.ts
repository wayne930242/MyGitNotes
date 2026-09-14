import { Lexer } from 'marked';

/** Accept a parsed note body; frontmatter belongs to the note parser. */
export function splitNotePages(body: string): string[] {
  const source = body.replace(/\r\n?/g, '\n');
  const pages: string[] = [];
  let cursor = 0, start = 0;
  for (const token of Lexer.lex(source)) {
    const offset = source.indexOf(token.raw, cursor);
    if (offset < 0) throw new Error('Markdown token could not be located in the source.');
    if (token.type === 'hr' && token.raw.trim() === '---') {
      pages.push(source.slice(start, offset).trim());
      start = offset + token.raw.length;
    }
    cursor = offset + token.raw.length;
  }
  pages.push(source.slice(start).trim());
  return pages;
}
