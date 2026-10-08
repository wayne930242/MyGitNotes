import katex, { type KatexOptions } from 'katex';
import type { MarkedExtension, Tokens } from 'marked';
import { escapeHtml } from './directives.js';

export interface MathSpan {
  from: number;
  to: number;
  tex: string;
  display: boolean;
}

// `trust` stays off so \href, \url and \html* cannot emit links or attributes; a bad formula shows as a red error in place.
// HTML output only: DOMPurify drops MathML's <semantics> and <annotation> but keeps their text, which would leak the TeX
// source into the formula, so the wrapper's aria-label carries the source for assistive technology instead.
const KATEX_OPTIONS: KatexOptions = { output: 'html', throwOnError: false, strict: false, trust: false };

/**
 * The formula whose opening dollar sits at `start`, following Pandoc's dollar rules so prices stay text: inline `$…$`
 * opens before a non-space, closes after a non-space where no digit follows, and stays on one line; display `$$…$$`
 * may span lines but not a blank line. A backslash escapes a dollar.
 */
export function mathAt(text: string, start: number): MathSpan | null {
  if (text[start] !== '$') return null;
  const display = text[start + 1] === '$';
  const open = display ? start + 2 : start + 1;
  if (!display && (open >= text.length || /\s/.test(text[open]))) return null;
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') {
      i++;
      continue;
    }
    if (char === '\n' && (!display || /^[ \t]*(?:\n|$)/.test(text.slice(i + 1, i + 200)))) return null;
    if (char !== '$') continue;
    if (display) {
      if (text[i + 1] !== '$') continue;
      const tex = text.slice(open, i).trim();
      return tex ? { from: start, to: i + 2, tex, display } : null;
    }
    if (text[i + 1] === '$' || /\s/.test(text[i - 1]) || /\d/.test(text[i + 1] ?? '')) return null;
    return { from: start, to: i + 1, tex: text.slice(open, i), display };
  }
  return null;
}

/** Every formula in `text`, in order; a dollar that opens no formula stays text. */
export function findMath(text: string): MathSpan[] {
  const spans: MathSpan[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] !== '$') continue;
    const span = mathAt(text, i);
    if (span) {
      spans.push(span);
      i = span.to - 1;
    } else if (text[i + 1] === '$') i++;
  }
  return spans;
}

/**
 * `html` is the app's output. `mathml` is for a page that may carry no inline style, such as a published note: KaTeX's HTML
 * output positions every glyph with `style` attributes, MathML needs none. The `<annotation>` holding the TeX source is
 * dropped, because sanitizing keeps the text of an element it removes, which would print the source beside the formula.
 */
export type MathOutput = 'html' | 'mathml';

export function renderMath(tex: string, display: boolean, output: MathOutput = 'html'): string {
  const rendered = katex.renderToString(tex, { ...KATEX_OPTIONS, output, displayMode: display });
  return `<span class="note-math" role="math" aria-label="${escapeHtml(tex)}">${output === 'mathml' ? rendered.replace(/<annotation\b[^>]*>[\s\S]*?<\/annotation>/g, '') : rendered}</span>`;
}

/** The same formula as renderMath, drawn into `element`. */
export function drawMath(element: HTMLElement, tex: string, display: boolean): void {
  element.classList.add('note-math');
  element.setAttribute('role', 'math');
  element.setAttribute('aria-label', tex);
  katex.render(tex, element, { ...KATEX_OPTIONS, displayMode: display });
}

interface MathToken extends Tokens.Generic {
  tex: string;
  display: boolean;
}

function firstDollar(src: string): number | undefined {
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '$') return i;
  }
  return undefined;
}

/** Marked tokens for `$$…$$` on their own lines (a display block) and `$…$` or `$$…$$` within text, drawn as `output`. */
export const createMarkedMath = (output: MathOutput): MarkedExtension => ({
  extensions: [{
    name: 'mathBlock',
    level: 'block',
    start: src => src.match(/^ {0,3}\$\$/m)?.index,
    tokenizer(src): MathToken | undefined {
      const indent = /^ {0,3}(?=\$\$)/.exec(src)?.[0];
      if (indent === undefined) return undefined;
      const span = mathAt(src, indent.length);
      const tail = span && /^[ \t]*(?:\n|$)/.exec(src.slice(span.to));
      if (!span || !tail) return undefined;
      return { type: 'mathBlock', raw: src.slice(0, span.to + tail[0].length), tex: span.tex, display: true };
    },
    renderer: token => `${renderMath((token as MathToken).tex, true, output)}\n`,
  }, {
    name: 'mathInline',
    level: 'inline',
    start: firstDollar,
    tokenizer(src): MathToken | undefined {
      const span = mathAt(src, 0);
      return span ? { type: 'mathInline', raw: src.slice(0, span.to), tex: span.tex, display: span.display } : undefined;
    },
    renderer: token => renderMath((token as MathToken).tex, (token as MathToken).display, output),
  }],
});

export const markedMath: MarkedExtension = createMarkedMath('html');
