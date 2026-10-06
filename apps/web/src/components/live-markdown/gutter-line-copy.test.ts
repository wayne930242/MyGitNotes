// @vitest-environment jsdom
import { EditorState, StateField } from '@codemirror/state';
import { Decoration, EditorView, lineNumbers, WidgetType } from '@codemirror/view';
import { afterEach, expect, it } from 'vitest';
import { blockWidgetLineNumbers } from './gutter-line-copy.js';

class Box extends WidgetType {
  toDOM() {
    return document.createElement('div');
  }
}

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

it('numbers a block widget by its first line and records every line it replaces, offset as the gutter is', () => {
  const doc = ['one', ':::note', 'body', ':::', 'five'].join('\n');
  // Lines 2 to 4 render as one block widget, as a collapsed directive does; a block widget between lines replaces none.
  const widgets = StateField.define({ create: state => Decoration.set([Decoration.replace({ widget: new Box(), block: true }).range(state.doc.line(2).from, state.doc.line(4).to), Decoration.widget({ widget: new Box(), block: true, side: 1 }).range(state.doc.length)]), update: value => value, provide: field => EditorView.decorations.from(field) });
  const offset = { current: 10 };
  view = new EditorView({ state: EditorState.create({ doc, extensions: [widgets, lineNumbers({ formatNumber: number => String(number + offset.current) }), blockWidgetLineNumbers(offset)] }), parent: document.body });
  const markers = [...view.dom.querySelectorAll<HTMLElement>('[data-line-first]')].map(marker => [marker.textContent, marker.dataset.lineFirst, marker.dataset.lineLast]);
  expect(markers).toEqual([['12', '2', '4']]);
});
