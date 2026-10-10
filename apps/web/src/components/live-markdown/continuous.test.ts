// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import { type DecorationSet, EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { chipEditState } from './chip-editing.js';
import { tableUIState } from '../LiveMarkdownTable.js';
import { liveDecorations } from './decorations.js';
import { PageBreak, PageFooter } from './widgets.js';

const t = (key: string) => key;
const views: EditorView[] = [];
afterEach(() => {
  while (views.length) views.pop()!.destroy();
});

/** The widgets a note of two pages draws, with the cursor outside the page break so the break itself shows. */
function widgets(continuous: boolean) {
  const field = StateField.define<DecorationSet>({ create: state => liveDecorations(state, true, 'n.md', 'link', 'table', 'Page', 'owner', t as never, undefined, continuous), update: (_value, tr) => liveDecorations(tr.state, true, 'n.md', 'link', 'table', 'Page', 'owner', t as never, undefined, continuous), provide: provided => EditorView.decorations.from(provided) });
  const doc = 'First page.\n\n---\n\nSecond page.';
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: 0 }, extensions: [markdown({ base: markdownLanguage }), chipEditState, tableUIState, field] }) });
  views.push(view);
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  view.dispatch({});
  const found = { breaks: 0, footers: 0, rule: 0 };
  view.state.field(field).between(0, view.state.doc.length, (_from, _to, value) => {
    if (value.spec.widget instanceof PageBreak) found.breaks++;
    if (value.spec.widget instanceof PageFooter) found.footers++;
    if (value.spec.widget?.constructor.name === 'RenderedMarkdown') found.rule++;
  });
  return found;
}

it('splits a note into numbered pages by default', () => {
  expect(widgets(false)).toEqual({ breaks: 1, footers: 1, rule: 0 });
});

it('draws no page break and no page number in a continuous note, and a rule stays an ordinary rule (E15)', () => {
  expect(widgets(true)).toEqual({ breaks: 0, footers: 0, rule: 1 });
});
