import { describe, expect, it } from 'vitest';
import { linePrompt } from './line-prompt-copy.js';

describe('linePrompt', () => {
  it('formats and normalizes a line range', () => {
    expect(linePrompt('my-notes/notes/life/foo.md', 18, 12)).toBe('Regarding lines 12-18 of `my-notes/notes/life/foo.md`: ');
  });

  it('formats a single line', () => {
    expect(linePrompt('notes/plain.md', 1)).toBe('Regarding line 1 of `notes/plain.md`: ');
  });
});
