import { addDays, formatDateTime, formatDateYMD, nextMonday } from './date-utils.js';
import { DUE_EMOJI, START_EMOJI, TIMESTAMP_EMOJI } from './task-tokens.js';

export interface AtCompletionItem {
  id: string;
  label: string;
  /** Text to insert in place of the triggering `@`. Absent for a `pickTarget` item, which opens a date picker instead. */
  insertText?: string;
  /** For an item with no `insertText`: which date field's picker to open. */
  pickTarget?: 'due' | 'start';
}

/**
 * Completion items offered when typing `@` in the editor. On a task line,
 * due-date and start-date items are offered in addition to the timestamp
 * items available everywhere.
 */
export function getAtCompletionItems(options: { onTaskLine: boolean; now: Date }): AtCompletionItem[] {
  const { onTaskLine, now } = options;
  const items: AtCompletionItem[] = [
    { id: 'now', label: 'now', insertText: `${TIMESTAMP_EMOJI} ${formatDateTime(now)}` },
    { id: 'today', label: 'today', insertText: `${TIMESTAMP_EMOJI} ${formatDateYMD(now)}` },
    { id: 'yesterday', label: 'yesterday', insertText: `${TIMESTAMP_EMOJI} ${formatDateYMD(addDays(now, -1))}` },
    { id: 'tomorrow', label: 'tomorrow', insertText: `${TIMESTAMP_EMOJI} ${formatDateYMD(addDays(now, 1))}` },
  ];

  if (onTaskLine) {
    items.push(
      { id: 'due-today', label: 'due today', insertText: `${DUE_EMOJI} ${formatDateYMD(now)}` },
      { id: 'due-tomorrow', label: 'due tomorrow', insertText: `${DUE_EMOJI} ${formatDateYMD(addDays(now, 1))}` },
      { id: 'due-next-monday', label: 'due next Monday', insertText: `${DUE_EMOJI} ${formatDateYMD(nextMonday(now))}` },
      { id: 'pick-date', label: 'pick a date', pickTarget: 'due' },
      { id: 'start-today', label: 'start today', insertText: `${START_EMOJI} ${formatDateYMD(now)}` },
      { id: 'start-tomorrow', label: 'start tomorrow', insertText: `${START_EMOJI} ${formatDateYMD(addDays(now, 1))}` },
      { id: 'start-next-monday', label: 'start next Monday', insertText: `${START_EMOJI} ${formatDateYMD(nextMonday(now))}` },
      { id: 'pick-start-date', label: 'pick a start date', pickTarget: 'start' }
    );
  }

  return items;
}
