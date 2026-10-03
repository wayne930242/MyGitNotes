import { Prec } from '@codemirror/state';
import { type EditorView, keymap } from '@codemirror/view';
import { formatMarkdown, type MarkdownFormat } from '../../lib/markdown-format.js';

/** Applies `format` to the main selection as one undoable edit. */
export function applyMarkdownFormat(view: EditorView, format: MarkdownFormat): boolean {
  if (view.state.readOnly) return false;
  const { from, to } = view.state.selection.main;
  const result = formatMarkdown(view.state.doc.toString(), from, to, format);
  view.dispatch({ changes: result.changes, selection: { anchor: result.anchor, head: result.head }, scrollIntoView: true, userEvent: 'input.format' });
  view.focus();
  return true;
}

/** Mod-b, Mod-i and Mod-u; ahead of the default keymap, which spends Mod-i and Mod-u on selection commands. */
export const formatKeymap = Prec.high(keymap.of([{ key: 'Mod-b', run: view => applyMarkdownFormat(view, 'bold') }, { key: 'Mod-i', run: view => applyMarkdownFormat(view, 'italic') }, { key: 'Mod-u', run: view => applyMarkdownFormat(view, 'underline') }]));
