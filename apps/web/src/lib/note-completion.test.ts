import { expect, it } from 'vitest';
import { noteCompletionAt } from './note-completion.js';
it('completes an unfinished link and avoids fenced code, images and inline code', () => {
  expect(noteCompletionAt('[label](中文', 11)?.query).toBe('中文');
  expect(noteCompletionAt('```md\n[label](x', 15)).toBeNull();
  expect(noteCompletionAt('![label](x', 10)).toBeNull();
  expect(noteCompletionAt('`[label](x', 10)).toBeNull();
});
