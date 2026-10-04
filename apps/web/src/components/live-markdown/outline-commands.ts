import { Prec } from '@codemirror/state';
import { EditorView, keymap, ViewPlugin } from '@codemirror/view';
import { acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { isolateHistory } from '@codemirror/commands';
import { editOutline, type OutlineCommand } from '../../lib/outline-editing.js';

export function applyOutlineCommand(view: EditorView, command: OutlineCommand): boolean {
  if (view.state.readOnly || view.compositionStarted || view.state.selection.ranges.length !== 1) return false;
  const { anchor, head } = view.state.selection.main;
  const result = editOutline(view.state.doc.toString(), anchor, head, command);
  if (!result) return false;
  if (result.changes.length) view.dispatch({ changes: result.changes, selection: { anchor: result.anchor, head: result.head }, scrollIntoView: true, userEvent: 'input.outline', annotations: isolateHistory.of('full') });
  return true;
}

/** Precedes Markdown continuation, but completion still owns unmodified Enter. CodeMirror handles Escape-Tab. */
const compositionKeys = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      view.contentDOM.addEventListener('keydown', this.capture, true);
    }
    // CM's composing flag becomes true only after the first text mutation. Keep initial IME keys out
    // of every Markdown keymap too, without preventing the browser/IME's own default behavior.
    private capture = (event: KeyboardEvent) => {
      if (event.isComposing || this.view.compositionStarted) event.stopImmediatePropagation();
      else if (event.key === 'Escape') this.view.setTabFocusMode(2000);
    };
    destroy() {
      this.view.contentDOM.removeEventListener('keydown', this.capture, true);
    }
  },
);
export const outlineKeymap = [
  compositionKeys,
  Prec.highest(keymap.of([
    {
      key: 'Enter',
      run: view => {
        if (view.state.readOnly || view.compositionStarted) return false;
        if (completionStatus(view.state) === 'active') {
          // Its interaction-delay guard may decline an early key; never turn that into a new item.
          acceptCompletion(view);
          return true;
        }
        return applyOutlineCommand(view, 'sibling');
      },
    },
    { key: 'Shift-Enter', run: view => applyOutlineCommand(view, 'annotation') },
    { key: 'Tab', run: view => applyOutlineCommand(view, 'indent') },
    { key: 'Shift-Tab', run: view => applyOutlineCommand(view, 'outdent') },
  ])),
];
