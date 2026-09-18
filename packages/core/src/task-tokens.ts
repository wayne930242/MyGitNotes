export const DUE_EMOJI = '📅';
export const DONE_EMOJI = '✅';
export const TIMESTAMP_EMOJI = '🕒';
export const START_EMOJI = '🛫';

const TASK_MARKER_RE = /^(\s*[-*+]\s\[)([ xX])(\]\s?)/;
const TASK_DATE_TOKENS: [string, boolean][] = [[DUE_EMOJI, false], [DONE_EMOJI, false], [START_EMOJI, false], [TIMESTAMP_EMOJI, true]];
const DATE_VALUE = '\\d{4}-\\d{2}-\\d{2}';
const DATE_TIME_VALUE = `${DATE_VALUE} \\d{2}:\\d{2}`;

export interface TokenMatch {
  start: number;
  end: number;
  leadingSpace: string;
  value: string;
}

function tokenRegExp(emoji: string, withTime: boolean): RegExp {
  const value = withTime ? DATE_TIME_VALUE : DATE_VALUE;
  return new RegExp(`(\\s?)${emoji}\\s*(${value})`, 'u');
}

/** Finds a `<emoji> <value>` token in a line, if present. */
export function findToken(line: string, emoji: string, withTime = false): TokenMatch | null {
  const match = tokenRegExp(emoji, withTime).exec(line);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length, leadingSpace: match[1], value: match[2] };
}

export function getTokenValue(line: string, emoji: string, withTime = false): string | undefined {
  return findToken(line, emoji, withTime)?.value;
}

/**
 * Sets, replaces, or (when `value` is `null`) removes a `<emoji> <value>`
 * token on a line. A new token is appended at the end of the line.
 */
export function setTokenValue(line: string, emoji: string, value: string | null, withTime = false): string {
  const found = findToken(line, emoji, withTime);
  if (value === null) {
    if (!found) return line;
    return (line.slice(0, found.start) + line.slice(found.end)).replace(/[ \t]+$/, '');
  }
  if (found) {
    return line.slice(0, found.start) + `${found.leadingSpace}${emoji} ${value}` + line.slice(found.end);
  }
  return `${line.replace(/\s+$/, '')} ${emoji} ${value}`;
}

export function isTaskLine(line: string): boolean {
  return TASK_MARKER_RE.test(line);
}

/** Removes the checkbox marker and every recognized date token, leaving just the task's text. */
export function stripTaskTokens(line: string): string {
  let text = line.replace(TASK_MARKER_RE, '');
  for (const [emoji, withTime] of TASK_DATE_TOKENS) text = setTokenValue(text, emoji, null, withTime);
  return text.trim();
}

export function isTaskChecked(line: string): boolean | undefined {
  const match = TASK_MARKER_RE.exec(line);
  if (!match) return undefined;
  return match[2].toLowerCase() === 'x';
}

/**
 * Flips a task line's checkbox and adds/removes its done-date token
 * (`✅ YYYY-MM-DD`) to match, per the checked state.
 */
export function setTaskChecked(line: string, checked: boolean, doneDate: string): string {
  const match = TASK_MARKER_RE.exec(line);
  if (!match) return line;
  const markerStart = match[1].length;
  const flipped = line.slice(0, markerStart) + (checked ? 'x' : ' ') + line.slice(markerStart + 1);
  return setTokenValue(flipped, DONE_EMOJI, checked ? doneDate : null);
}

export type TodoGroup = 'overdue' | 'today' | 'upcoming' | 'noDate';

/** Classifies a due-date string (`YYYY-MM-DD`) against today's date, also `YYYY-MM-DD`. */
export function classifyDueDate(due: string | undefined, today: string): TodoGroup {
  if (!due) return 'noDate';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return 'upcoming';
}
