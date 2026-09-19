import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { DUE_EMOJI, isTaskLine, START_EMOJI } from '../../lib/task-tokens.js';
import { getAtCompletionItems } from '../../lib/at-completion.js';
import { chipEditChanged } from './chip-editing.js';

export function atCompletionSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/@\w*/);
  if (!match || (match.from === match.to && !context.explicit)) return null;
  const onTaskLine = isTaskLine(context.state.doc.lineAt(match.from).text);
  const query = match.text.slice(1).toLowerCase();
  const allItems = getAtCompletionItems({ onTaskLine, now: new Date() });
  const items = query ? allItems.filter(item => item.label.toLowerCase().split(' ').some(word => word.startsWith(query))) : allItems;
  return {
    from: match.from,
    to: match.to,
    filter: false,
    options: items.map(item => ({
      label: item.label,
      // The token emoji this item inserts or edits; `addToOptions` renders it as an icon, never as text.
      type: item.pickTarget === 'start' ? START_EMOJI : item.pickTarget === 'due' ? DUE_EMOJI : item.insertText!.split(' ')[0],
      apply: item.insertText !== undefined ? item.insertText : (view: EditorView, _completion: unknown, from: number, to: number) => {
        const line = view.state.doc.lineAt(from);
        // Start's identity key is the line start (stable across the deletion below); due's is the line end, which shifts.
        const pos = item.pickTarget === 'start' ? line.from : line.to - (to - from);
        view.dispatch({ changes: { from, to, insert: '' }, effects: chipEditChanged.of({ pos, editing: true }) });
      },
    })),
  };
}
