import { describe, expect, it } from 'vitest';
import { isSelectionClick, pruneNoteSelection, toggleNoteSelection } from './note-selection.js';

describe('isSelectionClick', () => {
  it('is true when shift, ctrl, or meta is held', () => {
    expect(isSelectionClick({ shiftKey: true })).toBe(true);
    expect(isSelectionClick({ ctrlKey: true })).toBe(true);
    expect(isSelectionClick({ metaKey: true })).toBe(true);
  });

  it('is false for a plain click, so it never changes today\'s open-note behavior', () => {
    expect(isSelectionClick({})).toBe(false);
    expect(isSelectionClick({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe(false);
  });
});

describe('toggleNoteSelection', () => {
  const a = { path: 'a.md' }, b = { path: 'b.md' };

  it('adds a note not yet selected', () => {
    const next = toggleNoteSelection(new Map(), a);
    expect(Array.from(next.keys())).toEqual(['a.md']);
    expect(next.get('a.md')).toBe(a);
  });

  it('removes a note already selected, keeping the rest', () => {
    const selected = new Map([['a.md', a], ['b.md', b]]);
    const next = toggleNoteSelection(selected, a);
    expect(Array.from(next.keys())).toEqual(['b.md']);
  });

  it('does not mutate the input map', () => {
    const selected = new Map<string, { path: string; }>();
    toggleNoteSelection(selected, a);
    expect(selected.size).toBe(0);
  });
});

describe('pruneNoteSelection', () => {
  const a = { path: 'a.md' }, b = { path: 'b.md' };

  it('drops entries no longer in availablePaths', () => {
    const selected = new Map([['a.md', a], ['b.md', b]]);
    const next = pruneNoteSelection(selected, new Set(['a.md']));
    expect(Array.from(next.keys())).toEqual(['a.md']);
  });

  it('returns the same map instance when nothing changed', () => {
    const selected = new Map([['a.md', a]]);
    expect(pruneNoteSelection(selected, new Set(['a.md', 'b.md']))).toBe(selected);
  });
});
