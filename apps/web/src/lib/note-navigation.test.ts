import { describe, expect, it } from 'vitest';
import { findTextMatches, parseMarkdownOutline } from './note-navigation.js';

describe('note editor navigation', () => {
  it('finds every case-insensitive, non-overlapping text match', () => {
    expect(findTextMatches('Needle and needle; NEEDLE.', 'needle')).toEqual([
      { from: 0, to: 6 },
      { from: 11, to: 17 },
      { from: 19, to: 25 },
    ]);
    expect(findTextMatches('aaaa', 'aa')).toEqual([{ from: 0, to: 2 }, { from: 2, to: 4 }]);
    expect(findTextMatches('text', '  ')).toEqual([]);
  });

  it('builds an outline from ATX and setext headings while ignoring fenced code', () => {
    const markdown = [
      '# Title',
      '',
      'Introduction',
      '============',
      '',
      '```md',
      '## Not a heading',
      '```',
      '',
      '### **Details** `code` ###',
    ].join('\n');

    expect(parseMarkdownOutline(markdown)).toEqual([
      { depth: 1, label: 'Title', line: 1, from: 0 },
      { depth: 1, label: 'Introduction', line: 3, from: 9 },
      { depth: 3, label: 'Details code', line: 10, from: 64 },
    ]);
  });
});
