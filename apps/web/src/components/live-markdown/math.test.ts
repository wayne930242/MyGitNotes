// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { cjkEmphasis } from './cjk-emphasis.js';
import { chipEditState } from './chip-editing.js';
import { tableUIState } from '../LiveMarkdownTable.js';
import { liveDecorations } from './decorations.js';
import { MathFormula } from './widgets.js';

const t = (key: string) => key;
// Focused, so the line holding the cursor shows its source the way it does while the user edits.
const decorations = StateField.define<DecorationSet>({ create: state => liveDecorations(state, true, 'n.md', 'link', 'table', 'page', 'owner', t as never), update: (_value, tr) => liveDecorations(tr.state, true, 'n.md', 'link', 'table', 'page', 'owner', t as never), provide: field => EditorView.decorations.from(field) });

const views: EditorView[] = [];
function editor(doc: string, cursor = doc.length) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage, extensions: [cjkEmphasis] }), chipEditState, tableUIState, decorations] }) });
  views.push(view);
  // The first parse runs on a time budget, so under load a code block late in the note can still be unparsed;
  // finish the parse and let the decorations recompute, as the editor does once its parser catches up.
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  view.dispatch({});
  return view;
}
afterEach(() => {
  while (views.length) views.pop()!.destroy();
});

/** The formulas the live editor draws, with the source range each one replaces. */
function formulas(view: EditorView) {
  const found: { tex: string; display: boolean; block: boolean; source: string; }[] = [];
  view.state.field(decorations).between(0, view.state.doc.length, (from, to, value: Decoration) => {
    if (value.spec.widget instanceof MathFormula) found.push({ tex: value.spec.widget.tex, display: value.spec.widget.display, block: value.spec.widget.block, source: view.state.sliceDoc(from, to) });
  });
  return found;
}

const note = 'Inline $p(9)$ and $|\\{\\text{Socrates}\\}|$ here.\n\n$$\n\\mathrm{ref}_a(t_1 + t_2) = \\mathrm{ref}_a(t_1) + \\mathrm{ref}_a(t_2)\n$$\n\nCode `$x$` and $5 or $10.\n\n```\n$$y$$\n```\n\nend';

describe('math in the live editor', () => {
  it('draws inline and display formulas in place of their source', () => {
    const view = editor(note);
    expect(formulas(view)).toEqual([{ tex: 'p(9)', display: false, block: false, source: '$p(9)$' }, { tex: '|\\{\\text{Socrates}\\}|', display: false, block: false, source: '$|\\{\\text{Socrates}\\}|$' }, { tex: '\\mathrm{ref}_a(t_1 + t_2) = \\mathrm{ref}_a(t_1) + \\mathrm{ref}_a(t_2)', display: true, block: true, source: '$$\n\\mathrm{ref}_a(t_1 + t_2) = \\mathrm{ref}_a(t_1) + \\mathrm{ref}_a(t_2)\n$$' }]);
    expect(view.dom.querySelectorAll('.live-md-math .katex')).toHaveLength(3);
    expect(view.dom.querySelector('.live-md-math-block .katex-display')).not.toBeNull();
  });

  it('shows the source of a formula while the cursor is on its lines', () => {
    const inside = note.indexOf('ref}_a(t_1)');
    expect(formulas(editor(note, inside)).map(formula => formula.tex)).toEqual(['p(9)', '|\\{\\text{Socrates}\\}|']);
    expect(formulas(editor(note, 3)).map(formula => formula.display)).toEqual([true]);
  });

  it('leaves formulas in a table to the rendered table', () => {
    expect(formulas(editor('| a |\n| - |\n| $x$ |\n\nend'))).toEqual([]);
  });
});
