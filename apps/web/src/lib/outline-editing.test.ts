import { describe, expect, it } from 'vitest';
import { applyEdits } from './markdown-format.js';
import { editOutline, moveOutlineItem } from './outline-editing.js';

function edit(text: string, command: 'sibling' | 'annotation' | 'indent' | 'outdent') {
  const from = text.indexOf('|');
  const source = text.replace('|', '');
  const result = editOutline(source, from, from, command);
  if (!result) return null;
  const updated = applyEdits(source, result.changes);
  return updated.slice(0, result.anchor) + '|' + updated.slice(result.head);
}

describe('outline source commands', () => {
  it('adds siblings after complete subtrees and splits text without moving annotations/children', () => {
    expect(edit('- Parent|\n  annotation\n  - Child\n- Next\n', 'sibling')).toBe('- Parent\n  annotation\n  - Child\n- |\n- Next\n');
    expect(edit('- Par|ent\n  annotation\n  - Child\n- Next', 'sibling')).toBe('- Par\n  annotation\n  - Child\n- |ent\n- Next');
    expect(edit('- Parent\n  anno|tation\n  - Child\n- Next', 'sibling')).toBe('- Parent\n  anno\n  - Child\n- |tation\n- Next');
    expect(edit('- Text [link](https://example.com/)|', 'sibling')).toBe('- Text [link](https://example.com/)\n- |');
  });

  it('inserts same-item annotation at content indentation and respects ordered markers and CRLF', () => {
    expect(edit('- Parent|\n  - Child', 'annotation')).toBe('- Parent\n  |\n  - Child');
    expect(edit('12. Parent|', 'annotation')).toBe('12. Parent\n    |');
    expect(edit('- Parent|\r\n  - Child\r\n', 'sibling')).toBe('- Parent\r\n  - Child\r\n- |\r\n');
  });

  it('nests and promotes whole subtrees without inventing a parent', () => {
    expect(edit('- First\n- Sec|ond\n  note\n  - Child\n- Third', 'indent')).toBe('- First\n  - Sec|ond\n    note\n    - Child\n- Third');
    expect(edit('- First\n  - Sec|ond\n    note\n    - Child\n- Third', 'outdent')).toBe('- First\n- Sec|ond\n  note\n  - Child\n- Third');
    expect(edit('- First\n  - Sec|ond\n  - Third\n- Last', 'outdent')).toBe('- First\n  - Third\n- Sec|ond\n- Last');
    expect(edit('- Fi|rst\n- Second', 'indent')).toBe('- Fi|rst\n- Second');
    expect(edit('- Fi|rst\n- Second', 'outdent')).toBe('- Fi|rst\n- Second');
  });

  it('handles empty exit/outdent and preserves non-list/code/native contexts', () => {
    expect(edit('- |', 'sibling')).toBe('|');
    expect(edit('- Parent\n  - |', 'sibling')).toBe('- Parent\n- |');
    for (const source of ['pro|se', '```md\n- co|de\n```', '- Parent\n  ```\n  co|de\n  ```', '- `co|de`']) expect(edit(source, 'sibling')).toBeNull();
  });

  it('replaces a selection only within one text line; spanning blocks returns native fallback', () => {
    const source = '- Hello world\n  - Child\n- Next';
    const result = editOutline(source, 4, 8, 'sibling')!;
    expect(applyEdits(source, result.changes)).toBe('- He\n  - Child\n- world\n- Next');
    expect(editOutline(source, 4, source.indexOf('Next'), 'sibling')).toBeNull();
  });

  it('indents contiguous sibling subtrees in one source change', () => {
    const source = '- First\n- Second\n  - Child\n- Third\n- Last';
    const result = editOutline(source, source.indexOf('Second'), source.indexOf('- Last'), 'indent')!;
    expect(applyEdits(source, result.changes)).toBe('- First\n  - Second\n    - Child\n  - Third\n- Last');
  });
});

describe('same-document subtree movement', () => {
  it('reorders a whole subtree, retaining annotations and source formatting', () => {
    const source = '- First\n  note **one**\n  - Child\n- Second\n- Last\n';
    const result = moveOutlineItem(source, 0, source.indexOf('- Second'), 'after')!;
    expect(applyEdits(source, result.changes)).toBe('- Second\n- First\n  note **one**\n  - Child\n- Last\n');
  });

  it('preserves the final newline convention when moving the last item to the start', () => {
    const source = '- First\n- Last';
    const result = moveOutlineItem(source, source.indexOf('- Last'), 0, 'before')!;
    expect(applyEdits(source, result.changes)).toBe('- Last\n- First');
  });

  it('nests under a link item and rejects own-descendant drops', () => {
    const source = '- First\n  - Child\n- [Second](note.md)\n';
    const result = moveOutlineItem(source, 0, source.indexOf('- [Second]'), 'child')!;
    expect(applyEdits(source, result.changes)).toBe('- [Second](note.md)\n  - First\n    - Child\n');
    expect(moveOutlineItem(source, 0, source.indexOf('- Child'), 'child')).toBeNull();
    expect(moveOutlineItem(source, 0, 0, 'before')).toBeNull();
  });
});
