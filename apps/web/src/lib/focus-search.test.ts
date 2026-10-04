import { describe, expect, it } from 'vitest';
import type { FocusTab } from '@mygitnotes/core/focus-page';
import { paneDimmed, tabDimmed } from './focus-search.js';

const tab = (path: string): FocusTab => ({ kind: 'note', path });

describe('Focus search dimming', () => {
  it('dims nothing while the search is inactive', () => {
    expect(tabDimmed(null, tab('notes/a.md'))).toBe(false);
    expect(paneDimmed(null, [tab('notes/a.md')])).toBe(false);
  });

  it('dims a tab that is not among the matches, notes and compilations alike', () => {
    const matches = new Set(['notes/a.md', 'notes/b.compilation.yml']);
    expect(tabDimmed(matches, tab('notes/a.md'))).toBe(false);
    expect(tabDimmed(matches, tab('notes/b.compilation.yml'))).toBe(false);
    expect(tabDimmed(matches, tab('notes/c.md'))).toBe(true);
  });

  it('dims a pane only when none of its tabs match, and an empty pane under an active search', () => {
    const matches = new Set(['notes/a.md']);
    expect(paneDimmed(matches, [tab('notes/c.md'), tab('notes/a.md')])).toBe(false);
    expect(paneDimmed(matches, [tab('notes/c.md'), tab('notes/d.md')])).toBe(true);
    expect(paneDimmed(matches, [])).toBe(true);
  });
});
