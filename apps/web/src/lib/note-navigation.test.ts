import { describe, expect, it } from 'vitest';
import {
  chooseOutlineHeading,
  findOutlineIndexForLine,
  findTextMatches,
  isEditableTarget,
  parseMarkdownOutline,
} from './note-navigation.js';

describe('note editor navigation', () => {
  it('finds every case-insensitive, non-overlapping text match', () => {
    expect(findTextMatches('Needle and needle; NEEDLE.', 'needle')).toEqual([
      { from: 0, to: 6 },
      { from: 11, to: 17 },
      { from: 19, to: 25 },
    ]);
    expect(findTextMatches('aaaa', 'aa')).toEqual([{ from: 0, to: 2 }, { from: 2, to: 4 }]);
    expect(findTextMatches('text', '  ')).toEqual([]);
  });

  it('builds an outline from ATX and setext headings while ignoring fenced code', () => {
    const markdown = [
      '# Title',
      '',
      'Introduction',
      '============',
      '',
      '```md',
      '## Not a heading',
      '```',
      '',
      '### **Details** `code` ###',
    ].join('\n');

    expect(parseMarkdownOutline(markdown)).toEqual([
      { depth: 1, label: 'Title', line: 1, from: 0 },
      { depth: 1, label: 'Introduction', line: 3, from: 9 },
      { depth: 3, label: 'Details code', line: 10, from: 64 },
    ]);
  });

  it('selects the heading containing the current visible line', () => {
    const outline = [
      { depth: 1, label: 'Title', line: 2, from: 1 },
      { depth: 2, label: 'Middle', line: 12, from: 80 },
      { depth: 2, label: 'End', line: 30, from: 240 },
    ];

    expect(findOutlineIndexForLine(outline, 1)).toBe(0);
    expect(findOutlineIndexForLine(outline, 2)).toBe(0);
    expect(findOutlineIndexForLine(outline, 20)).toBe(1);
    expect(findOutlineIndexForLine(outline, 99)).toBe(2);
    expect(findOutlineIndexForLine([], 20)).toBe(0);
  });

  describe('chooseOutlineHeading', () => {
    const outline = [
      { depth: 1, label: 'Section 1', line: 5, from: 10 },
      { depth: 2, label: 'Section 2', line: 25, from: 100 },
    ];

    it('keeps the tool panel open by default when selecting an outline item', () => {
      const result = chooseOutlineHeading(outline, 1);
      expect(result).toEqual({
        heading: outline[1],
        line: 25,
        shouldClosePanel: false,
        focusEditor: false,
      });
    });

    it('allows closing panel only when explicitly specified', () => {
      const result = chooseOutlineHeading(outline, 0, { closeAfter: true });
      expect(result).toEqual({
        heading: outline[0],
        line: 5,
        shouldClosePanel: true,
        focusEditor: false,
      });
    });

    it('returns null when index is out of bounds', () => {
      expect(chooseOutlineHeading(outline, -1)).toBeNull();
      expect(chooseOutlineHeading(outline, 5)).toBeNull();
    });
  });

  describe('isEditableTarget', () => {
    it('returns false for null or non-Element targets', () => {
      expect(isEditableTarget(null)).toBe(false);
      expect(isEditableTarget({} as unknown as EventTarget)).toBe(false);
    });

    it('identifies inputs, textareas, contenteditable and codemirror content elements', () => {
      class MockElement {
        constructor(private matchesSelector: boolean) {}
        closest(_selector: string) {
          return this.matchesSelector ? {} : null;
        }
      }
      const originalElement = globalThis.Element;
      try {
        globalThis.Element = MockElement as unknown as typeof Element;
        const matchingEl = new MockElement(true) as unknown as EventTarget;
        const nonMatchingEl = new MockElement(false) as unknown as EventTarget;
        expect(isEditableTarget(matchingEl)).toBe(true);
        expect(isEditableTarget(nonMatchingEl)).toBe(false);
      } finally {
        globalThis.Element = originalElement;
      }
    });
  });
});

