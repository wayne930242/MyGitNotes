import { expect, it } from 'vitest';
import { diffStats, parseDiffPreview } from './diff-preview.js';

it('counts only hunk changes and assigns old/new line numbers', () => {
  const result = parseDiffPreview('--- a\n+++ b\n@@ -8,2 +8,2 @@\n same\n-old\n+new\n');
  expect(result.added).toBe(1);
  expect(result.removed).toBe(1);
  expect(result.lines.slice(-3)).toEqual([{ text: ' same', kind: 'context', oldLine: 8, newLine: 8 }, { text: '-old', kind: 'removed', oldLine: 9 }, { text: '+new', kind: 'added', newLine: 9 }]);
});
it('recognizes binary and size-limited previews without pretending they are merge errors', () => {
  expect(parseDiffPreview('Binary files a/a.png and b/a.png differ').notice).toBe('binary');
  expect(parseDiffPreview('Binary file added.').notice).toBe('binary');
  expect(parseDiffPreview('File exceeds the 1 MiB preview limit.').notice).toBe('tooLarge');
});
it('summarises a diff as line counts, and gives none for an empty or unpreviewable diff', () => {
  expect(diffStats('--- a\n+++ b\n@@ -1,2 +1,3 @@\n-old\n+new\n+more\n keep\n')).toEqual({ added: 2, removed: 1 });
  expect(diffStats('')).toBeNull();
  expect(diffStats('Binary file added.')).toBeNull();
  expect(diffStats('File exceeds the 1 MiB preview limit.')).toBeNull();
});
