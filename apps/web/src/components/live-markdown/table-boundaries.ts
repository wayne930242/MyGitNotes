import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

function tables(state: EditorState) {
  const ranges: { from: number; to: number; }[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'Table' && node.node.parent?.name === 'Document') {
        ranges.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  return ranges;
}

function crossTable(view: EditorView, backward: boolean) {
  const { state } = view;
  if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
  const at = state.selection.main.head;
  const ranges = tables(state);
  const table = ranges.find(({ from, to }) => backward ? at >= to && /^\n[ \t]*(?:\n)?$/.test(state.sliceDoc(to, at)) : at <= from && /^\n[ \t]*(?:\n)?$/.test(state.sliceDoc(at, from)));
  if (!table) {
    const line = state.doc.lineAt(at);
    // Deleting away from the widget can also consume its empty separator.
    const separator = !line.text.trim() && (backward ? at === line.from && at > 0 && ranges.some(({ from }) => from === line.to + 1) : at === line.to && at < state.doc.length && ranges.some(({ to }) => to === line.from - 1));
    if (!separator) return false;
    view.dispatch({ selection: { anchor: at + (backward ? -1 : 1) }, scrollIntoView: true, userEvent: 'select' });
    return true;
  }
  const target = backward ? table.from - 1 : table.to + 1;
  // At a document edge there is no line beyond the widget to move to. Removing a whole table is the
  // toolbar's confirmed action, so the key stops here rather than taking the table with it.
  if (target < 0 || target > state.doc.length) return true;
  view.dispatch({ selection: { anchor: target }, scrollIntoView: true, userEvent: 'select' });
  return true;
}

export const tableBoundaries = [
  keymap.of([{ key: 'Backspace', run: view => crossTable(view, true) }, { key: 'Delete', run: view => crossTable(view, false) }]),
  EditorState.transactionFilter.of(transaction => {
    if (!transaction.docChanged || !transaction.isUserEvent('input')) return transaction;
    const state = transaction.startState;
    const separators = new Set<number>();
    for (const { to } of tables(state)) {
      if (to === state.doc.length) continue;
      const line = state.doc.lineAt(to + 1);
      if (line.text.trim()) continue;
      transaction.changes.iterChanges((from, end, _newFrom, _newTo, inserted) => {
        if (from < line.from || end > line.to || !inserted.length) return;
        const mapped = transaction.changes.mapPos(line.from, -1);
        if (transaction.newDoc.lineAt(mapped).text.trim()) separators.add(mapped);
      });
    }
    // Keep an empty line before new prose, so Markdown does not absorb it into
    // the table and replace the caret's DOM with the block widget. Compose the
    // separator with the input transaction so a single undo restores both.
    return separators.size ? [transaction, { changes: [...separators].map(from => ({ from, insert: '\n' })), sequential: true }] : transaction;
  }),
];
