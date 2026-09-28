import { describe, expect, it } from 'vitest';
import { isSelectionClick, pruneNoteSelection, toggleNoteSelection } from './note-selection.js';

describe('isSelectionClick', () => {
  it('is true when shift, ctrl, or meta is held', () => {
    expect(isSelectionClick({ shiftKey: true })).toBe(true);
    expect(isSelectionClick({ ctrlKey: true })).toBe(true);
    expect(isSelectionClick({ metaKey: true })).toBe(true);
  });

  it("is false for a plain click, so it never changes today's open-note behavior", () => {
    expect(isSelectionClick({})).toBe(false);
    expect(isSelectionClick({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe(false);
  });
});

describe('toggleNoteSelection', () => {
  const a = { notebookId: 'n', path: 'a.md' }, b = { notebookId: 'n', path: 'b.md' };

  it('adds a note not yet selected', () => {
    const next = toggleNoteSelection(new Map(), a);
    expect(Array.from(next.keys())).toEqual(['n:a.md']);
    expect(next.get('n:a.md')).toBe(a);
  });

  it('removes a note already selected, keeping the rest', () => {
    const selected = new Map([['n:a.md', a], ['n:b.md', b]]);
    const next = toggleNoteSelection(selected, a);
    expect(Array.from(next.keys())).toEqual(['n:b.md']);
  });

  it('keeps notes of the same path in two notebooks apart', () => {
    const other = { notebookId: 'm', path: 'a.md' };
    const next = toggleNoteSelection(toggleNoteSelection(new Map(), a), other);
    expect(Array.from(next.keys())).toEqual(['n:a.md', 'm:a.md']);
  });

  it('does not mutate the input map', () => {
    const selected = new Map<string, typeof a>();
    toggleNoteSelection(selected, a);
    expect(selected.size).toBe(0);
  });
});

describe('pruneNoteSelection', () => {
  const a = { notebookId: 'n', path: 'a.md' }, b = { notebookId: 'n', path: 'b.md' };

  it('drops entries no longer available', () => {
    const selected = new Map([['n:a.md', a], ['n:b.md', b]]);
    const next = pruneNoteSelection(selected, new Set(['n:a.md']));
    expect(Array.from(next.keys())).toEqual(['n:a.md']);
  });

  it('returns the same map instance when nothing changed', () => {
    const selected = new Map([['n:a.md', a]]);
    expect(pruneNoteSelection(selected, new Set(['n:a.md', 'n:b.md']))).toBe(selected);
  });
});
