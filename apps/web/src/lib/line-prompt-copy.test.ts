import { describe, expect, it } from 'vitest';
import { linePrompt } from './line-prompt-copy.js';

describe('linePrompt', () => {
  it('quotes a line range under its real location', () => {
    expect(linePrompt('my-notes/notes/life/foo.md', 18, 12, 'first\nsecond')).toBe('Below are lines 12-18 of `my-notes/notes/life/foo.md`:\n\nfirst\nsecond\n');
  });

  it('quotes a single line', () => {
    expect(linePrompt('notes/plain.md', 1, 1, '# Title')).toBe('Below is line 1 of `notes/plain.md`:\n\n# Title\n');
  });
});
