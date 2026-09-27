// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { printDocument, renderPrintableNote } from './note-export.js';

describe('math in the print document', () => {
  it('carries the KaTeX stylesheet and fonts the drawn formulas need', async () => {
    const body = await renderPrintableNote('Inline $x^2$.\n\n$$\ny = 1\n$$', 'notes/n.md');
    const doc = new DOMParser().parseFromString(printDocument('Title', body), 'text/html');
    expect(doc.querySelectorAll('.katex')).toHaveLength(2);
    const style = [...doc.querySelectorAll('style')].map(node => node.textContent).join('\n');
    expect(style).toMatch(/\.katex\s*\{/);
    expect(style).toMatch(/\.katex-display\s*\{/);
    // Root-absolute font URLs, since the srcdoc frame resolves them against the app's URL rather than the stylesheet's.
    expect(style).toMatch(/@font-face\s*\{[^}]*font-family:\s*KaTeX_Main;[^}]*url\(\/[^)]*KaTeX_Main-Regular[^)]*\.woff2\)/);
  });

  it('escapes the title', () => {
    const doc = new DOMParser().parseFromString(printDocument('<b>a & b</b>', '<p>x</p>'), 'text/html');
    expect(doc.title).toBe('<b>a & b</b>');
    expect(doc.head.querySelector('b')).toBeNull();
  });
});
