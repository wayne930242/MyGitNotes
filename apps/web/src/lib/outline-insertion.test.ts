import { expect, it } from 'vitest';
import { outlineLinkInsertion } from './outline-insertion.js';

const source = { notebookId: 'a', path: 'notes/shared/read me.compilation.yml', title: 'Read [this]\nnow' };
it('appends one portable top-level link without rewriting annotations, children or CRLF', () => {
  const content = '- Parent\r\n  Note\r\n  - Child';
  expect(outlineLinkInsertion(content, 'notes/shared/sub/plan.outline.md', source)).toEqual({ at: content.length, text: '\r\n\r\n- [Read \\[this\\] now](../read%20me.compilation.yml)\r\n' });
});
it.each(['```md\nunfinished', '- Item\n  ```\n  code', '<!-- unfinished', '<script>\ncode'])('refuses an ambiguous EOF block: %s', content => {
  expect(outlineLinkInsertion(content, 'notes/shared/plan.outline.md', source)).toBeNull();
});
it.each(['', '- First\n\n', '```md\nfinished\n```', '- Item\n  ```\n  code\n  ```', '    indented code'])('inserts at a safe blank block boundary: %s', content => {
  const result = outlineLinkInsertion(content, 'notes/shared/plan.outline.md', source);
  expect(result).not.toBeNull();
  expect((content + result!.text).endsWith('- [Read \\[this\\] now](read%20me.compilation.yml)\n')).toBe(true);
});
