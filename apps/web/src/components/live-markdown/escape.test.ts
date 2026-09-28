// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import { type DecorationSet, EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { cjkEmphasis } from './cjk-emphasis.js';
import { chipEditState } from './chip-editing.js';
import { tableUIState } from '../LiveMarkdownTable.js';
import { liveDecorations } from './decorations.js';

const t = (key: string) => key;
// Focused, so the line holding the cursor shows its source the way it does while the user edits.
const decorations = StateField.define<DecorationSet>({ create: state => liveDecorations(state, true, 'n.md', 'link', 'table', 'page', 'owner', t as never), update: (_value, tr) => liveDecorations(tr.state, true, 'n.md', 'link', 'table', 'page', 'owner', t as never), provide: field => EditorView.decorations.from(field) });

const views: EditorView[] = [];
function editor(doc: string, cursor = doc.length) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage, extensions: [cjkEmphasis] }), chipEditState, tableUIState, decorations] }) });
  views.push(view);
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  view.dispatch({});
  return view;
}
afterEach(() => {
  while (views.length) views.pop()!.destroy();
});

/** The text each editor line shows. */
const lines = (view: EditorView) => [...view.dom.querySelectorAll('.cm-line')].map(line => line.textContent);

describe('backslash escapes in the live editor', () => {
  it('shows the escaped character without its backslash', () => {
    const view = editor('Judge (5\\*) false and \\_this\\_ plain.\n\n- (6\\*) true\n\nend');
    expect(lines(view)).toEqual(['Judge (5*) false and _this_ plain.', '', '• (6*) true', '', 'end']);
  });

  it('shows the backslash while the cursor is on the line', () => {
    expect(lines(editor('Judge (5\\*) false.\n\nend', 3))[0]).toBe('Judge (5\\*) false.');
  });

  it('keeps backslashes in code, where they are literal', () => {
    expect(lines(editor('Code `a\\*b` here.\n\nend'))[0]).toBe('Code a\\*b here.');
  });
});
