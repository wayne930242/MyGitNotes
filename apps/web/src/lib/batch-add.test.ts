import { describe, expect, it } from 'vitest';
import type { FocusTab } from '@mygitnotes/core/focus-page';
import { batchAddCandidates, batchAddExisting, batchAddMode, batchAddResult, batchAddTabs } from './batch-add.js';

const note = (path: string): FocusTab => ({ kind: 'note', path });

describe('batchAddMode', () => {
  it('is And when only a folder is set', () => {
    expect(batchAddMode(true, false, 'or')).toBe('and');
  });
  it('is And when only tags are set', () => {
    expect(batchAddMode(false, true, 'or')).toBe('and');
  });
  it('is Or by default when both a folder and tags are set', () => {
    expect(batchAddMode(true, true, 'or')).toBe('or');
  });
  it('is And when both are set and Combine is switched to And', () => {
    expect(batchAddMode(true, true, 'and')).toBe('and');
  });
});

describe('batchAddCandidates', () => {
  it('returns the And query result as-is', () => {
    expect(batchAddCandidates('and', ['a.md', 'b.md'], [], [])).toEqual(['a.md', 'b.md']);
  });
  it('unions the folder and tag query results under Or, without duplicates', () => {
    expect(batchAddCandidates('or', [], ['a.md', 'b.md'], ['b.md', 'c.md'])).toEqual(['a.md', 'b.md', 'c.md']);
  });
});

describe('batchAddTabs', () => {
  it('sorts candidate paths and wraps them as note tabs', () => {
    expect(batchAddTabs(['c.md', 'a.md', 'b.md'])).toEqual([note('a.md'), note('b.md'), note('c.md')]);
  });
});

describe('batchAddExisting', () => {
  it('counts tabs already held, by key', () => {
    const held = new Set(['note:a.md', 'note:c.md']);
    expect(batchAddExisting([note('a.md'), note('b.md'), note('c.md')], held)).toBe(2);
  });
  it('returns 0 when nothing is held', () => {
    expect(batchAddExisting([note('a.md')], new Set())).toBe(0);
  });
});

describe('batchAddResult', () => {
  it('splits skipped into already-present and full when the budget was not reached', () => {
    expect(batchAddResult({ added: 3, skipped: 2 }, 2)).toEqual({ added: 3, existing: 2, full: 0 });
  });
  it('attributes the remaining skipped count to the budget being full', () => {
    expect(batchAddResult({ added: 1, skipped: 3 }, 1)).toEqual({ added: 1, existing: 1, full: 2 });
  });
});
