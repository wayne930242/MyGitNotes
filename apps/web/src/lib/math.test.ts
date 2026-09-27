// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderNote } from './markdown.js';
import { findMath } from './math.js';

function mount(source: string) {
  return new DOMParser().parseFromString(renderNote(source, 'notes/n.md'), 'text/html').body;
}

/** The formulas KaTeX drew, with the TeX source their accessible label carries. */
function formulas(root: HTMLElement) {
  return [...root.querySelectorAll('.note-math')].filter(node => node.querySelector('.katex')).map(node => ({ display: !!node.querySelector('.katex-display'), tex: node.getAttribute('aria-label') }));
}

describe('findMath', () => {
  it('finds inline and display math with their positions', () => {
    expect(findMath('a $x$ b')).toEqual([{ from: 2, to: 5, tex: 'x', display: false }]);
    expect(findMath('$$\ny = 1\n$$')).toEqual([{ from: 0, to: 11, tex: 'y = 1', display: true }]);
    expect(findMath('see $$x$$ here')).toEqual([{ from: 4, to: 9, tex: 'x', display: true }]);
  });

  it('leaves prices, escaped dollars, and unclosed dollars as text', () => {
    expect(findMath('It costs $5 and $10 today.')).toEqual([]);
    expect(findMath('Pay $5, not $ 6$.')).toEqual([]);
    expect(findMath('literal \\$x\\$ here')).toEqual([]);
    expect(findMath('just one $ sign')).toEqual([]);
    expect(findMath('$$\na\n\nb\n$$')).toEqual([]);
  });

  it('keeps an escaped dollar inside a formula', () => {
    expect(findMath('$a \\$ b$')).toEqual([{ from: 0, to: 8, tex: 'a \\$ b', display: false }]);
  });
});

describe('math in rendered notes', () => {
  it('draws inline and display formulas instead of the dollar source', () => {
    const root = mount('Inline $x^2$ here.\n\n$$\n\\mathrm{ref}_a(t_1 + t_2) = \\mathrm{ref}_a(t_1) + \\mathrm{ref}_a(t_2)\n$$\n\nAfter $$y$$ too.');
    expect(root.textContent).not.toContain('$');
    expect(formulas(root)).toEqual([{ display: false, tex: 'x^2' }, { display: true, tex: '\\mathrm{ref}_a(t_1 + t_2) = \\mathrm{ref}_a(t_1) + \\mathrm{ref}_a(t_2)' }, { display: true, tex: 'y' }]);
  });

  it('renders the sample note formulas next to CJK punctuation and escapes', () => {
    const root = mount('「$p(9)$」由函數符號 $p$ 組成。於是 $|\\{\\text{Socrates}\\}| = \\text{Socrates}$。\n\n- (5\\*) 它是 $\\Box\\exists x Fx$ 與 $\\#(F)$。');
    expect(formulas(root).map(formula => formula.tex)).toEqual(['p(9)', 'p', '|\\{\\text{Socrates}\\}| = \\text{Socrates}', '\\Box\\exists x Fx', '\\#(F)']);
    expect(root.querySelector('.katex-error')).toBeNull();
  });

  it('keeps code and prices literal', () => {
    const root = mount('Costs $5 and $10.\n\n`$x$` in code\n\n```\n$$y$$\n```');
    expect(formulas(root)).toEqual([]);
    expect(root.textContent).toContain('Costs $5 and $10.');
    expect(root.querySelector('code')?.textContent).toBe('$x$');
    expect(root.querySelector('pre')?.textContent).toContain('$$y$$');
  });

  it('renders formulas inside tables and directive bodies', () => {
    expect(formulas(mount('| a | b |\n| - | - |\n| $x$ | 1 |'))).toEqual([{ display: false, tex: 'x' }]);
    expect(formulas(mount(':::info\nSee $y$.\n:::'))).toEqual([{ display: false, tex: 'y' }]);
  });

  it('stays safe through the sanitizer', () => {
    const root = mount('$\\href{javascript:alert(1)}{x}$ and $<img src=x onerror=alert(1)>$ and $$\\htmlClass{x}{y}$$');
    expect(root.querySelector('a, img, [href], [src], [onerror]')).toBeNull();
    expect(root.querySelector('.katex [class~="x"]')).toBeNull();
    expect(formulas(root).map(formula => formula.tex)).toEqual(['\\href{javascript:alert(1)}{x}', '<img src=x onerror=alert(1)>', '\\htmlClass{x}{y}']);
  });

  it('shows a bad formula as an error instead of breaking the note', () => {
    const root = mount('Broken $\\frac{1}$ formula, then more text.');
    expect(root.textContent).toContain('then more text.');
    expect(root.querySelector('.katex-error')?.textContent).toBe('\\frac{1}');
  });
});
