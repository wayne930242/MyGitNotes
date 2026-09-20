// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderNote } from './markdown.js';
describe('CJK emphasis', () => {
  it('closes bold after full-width punctuation', () => {
    const html = renderNote('新方向參考日本怪談中的**二口女（ふたくちおんな）**意象：林以晴後腦。\n', 'notes/a.md');
    expect(html).toContain('<strong>二口女（ふたくちおんな）</strong>');
  });
  it('leaves non-CJK emphasis alone', () => {
    expect(renderNote('a **bold** word and *italic*.\n', 'notes/a.md')).toContain('<strong>bold</strong>');
  });
});
